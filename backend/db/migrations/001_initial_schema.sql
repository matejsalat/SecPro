-- ============================================================================
-- SecPro Backend — Initial Schema v1
-- ============================================================================
-- Run order: this file first, then 002_seed.sql, then 003_rls.sql
-- Target: Supabase managed Postgres 15 (Frankfurt region)
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Extensions
-- ─────────────────────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "postgis";
create extension if not exists "pg_trgm";
create extension if not exists "unaccent";
create extension if not exists "btree_gin";

-- Slovak-aware FTS config: unaccent + simple lowercase
create text search configuration sk_unaccent ( copy = simple );
alter text search configuration sk_unaccent
  alter mapping for hword, hword_part, word with unaccent, simple;

-- ─────────────────────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────────────────────
create type listing_type      as enum ('byt','dom','pozemok','komercny','chata','garaz','iny');
create type listing_operation as enum ('predaj','prenajom');
create type listing_condition as enum ('novostavba','kompletna_rekonstrukcia','ciastocna_rekonstrukcia','povodny_stav','holobyt','vo_vystavbe');
create type seller_type       as enum ('private','agency','developer','unknown');
create type orientation       as enum ('S','J','V','Z','SV','SZ','JV','JZ');
create type parking_type      as enum ('garaz','kryte_state','vonkajsie_state','ziadne');
create type heating_type      as enum ('plyn','dialkove','elektrina','tepelne_cerpadlo','tuhe_palivo','ine','ziadne');
create type lead_status       as enum ('new','contacted','meeting','offer','won','lost','archived');
create type job_status        as enum ('queued','running','succeeded','failed','skipped');
create type photo_category    as enum ('exterior','living_room','bedroom','kitchen','bathroom','floor_plan','view','garden','garage','other');

-- ─────────────────────────────────────────────────────────────────────────────
-- Core tables
-- ─────────────────────────────────────────────────────────────────────────────

-- Portals (one row per scraper source)
create table portals (
  id                      uuid primary key default gen_random_uuid(),
  slug                    text unique not null,
  name                    text not null,
  base_url                text not null,
  is_active               boolean not null default true,
  priority                smallint not null default 100,
  scrape_interval_minutes int not null default 60,
  notes                   text,
  created_at              timestamptz not null default now()
);

-- Users (brokers) — shadow of auth.users
create table users (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null unique,
  full_name     text,
  phone         text,
  company_name  text,
  role          text not null default 'broker',
  settings      jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz
);

