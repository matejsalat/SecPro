-- ============================================================================
-- Row Level Security policies
-- ============================================================================
-- Strategy:
--   - Service role (used by scrapers/workers) bypasses RLS automatically.
--   - Authenticated brokers can READ listings/sources/photos/prices, but
--     cannot write. Writes come from service role only.
--   - Per-user tables (saved_leads, lead_notes, saved_searches) are scoped
--     to auth.uid().
--   - Admin tables (config, scrape_runs, extraction_jobs, dedup_*) are
--     service-role only (no RLS policies = nothing authenticated sees them).

-- Enable RLS on all public tables
alter table listings              enable row level security;
alter table listing_sources       enable row level security;
alter table listings_raw_history  enable row level security;
alter table price_history         enable row level security;
alter table photos                enable row level security;
alter table phones                enable row level security;
alter table agent_blacklist       enable row level security;
alter table dedup_clusters        enable row level security;
alter table dedup_edges           enable row level security;
alter table extraction_jobs       enable row level security;
alter table scrape_runs           enable row level security;
alter table saved_leads           enable row level security;
alter table lead_notes            enable row level security;
alter table saved_searches        enable row level security;
alter table config                enable row level security;
alter table portals               enable row level security;
alter table users                 enable row level security;

-- ─── Public-read for listing data (authenticated users only) ──────────────

create policy "listings_read_authenticated" on listings
  for select to authenticated using (true);

create policy "listing_sources_read_authenticated" on listing_sources
  for select to authenticated using (true);

create policy "photos_read_authenticated" on photos
  for select to authenticated using (true);

create policy "price_history_read_authenticated" on price_history
  for select to authenticated using (true);

create policy "phones_read_authenticated" on phones
  for select to authenticated using (true);

create policy "portals_read_authenticated" on portals
  for select to authenticated using (true);

create policy "agent_blacklist_read_authenticated" on agent_blacklist
  for select to authenticated using (true);

-- ─── Per-user tables ────────────────────────────────────────────────────────

-- saved_leads
create policy "saved_leads_own_select" on saved_leads
  for select to authenticated using (user_id = auth.uid());
create policy "saved_leads_own_insert" on saved_leads
  for insert to authenticated with check (user_id = auth.uid());
create policy "saved_leads_own_update" on saved_leads
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "saved_leads_own_delete" on saved_leads
  for delete to authenticated using (user_id = auth.uid());

-- lead_notes
create policy "lead_notes_own_select" on lead_notes
  for select to authenticated using (user_id = auth.uid());
create policy "lead_notes_own_insert" on lead_notes
  for insert to authenticated with check (user_id = auth.uid());
create policy "lead_notes_own_update" on lead_notes
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "lead_notes_own_delete" on lead_notes
  for delete to authenticated using (user_id = auth.uid());

-- saved_searches
create policy "saved_searches_own_select" on saved_searches
  for select to authenticated using (user_id = auth.uid());
create policy "saved_searches_own_insert" on saved_searches
  for insert to authenticated with check (user_id = auth.uid());
create policy "saved_searches_own_update" on saved_searches
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "saved_searches_own_delete" on saved_searches
  for delete to authenticated using (user_id = auth.uid());

-- users (brokers can read/update their own row)
create policy "users_own_select" on users
  for select to authenticated using (id = auth.uid());
create policy "users_own_update" on users
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Auto-create users row on auth.users signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── Admin-only tables (no policies = service_role exclusive) ──────────────
-- Left intentionally without authenticated policies:
--   listings_raw_history, dedup_clusters, dedup_edges, extraction_jobs,
--   scrape_runs, config.
-- Only service_role key (from backend workers) can read/write these.