-- Canonical listings — the table brokers query
create table listings (
  -- Identity
  id                      uuid primary key default gen_random_uuid(),
  canonical_hash          text unique,

  -- Type & operation
  type                    listing_type not null,
  subtype                 text,
  operation               listing_operation not null default 'predaj',

  -- Pricing
  price                   numeric(12,2),
  price_currency          char(3) not null default 'EUR',
  price_per_sqm           numeric(10,2) generated always as (
    case when size_usable_m2 > 0 then round(price / size_usable_m2, 2) end
  ) stored,
  price_negotiable        boolean,

  -- Size
  size_m2                 numeric(8,2),
  size_usable_m2          numeric(8,2),
  size_land_m2            numeric(10,2),
  rooms                   smallint,
  bathrooms               smallint,

  -- Building
  floor                   smallint,
  total_floors            smallint,
  condition               listing_condition,
  construction_year       smallint,
  year_last_renovation    smallint,
  energy_class            char(1),
  orientation             orientation,
  parking                 parking_type,
  heating                 heating_type,
  balcony                 boolean,
  terrace                 boolean,
  loggia                  boolean,
  cellar                  boolean,
  elevator                boolean,
  furnished               boolean,

  -- Location
  country                 char(2) not null default 'SK',
  region                  text,
  district                text,
  city                    text,
  city_district           text,
  street                  text,
  street_number           text,
  postal_code             text,
  geo_point               geography(Point, 4326),

  -- Seller
  seller_type             seller_type not null default 'unknown',
  seller_name             text,
  is_rk                   boolean generated always as (seller_type = 'agency') stored,
  phone_primary           text,
  has_verified_phone      boolean not null default false,

  -- Content
  title                   text,
  description_raw         text,
  description_ai_summary  text,

  -- Free-form extras
  attributes              jsonb not null default '{}',

  -- Lifecycle
  first_seen_at           timestamptz not null default now(),
  last_seen_at            timestamptz not null default now(),
  posted_at_portal        timestamptz,
  is_active               boolean not null default true,
  removed_at              timestamptz,

  -- Scores
  freshness_score         real,
  quality_score           real,
  search_rank             real,

  -- FTS
  search_tsv              tsvector generated always as (
    setweight(to_tsvector('sk_unaccent', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('sk_unaccent', coalesce(city,'') || ' ' || coalesce(city_district,'') || ' ' || coalesce(street,'')), 'B') ||
    setweight(to_tsvector('sk_unaccent', coalesce(description_raw,'')), 'C')
  ) stored,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint price_non_negative check (price is null or price >= 0),
  constraint size_non_negative  check (size_m2 is null or size_m2 >= 0),
  constraint rooms_sane         check (rooms is null or rooms between 0 and 50)
);

comment on column listings.canonical_hash   is 'Stable dedup hash from phone + size + city_district + price_bucket.';
comment on column listings.price_per_sqm    is 'Generated: price / size_usable_m2.';
comment on column listings.freshness_score  is '0..1 decay on last_seen_at.';
comment on column listings.quality_score    is '0..1 completeness.';
comment on column listings.geo_point        is 'WGS84 geocoded; null if geocoding failed.';

-- Per-portal source rows (M2M: one canonical listing ↔ many portal sources)
create table listing_sources (
  id                  uuid primary key default gen_random_uuid(),
  listing_id          uuid not null references listings(id) on delete cascade,
  portal_id           uuid not null references portals(id),
  external_id         text not null,
  url                 text not null,
  source_title        text,
  source_price        numeric(12,2),
  source_seller_name  text,
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  is_active           boolean not null default true,
  removed_at          timestamptz,
  raw_payload         jsonb,
  unique (portal_id, external_id)
);

-- Raw scrape snapshots (partitioned by month)
create table listings_raw_history (
  id                  bigserial,
  source_id           uuid not null,
  scraped_at          timestamptz not null default now(),
  raw_payload         jsonb not null,
  diff_from_previous  jsonb,
  primary key (id, scraped_at)
) partition by range (scraped_at);

-- Initial partition
create table listings_raw_history_2026_04 partition of listings_raw_history
  for values from ('2026-04-01') to ('2026-05-01');
create table listings_raw_history_2026_05 partition of listings_raw_history
  for values from ('2026-05-01') to ('2026-06-01');

-- Price change log (partitioned by year, kept forever)
create table price_history (
  id              bigserial,
  listing_id      uuid not null references listings(id) on delete cascade,
  source_id       uuid references listing_sources(id) on delete set null,
  price           numeric(12,2) not null,
  price_currency  char(3) not null default 'EUR',
  changed_at      timestamptz not null default now(),
  primary key (id, changed_at)
) partition by range (changed_at);

create table price_history_2026 partition of price_history
  for values from ('2026-01-01') to ('2027-01-01');
create table price_history_2027 partition of price_history
  for values from ('2027-01-01') to ('2028-01-01');

create index on price_history_2026 (listing_id, changed_at desc);
create index on price_history_2027 (listing_id, changed_at desc);

-- Photos
create table photos (
  id            uuid primary key default gen_random_uuid(),
  listing_id    uuid not null references listings(id) on delete cascade,
  source_id     uuid references listing_sources(id) on delete set null,
  url           text not null,
  local_path    text,
  phash         bigint,
  category      photo_category,
  width         int,
  height        int,
  bytes         int,
  "order"       smallint not null default 0,
  is_cover      boolean not null default false,
  downloaded_at timestamptz,
  created_at    timestamptz not null default now(),
  unique (listing_id, url)
);

-- Phones
create table phones (
  id             uuid primary key default gen_random_uuid(),
  listing_id     uuid not null references listings(id) on delete cascade,
  phone_e164     text not null,
  phone_display  text,
  is_rk          boolean not null default false,
  seen_count     int not null default 1,
  created_at     timestamptz not null default now(),
  unique (listing_id, phone_e164)
);

-- Known RK phones/names/handles
create table agent_blacklist (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,
  value         text not null,
  company_name  text,
  source        text,
  notes         text,
  created_at    timestamptz not null default now(),
  unique (kind, value)
);

create index agent_blacklist_value_idx on agent_blacklist (value);

-- Dedup union-find
create table dedup_clusters (
  id                    uuid primary key default gen_random_uuid(),
  canonical_listing_id  uuid not null references listings(id) on delete cascade,
  created_at            timestamptz not null default now()
);

create table dedup_edges (
  id            bigserial primary key,
  source_a      uuid not null references listing_sources(id) on delete cascade,
  source_b      uuid not null references listing_sources(id) on delete cascade,
  reason        text not null,
  score         real not null,
  created_at    timestamptz not null default now(),
  unique (source_a, source_b)
);

-- AI extraction queue
create table extraction_jobs (
  id              uuid primary key default gen_random_uuid(),
  source_id       uuid not null references listing_sources(id) on delete cascade,
  listing_id      uuid references listings(id) on delete set null,
  status          job_status not null default 'queued',
  attempts        smallint not null default 0,
  max_attempts    smallint not null default 3,
  model           text,
  prompt_version  text,
  input_hash      text,
  result          jsonb,
  error           text,
  queued_at       timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz
);

create index extraction_jobs_queue_idx
  on extraction_jobs (status, queued_at)
  where status in ('queued','failed');

-- Scrape run logs
create table scrape_runs (
  id              uuid primary key default gen_random_uuid(),
  portal_id       uuid not null references portals(id),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  status          job_status not null default 'running',
  pages_fetched   int not null default 0,
  listings_seen   int not null default 0,
  new_sources     int not null default 0,
  updated_sources int not null default 0,
  price_changes   int not null default 0,
  errors          int not null default 0,
  error_detail    jsonb
);

create index scrape_runs_portal_idx on scrape_runs (portal_id, started_at desc);

-- Broker-saved leads
create table saved_leads (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  listing_id    uuid not null references listings(id) on delete cascade,
  status        lead_status not null default 'new',
  priority      smallint,
  tag           text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, listing_id)
);

create index saved_leads_user_idx on saved_leads (user_id, created_at desc);

create table lead_notes (
  id            uuid primary key default gen_random_uuid(),
  saved_lead_id uuid not null references saved_leads(id) on delete cascade,
  user_id       uuid not null references users(id) on delete cascade,
  body          text not null,
  created_at    timestamptz not null default now()
);

-- Runtime config
create table config (
  key           text primary key,
  value         jsonb not null,
  description   text,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references users(id)
);

-- Saved searches (with optional alerts)
create table saved_searches (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  name              text not null,
  filters           jsonb not null,
  alert_enabled     boolean not null default false,
  alert_channel     text[] not null default array[]::text[], -- ['in_app','email']
  last_alerted_at   timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index saved_searches_user_idx on saved_searches (user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes on `listings` (hot path)
-- ─────────────────────────────────────────────────────────────────────────────
create index listings_active_type_op_city_price_idx
  on listings (type, operation, city, price) where is_active = true;

create index listings_geo_idx              on listings using gist (geo_point) where is_active = true;
create index listings_search_tsv_idx       on listings using gin (search_tsv);
create index listings_attributes_idx       on listings using gin (attributes jsonb_path_ops);
create index listings_first_seen_idx       on listings (first_seen_at desc) where is_active = true;
create index listings_seller_type_idx      on listings (seller_type) where is_active = true;
create index listings_phone_primary_idx    on listings (phone_primary) where phone_primary is not null;
create index listings_title_trgm_idx       on listings using gin (title gin_trgm_ops);
create index listings_price_idx            on listings (price) where is_active = true;
create index listings_size_idx             on listings (size_usable_m2) where is_active = true;
create index listings_rooms_idx            on listings (rooms) where is_active = true;
create index listings_district_idx         on listings (district) where is_active = true;
create index listings_city_district_idx    on listings (city_district) where is_active = true;
create index listings_postal_code_idx      on listings (postal_code) where is_active = true;

-- Indexes on listing_sources
create index listing_sources_listing_idx    on listing_sources (listing_id);
create index listing_sources_active_idx     on listing_sources (portal_id, is_active) where is_active = true;
create index listing_sources_last_seen_idx  on listing_sources (portal_id, last_seen_at desc);

-- Trigger: updated_at on listings / saved_leads
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger listings_updated_at before update on listings
  for each row execute function touch_updated_at();
create trigger saved_leads_updated_at before update on saved_leads
  for each row execute function touch_updated_at();
create trigger saved_searches_updated_at before update on saved_searches
  for each row execute function touch_updated_at();
