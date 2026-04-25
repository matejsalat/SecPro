# SecPro — Search & Serving Architecture

Status: draft v1
Audience: backend + frontend engineers building the broker search UI
Companion doc: `docs/data-architecture.md` (not yet written — schema assumptions stated inline)

This doc specifies the search and serving layer for the SecPro Slovak real-estate aggregator CRM. The read path serves ~50–200 concurrent brokers running thousands of filtered searches per day over a canonical `listings` table of ~500k rows on Supabase Postgres + PostGIS. Hard latency target: **p95 < 500 ms** end-to-end for any filter combination, including geo and full-text. Writes (scrape ingest, dedup, canonicalization) live elsewhere and are only touched here at the index/materialized-view boundary.

The existing front end is a vanilla-JS web app; the current lead cards (`renderLeadCards`, `public/app.js:2821`) use `lc2-*` classes, Slovak labels, and inline pills for phone / location / size / €·m⁻² / market badge / duplicate badge. The new search UI inherits those primitives — this doc does not redesign the card, only the surrounding filter / list / map shell.

---

## 0. Schema assumptions

Since `data-architecture.md` is not checked in yet, we lock the following shape. If the real schema diverges, update §7 queries accordingly.

```sql
-- Canonical listing — 1 row = 1 real property, even if seen on 4 portals
CREATE TABLE listings (
  id              uuid PRIMARY KEY,
  type            text NOT NULL,        -- byt|dom|pozemok|chata|komercne
  subtype         text,                 -- 1-izb, 2-izb, ... 5+, rodinny-dom, ...
  title           text,
  description     text,

  -- Location (denormalized for index-only scans)
  country         text DEFAULT 'SK',
  region          text,                 -- kraj (e.g. "Bratislavsky")
  district        text,                 -- okres
  city            text,                 -- mesto
  city_part       text,                 -- mestska cast (Petrzalka, Zlatovce, ...)
  street          text,
  postal_code     text,
  geo_point       geography(Point,4326),

  -- Dimensions
  size_m2         numeric(8,2),
  land_m2         numeric(10,2),
  rooms           numeric(3,1),         -- 1, 1.5, 2, ..., 5 (5 = "5+")
  floor           smallint,
  floors_total    smallint,
  year_built      smallint,

  -- State
  condition       text,                 -- novostavba|zrekonstruovane|povodny|...
  energy_class    text,                 -- A+|A|B|C|D|E|F|G
  features        text[],               -- {balkon,terasa,loggia,parking,pivnica,zahrada,...}

  -- Price
  price_eur       numeric(12,2),
  price_per_m2    numeric(10,2) GENERATED ALWAYS AS (
                      CASE WHEN size_m2 > 0 THEN price_eur / size_m2 END
                  ) STORED,
  price_changed_at    timestamptz,
  price_prev_eur      numeric(12,2),

  -- Seller
  seller_type     text NOT NULL,        -- private|agency|developer
  agency_id       uuid REFERENCES agencies(id),
  phone_normalized text,                -- E.164
  has_phone       boolean GENERATED ALWAYS AS (phone_normalized IS NOT NULL) STORED,

  -- Media / quality
  photo_count     smallint DEFAULT 0,
  has_gps         boolean GENERATED ALWAYS AS (geo_point IS NOT NULL) STORED,
  completeness    smallint,             -- 0–100, computed at ingest

  -- Lifecycle
  is_active       boolean DEFAULT true,
  first_seen_at   timestamptz NOT NULL,
  last_seen_at    timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL,

  -- Ranking cache (see §3)
  rank_score      real,
  rank_computed_at timestamptz,

  -- Full-text (see §2)
  tsv             tsvector
);

-- Per-portal provenance. 1 canonical → N sources.
CREATE TABLE listing_sources (
  id              uuid PRIMARY KEY,
  listing_id      uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  portal          text NOT NULL,        -- bazos|nehnutelnosti|topreality|reality.sk|...
  source_url      text NOT NULL,
  source_price    numeric(12,2),
  first_seen_at   timestamptz,
  last_seen_at    timestamptz,
  is_active       boolean DEFAULT true,
  UNIQUE (portal, source_url)
);

-- Broker-scoped workflow state (never merged into listings)
CREATE TABLE user_listing_state (
  user_id         uuid NOT NULL,
  listing_id      uuid NOT NULL REFERENCES listings(id),
  status          text,                 -- not_contacted|in_progress|callback|rejected
  is_saved        boolean DEFAULT false,
  is_hidden       boolean DEFAULT false,
  notes           text,
  notes_tsv       tsvector,
  updated_at      timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, listing_id)
);

CREATE TABLE saved_searches (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL,
  name            text NOT NULL,
  filters         jsonb NOT NULL,       -- canonical filter dict (see §4)
  alert_channels  text[] DEFAULT '{inapp}',  -- inapp|email|push|whatsapp
  alert_frequency text DEFAULT 'realtime',    -- realtime|hourly|daily
  last_run_at     timestamptz,
  last_seen_listing_at timestamptz,     -- high-watermark for alert dedup
  created_at      timestamptz DEFAULT now()
);
```

Index set (justified in §12):

```sql
-- Hot path: active listings, sort by rank
CREATE INDEX listings_active_rank_idx
  ON listings (rank_score DESC, id)
  INCLUDE (type, city, price_eur, size_m2, rooms, seller_type)
  WHERE is_active = true;

-- Equality-heavy filter combos
CREATE INDEX listings_type_city_rooms_idx  ON listings (type, city, rooms) WHERE is_active;
CREATE INDEX listings_city_price_idx       ON listings (city, price_eur)   WHERE is_active;
CREATE INDEX listings_seller_type_idx      ON listings (seller_type)        WHERE is_active;
CREATE INDEX listings_features_gin         ON listings USING gin (features) WHERE is_active;
CREATE INDEX listings_tsv_gin              ON listings USING gin (tsv)      WHERE is_active;
CREATE INDEX listings_geo_gist             ON listings USING gist (geo_point) WHERE is_active;
CREATE INDEX listings_first_seen_idx       ON listings (first_seen_at DESC) WHERE is_active;
CREATE INDEX listings_price_changed_idx    ON listings (price_changed_at DESC) WHERE is_active AND price_changed_at IS NOT NULL;

-- Workflow
CREATE INDEX user_state_user_saved_idx ON user_listing_state (user_id) WHERE is_saved;
CREATE INDEX user_state_user_hidden_idx ON user_listing_state (user_id) WHERE is_hidden;
CREATE INDEX user_notes_tsv_idx ON user_listing_state USING gin (notes_tsv);
```

---

## 1. Filter catalog

All filters ship as keys in a single `filters` JSON object posted to `/api/listings/search` (§4). The server translates each key to a SQL predicate through a **whitelist translator** (§13). Unknown keys are dropped silently with a 200-level warning in the response envelope.

### 1.1 Location

| Key | Type | Default | Range/enum | SQL pseudocode |
|---|---|---|---|---|
| `region` | string[] | — | enum kraj | `region = ANY($1)` |
| `district` | string[] | — | enum okres | `district = ANY($1)` |
| `city` | string[] | — | free | `city = ANY($1)` |
| `city_part` | string[] | — | free | `city_part = ANY($1)` |
| `exclude_city_part` | string[] | — | free | `(city_part IS NULL OR NOT (city_part = ANY($1)))` |
| `radius` | `{lat, lng, km}` | — | km 1–100 | `ST_DWithin(geo_point, ST_MakePoint($lng,$lat)::geography, $km*1000)` |
| `polygon` | GeoJSON Polygon | — | ≤50 vertices | `ST_Within(geo_point::geometry, ST_GeomFromGeoJSON($1))` |
| `bbox` | `[w,s,e,n]` | — | — | `geo_point && ST_MakeEnvelope(w,s,e,n,4326)` |

Use `bbox` for map viewport fetches (cheap), `radius`/`polygon` for explicit broker intent.

### 1.2 Property

| Key | Type | Default | Range | SQL |
|---|---|---|---|---|
| `type` | string[] | — | byt/dom/pozemok/chata/komercne | `type = ANY($1)` |
| `subtype` | string[] | — | 1-izb..5+, ... | `subtype = ANY($1)` |
| `size_m2` | `[min,max]` | — | 10–10 000 | `size_m2 BETWEEN $min AND $max` |
| `land_m2` | `[min,max]` | — | 0–1e6 | `land_m2 BETWEEN ...` |
| `rooms` | `[min,max]` | — | 1–10 | `rooms BETWEEN ...` |
| `floor` | `[min,max]` | — | -2–50 | `floor BETWEEN ...` |
| `condition` | string[] | — | enum | `condition = ANY($1)` |
| `energy_class` | string[] | — | A+..G | `energy_class = ANY($1)` |
| `year_built` | `[min,max]` | — | 1800–currentYear | `year_built BETWEEN ...` |
| `features_all` | string[] | — | enum | `features @> $1` |
| `features_any` | string[] | — | enum | `features && $1` |

### 1.3 Price

| Key | Type | SQL |
|---|---|---|
| `price_eur` | `[min,max]` | `price_eur BETWEEN $min AND $max` |
| `price_per_m2` | `[min,max]` | `price_per_m2 BETWEEN $min AND $max` |
| `price_drop_pct` | number (e.g. 10) | `(price_prev_eur - price_eur) / price_prev_eur >= $1/100.0` |
| `price_drop_days` | integer | `price_changed_at >= now() - ($1 \|\| ' days')::interval` |

### 1.4 Seller

| Key | Type | SQL |
|---|---|---|
| `seller_type` | string[] | `seller_type = ANY($1)` — typical broker pick: `['private']` |
| `agency_ids` | uuid[] | `agency_id = ANY($1)` |
| `has_phone` | boolean | `has_phone = $1` |

The **private-sellers filter is the most load-bearing in the whole app** — it is what makes SecPro differ from portal search, so we pre-materialize a partial index and include `seller_type` in the composite covering index.

### 1.5 Freshness

| Key | Type | SQL |
|---|---|---|
| `first_seen_within_days` | int | `first_seen_at >= now() - make_interval(days => $1)` |
| `updated_within_days` | int | `updated_at >= now() - make_interval(days => $1)` |
| `never_seen_by_user` | bool | `NOT EXISTS (SELECT 1 FROM user_listing_state WHERE user_id=$uid AND listing_id=l.id)` |

### 1.6 Data quality

| Key | Type | SQL |
|---|---|---|
| `min_photos` | int, default 0 | `photo_count >= $1` |
| `has_gps` | bool | `has_gps = $1` |
| `has_energy_class` | bool | `energy_class IS NOT NULL` |
| `has_size` | bool | `size_m2 IS NOT NULL` |

### 1.7 Broker workflow (user-scoped, LEFT JOIN `user_listing_state`)

| Key | Type | SQL |
|---|---|---|
| `status` | string[] | `uls.status = ANY($1)` |
| `saved` | bool | `uls.is_saved = true` |
| `hidden` | bool-trilean | default excludes hidden; `true` = only hidden; `include` = both |
| `notes_query` | string | `uls.notes_tsv @@ websearch_to_tsquery('simple', $1)` |

### 1.8 Free-text

| Key | Type | SQL |
|---|---|---|
| `q` | string | `tsv @@ websearch_to_tsquery('slovak_unaccent', $1)` (plus parsed-out filters, see §2) |

---

## 2. Full-text search UX

### 2.1 Parsing the query

The search box accepts free Slovak text like `2-izbový Petržalka balkón do 200k súkromný`. A thin deterministic parser (no LLM on the hot path) runs client-side and server-side identically, producing a **FilterEnvelope**:

```json
{
  "raw": "2-izbový Petržalka balkón do 200k súkromný",
  "parsed": {
    "subtype": ["2-izb"],
    "city_part": ["Petržalka"],
    "features_all": ["balkon"],
    "price_eur": [null, 200000],
    "seller_type": ["private"]
  },
  "residual_q": ""
}
```

Parser rules (priority top-down):

1. **Number-izb** — `/(\d)[\s-]?iz(b|bov)/i` → `subtype`
2. **Price** — `do 200k|do 200 000|pod 200k` → `price_eur[1]`; `od 150k` → `price_eur[0]`
3. **Seller** — `súkrom(ný|ník|ne)` → `seller_type=['private']`; `RK|realitka|agent(úra)?` → `['agency']`
4. **Feature dictionary** — exact tokens against `features` enum (`balkón`, `terasa`, `parking`, `pivnica`, `záhrada`, …), unaccented compare
5. **Location lookup** — left-over tokens probed against a compiled trie of `region / district / city / city_part / street`. Longest match wins. Ambiguous matches (e.g. "Nitra" = kraj and mesto) resolve to the most specific level with an "uncertain" flag.
6. **Residual** → `residual_q`, fed to `tsv` match.

The parsed filters render as **editable chips** above the results grid. Each chip shows its source token and has an × to remove; removing a chip re-adds its token to `residual_q` so the search never silently loses intent.

### 2.2 tsvector configuration

```sql
CREATE TEXT SEARCH CONFIGURATION slovak_unaccent ( COPY = simple );
ALTER TEXT SEARCH CONFIGURATION slovak_unaccent
  ALTER MAPPING FOR hword, hword_part, word WITH unaccent, simple;

-- Trigger-maintained tsv
CREATE FUNCTION listings_tsv_update() RETURNS trigger AS $$
BEGIN
  NEW.tsv :=
      setweight(to_tsvector('slovak_unaccent', coalesce(NEW.title,'')),       'A') ||
      setweight(to_tsvector('slovak_unaccent', coalesce(NEW.city,'')),        'B') ||
      setweight(to_tsvector('slovak_unaccent', coalesce(NEW.city_part,'')),   'B') ||
      setweight(to_tsvector('slovak_unaccent', coalesce(NEW.street,'')),      'C') ||
      setweight(to_tsvector('slovak_unaccent', coalesce(NEW.description,'')), 'D');
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_listings_tsv BEFORE INSERT OR UPDATE
  ON listings FOR EACH ROW EXECUTE FUNCTION listings_tsv_update();
```

A proper Slovak stemmer is not in stock Postgres. `simple + unaccent` handles 90 % of broker queries (short tokens, place names, feature words). Heavier morphology is deferred to phase 2 (possible candidates: `pg_hunspell` with a Slovak dictionary or an external Meilisearch mirror).

### 2.3 Ranking signal from FTS

`ts_rank_cd(tsv, query, 32)` is **only** a tiebreaker inside the same `rank_score` bucket; it does not override the business ranking (§3).

---

## 3. Ranking algorithm

Brokers want leads in *lead-quality* order, not portal order. We compute `rank_score ∈ [0,1]` daily (and on every listing write) and store it on the row so the hot query is `ORDER BY rank_score DESC`.

### 3.1 Formula

```
rank_score =
    0.30 * freshness
  + 0.20 * price_quality
  + 0.10 * completeness
  + 0.20 * seller_bonus
  + 0.15 * phone_bonus
  + 0.05 * photo_bonus
```

Sum of weights = 1.00. Each sub-score is normalized to [0,1].

**freshness** — exponential decay on age:
```
age_h = EXTRACT(EPOCH FROM (now() - first_seen_at)) / 3600
freshness = exp(-age_h / 72)    -- half-life ≈ 50 h; new <24h ≈ 0.72+
```

**price_quality** — how far below the city × type median price-per-m²:
```
pct_delta = (city_type_median_ppm - price_per_m2) / city_type_median_ppm
price_quality = clamp((pct_delta + 0.05) / 0.30, 0, 1)
-- 5 % below median → 0.33; 20 % below → 0.83; 30 %+ → 1.0
```
`city_type_median_ppm` comes from the materialized view `mv_city_type_stats` (§12).

**completeness** — already stored as 0–100, divided by 100.

**seller_bonus** — 1 if `seller_type='private'`, 0.3 if `agency`, 0 if `developer`. This encodes the SecPro thesis that private sellers are the high-value signal; tune per tenant.

**phone_bonus** — 1 if `has_phone`, else 0.

**photo_bonus** — `LEAST(photo_count / 10.0, 1.0)`.

### 3.2 User-specific boost (query-time)

Per-broker personalization is *not* baked into stored `rank_score` (would require one score per user × listing — 100 k × 500 k). Instead it is applied as a small **additive re-rank** in the WHERE-narrowed candidate set:

```sql
rank_score
  + CASE WHEN l.type = any_user_preferred_type($uid) THEN 0.05 ELSE 0 END
  + CASE WHEN l.city = any_user_preferred_city($uid) THEN 0.05 ELSE 0 END
```

where `user_preferred_*` comes from an aggregate over `user_listing_state` joined with `listings`, refreshed nightly into `user_preferences` per broker. Because it only moves scores by ≤0.10 it does not require re-ordering the whole index; the top-200 rows returned by the stored `rank_score` order get re-sorted in memory.

### 3.3 Recompute policy

- On INSERT/UPDATE of a listing: recompute that row (cheap).
- Nightly cron at 02:00 CET: full refresh of `mv_city_type_stats`, then UPDATE listings SET rank_score = ... in batches of 10 k (keeps freshness accurate — without this, `freshness` decays only when the row is otherwise touched).

---

## 4. API endpoint design

All endpoints served via Supabase Postgres RPC behind a thin Node.js edge function (Vercel) that handles auth, rate-limiting, caching and response shaping. Auth: Supabase JWT, `Authorization: Bearer …`.

### 4.1 `POST /api/listings/search`

**Request**
```json
{
  "filters": {
    "type": ["byt"],
    "rooms": [2, 3],
    "city": ["Bratislava"],
    "price_eur": [150000, 300000],
    "seller_type": ["private"],
    "q": "balkón Petržalka"
  },
  "sort": "rank_desc",
  "pagination": { "cursor": null, "limit": 20 },
  "include_facets": true,
  "map_bbox": null
}
```

`sort` ∈ `rank_desc | price_asc | price_desc | size_desc | first_seen_desc | price_per_m2_asc | distance_asc` (last one only valid with `filters.radius`).

**Response**
```json
{
  "results": [
    {
      "id": "…",
      "type": "byt", "subtype": "2-izb",
      "title": "2-izb. byt Petržalka, 58 m²",
      "city": "Bratislava", "city_part": "Petržalka",
      "price_eur": 189000, "price_per_m2": 3259,
      "size_m2": 58, "rooms": 2,
      "seller_type": "private", "has_phone": true, "phone_masked": "+421 9•• ••• •21",
      "photo_count": 12, "first_seen_at": "2026-04-22T08:11:00Z",
      "rank_score": 0.78, "market_position": "below_median",
      "sources": [
        {"portal":"bazos","url":"https://…","price":189000},
        {"portal":"nehnutelnosti","url":"https://…","price":195000}
      ],
      "user_state": {"status":null,"is_saved":false,"is_hidden":false}
    }
  ],
  "total_count": 1247,
  "next_cursor": "eyJzIjowLjc3OCwiaWQiOiIuLi4ifQ==",
  "facets": { … see §5 … },
  "warnings": []
}
```

**Auth** — required. `user_state`, `phone_masked` unmask rules differ (§13).
**Rate limit** — 30 req / min / user (§13).
**Cache** — edge cache keyed by `sha1(user_id + canonical(filters) + sort + cursor)` for **60 s** (popular broker queries repeat heavily). Bypass when `filters.q` is present and non-empty (low hit rate, dilutes cache).

### 4.2 `GET /api/listings/:id`

Returns the full canonical row + all `listing_sources`, including each source's independent price (enables the "180k on bazos vs 195k on topreality" display, §11). Auth required. Cached 5 min at edge.

### 4.3 Saved searches

```
POST /api/listings/saved-searches
  { name, filters, alert_channels, alert_frequency }
GET  /api/listings/saved-searches
DELETE /api/listings/saved-searches/:id

GET  /api/listings/alerts?since=iso8601
  → { alerts: [{saved_search_id, listing: {...}, matched_at}, ...] }
POST /api/listings/alerts/:id/ack
  → marks alert read (flips in-app badge)
```

Auth required on all. No public/anonymous path anywhere in the search layer.

### 4.4 Map viewport fetch

```
POST /api/listings/map
  { filters: {...}, bbox: [w,s,e,n], zoom: 12, cluster: true }
  → { clusters: [{lat,lng,count,price_median}], points: [{id,lat,lng,price_eur}] }
```

Returns clusters if `zoom < 14` (server-side clustering via ST_ClusterDBSCAN), raw points otherwise. Capped at 2 000 points per response; if more match, return `truncated: true` and ask the user to zoom.

---

## 5. Facets

Brokers live in the sidebar — facets drive the "why is this list so short?" intuition. We compute facets in **one query** alongside the main results using `GROUPING SETS`, so we pay one index scan for both.

```sql
WITH filtered AS (
  SELECT * FROM listings WHERE is_active = true AND {...all filters except the one being faceted...}
)
SELECT
  grouping_id(city, type, seller_type) AS grp,
  city, type, seller_type,
  COUNT(*) AS n,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY price_eur) AS p50_price,
  AVG(size_m2) AS avg_size
FROM filtered
GROUP BY GROUPING SETS ( (city), (type), (seller_type), () );
```

Delivered as:
```json
"facets": {
  "total": 1247,
  "by_city":        [{"value":"Bratislava","count":812}, ...],
  "by_type":        [{"value":"byt","count":903}, {"value":"dom","count":201}, ...],
  "by_seller_type": [{"value":"private","count":492}, {"value":"agency","count":755}],
  "price_histogram":[{"bucket":"0-100k","count":132}, ...]
}
```

**Important — facet drop rule.** When computing a facet for dimension `D`, we drop `D`'s own filter from the WHERE clause. This makes the UI behave the Airbnb way ("you picked Bratislava; here are alternative cities with counts"). Implementation: the edge function composes 3–4 smaller facet queries in parallel rather than one giant GROUPING SETS when filter interaction gets complex. Each facet query hits an index-only scan and returns in <30 ms at 500 k rows.

---

## 6. Pagination

**OFFSET is banned.** At 500 k rows, `OFFSET 5000 LIMIT 20` scans 5020 rows and sorts every page.

### 6.1 Keyset cursor

For `sort = rank_desc`, cursor = base64(`{"s": rank_score, "id": id}`):
```sql
WHERE is_active = true
  AND {...filters...}
  AND (rank_score, id) < ($cursor_score, $cursor_id)
ORDER BY rank_score DESC, id DESC
LIMIT 20;
```
`(rank_score, id)` is a stable total order — `id` breaks ties so two listings with identical rank never confuse the cursor.

Per sort mode:

| sort | cursor tuple |
|---|---|
| `rank_desc` | `(rank_score, id)` |
| `price_asc` | `(price_eur, id)` |
| `price_desc` | `(price_eur, id)` (reversed comparator) |
| `first_seen_desc` | `(first_seen_at, id)` |
| `distance_asc` | `(distance_m, id)` — computed in the query, carried forward |

### 6.2 Page size

Default 20, max 50. Map view uses its own pagination (capped at 2 000 points).

### 6.3 Total count

`total_count` is computed once when `cursor == null` via a parallel `COUNT(*)` over the same filtered CTE; re-used across subsequent pages by stashing it in the cursor payload so we don't re-count on every "load more".

---

## 7. SQL query patterns

All queries assume `SET LOCAL statement_timeout = '2s';` at the RPC entrypoint to protect the pool.

### 7.1 Basic multi-filter

```sql
-- 2-izbové byty v Bratislave, 150–300k, len súkromný
SELECT id, title, city, city_part, price_eur, price_per_m2, size_m2, rooms,
       seller_type, has_phone, photo_count, first_seen_at, rank_score
FROM listings
WHERE is_active = true
  AND type = 'byt'
  AND rooms BETWEEN 2 AND 2
  AND city = 'Bratislava'
  AND price_eur BETWEEN 150000 AND 300000
  AND seller_type = 'private'
ORDER BY rank_score DESC, id DESC
LIMIT 20;
```

### 7.2 Geo radius + distance sort

```sql
-- 10 km around Námestie Slobody, sorted by distance
WITH center AS (SELECT ST_MakePoint(17.1074, 48.1486)::geography AS p)
SELECT l.id, l.title, l.price_eur, l.size_m2,
       ST_Distance(l.geo_point, c.p) AS distance_m
FROM listings l, center c
WHERE l.is_active = true
  AND l.type = 'byt'
  AND ST_DWithin(l.geo_point, c.p, 10000)
ORDER BY distance_m ASC, l.id DESC
LIMIT 20;
```

### 7.3 Polygon draw + feature requirement

```sql
SELECT id, title, price_eur, size_m2
FROM listings
WHERE is_active = true
  AND ST_Within(geo_point::geometry, ST_GeomFromGeoJSON($1))
  AND features @> ARRAY['balkon','parking']
ORDER BY rank_score DESC, id DESC
LIMIT 20;
```

### 7.4 Exclude a city_part

```sql
-- Trenčín celý, ale nie Zlatovce
SELECT ...
FROM listings
WHERE is_active = true
  AND city = 'Trenčín'
  AND (city_part IS DISTINCT FROM 'Zlatovce')
ORDER BY rank_score DESC, id DESC
LIMIT 20;
```

### 7.5 Price-drop filter

```sql
-- ≥10 % pokles v posledných 14 dňoch
SELECT id, title, price_eur, price_prev_eur,
       ROUND((price_prev_eur - price_eur) / price_prev_eur * 100, 1) AS drop_pct
FROM listings
WHERE is_active = true
  AND price_changed_at >= now() - interval '14 days'
  AND price_prev_eur > 0
  AND (price_prev_eur - price_eur) / price_prev_eur >= 0.10
ORDER BY drop_pct DESC, id DESC
LIMIT 20;
```

### 7.6 Full-text + structured

```sql
-- "balkón Petržalka", parser extracted city_part + feature,
-- residual_q was "" so q clause dropped.
SELECT id, title, price_eur, rank_score
FROM listings
WHERE is_active = true
  AND type = 'byt'
  AND city_part = 'Petržalka'
  AND features @> ARRAY['balkon']
ORDER BY rank_score DESC, id DESC
LIMIT 20;

-- With residual q:
SELECT id, title, ts_rank_cd(tsv, q) AS fts_rank, rank_score
FROM listings,
     websearch_to_tsquery('slovak_unaccent', 'vysoké stropy') q
WHERE is_active = true
  AND city = 'Bratislava'
  AND tsv @@ q
ORDER BY rank_score DESC, fts_rank DESC, id DESC
LIMIT 20;
```

### 7.7 User-workflow filter (LEFT JOIN)

```sql
-- Uložené leadovi s statusom 'callback' a ktoré nie sú skryté
SELECT l.*, uls.status, uls.notes
FROM listings l
JOIN user_listing_state uls ON uls.listing_id = l.id AND uls.user_id = $uid
WHERE l.is_active = true
  AND uls.is_saved = true
  AND uls.status = 'callback'
  AND uls.is_hidden = false
ORDER BY uls.updated_at DESC
LIMIT 20;
```

### 7.8 Cursor pagination (rank_desc)

```sql
SELECT id, rank_score, title, price_eur
FROM listings
WHERE is_active = true
  AND type = 'byt'
  AND city = 'Bratislava'
  AND (rank_score, id) < ($1, $2::uuid)   -- cursor
ORDER BY rank_score DESC, id DESC
LIMIT 20;
```

### 7.9 Map viewport + server-side clustering

```sql
WITH viewport AS (
  SELECT l.id, l.geo_point, l.price_eur,
         ST_ClusterDBSCAN(l.geo_point::geometry, eps := 0.005, minpoints := 4)
            OVER () AS cluster_id
  FROM listings l
  WHERE l.is_active = true
    AND l.geo_point && ST_MakeEnvelope($w,$s,$e,$n,4326)
    AND l.type = ANY($types)
)
SELECT cluster_id,
       COUNT(*) AS n,
       ST_Y(ST_Centroid(ST_Collect(geo_point::geometry))) AS lat,
       ST_X(ST_Centroid(ST_Collect(geo_point::geometry))) AS lng,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY price_eur) AS p50
FROM viewport
WHERE cluster_id IS NOT NULL
GROUP BY cluster_id
UNION ALL
SELECT NULL, 1, ST_Y(geo_point::geometry), ST_X(geo_point::geometry), price_eur
FROM viewport WHERE cluster_id IS NULL;
```

### 7.10 Facets in one pass

```sql
WITH f AS (
  SELECT * FROM listings
  WHERE is_active = true
    AND type = ANY($types)
    AND price_eur BETWEEN $pmin AND $pmax
)
SELECT 'city'        AS dim, city        AS value, COUNT(*) FROM f GROUP BY city
UNION ALL SELECT 'type',        type,         COUNT(*) FROM f GROUP BY type
UNION ALL SELECT 'seller_type', seller_type,  COUNT(*) FROM f GROUP BY seller_type;
```

### 7.11 New listings for saved search (alerts cron)

```sql
-- For a saved_search with filters={type:'byt',city:'Bratislava',...}
-- Find listings matching filters first_seen_at > last_run_at
WITH matched AS (
  SELECT l.id, l.first_seen_at
  FROM listings l
  WHERE l.is_active = true
    AND l.first_seen_at > $last_run_at
    AND l.type = 'byt' AND l.city = 'Bratislava' AND l.seller_type = 'private'
)
INSERT INTO alert_deliveries (saved_search_id, listing_id, matched_at)
SELECT $ss_id, id, first_seen_at FROM matched
ON CONFLICT (saved_search_id, listing_id) DO NOTHING
RETURNING listing_id;
```

### 7.12 EXPLAIN walkthrough — query 7.1

Expected plan on 500 k rows, filter selectivity ~2 % (≈10 k rows pre-sort):

```
Limit  (cost=0.42..15.8 rows=20 width=...) (actual time=0.08..2.1 rows=20)
  -> Index Scan using listings_active_rank_idx on listings l
       (cost=0.42..7820 rows=9900 width=...)
       Index Cond: (is_active = true)
       Filter: (type='byt' AND rooms=2 AND city='Bratislava'
                AND price_eur BETWEEN 150000 AND 300000
                AND seller_type='private')
       Rows Removed by Filter: 180
Planning Time: 0.32 ms
Execution Time: 2.4 ms
```

Reading this: the composite covering index is walked in `rank_score DESC` order. The Filter clause runs on index-included columns so no heap fetch is needed for the rejected rows. We stop as soon as we collect 20 matching tuples — for common filters that costs walking 200–500 index entries. If filter selectivity drops below 0.1 % (rare cities), the planner may prefer `listings_city_price_idx` + sort; verify with `EXPLAIN (ANALYZE, BUFFERS)` on the slowest common query each release.

---

## 8. Caching strategy

Three layers, each with clear TTL + invalidation rules.

### 8.1 Postgres

- **Prepared statements** for every compiled filter template (up to 128 per pool). Saves ~0.3 ms of planning per query at p95.
- **pgbouncer transaction pooling** (Supabase default).
- **Materialized views**: `mv_city_type_stats`, `mv_top_cities`, `mv_agency_stats` — REFRESH MATERIALIZED VIEW CONCURRENTLY nightly at 02:30 CET.

### 8.2 Edge / app layer (Upstash Redis)

| Key | TTL | Invalidated by |
|---|---|---|
| `search:{user_id}:{sha(filters,sort,cursor)}` | 60 s | soft TTL only |
| `listing:{id}` (full canonical + sources) | 300 s | listing UPDATE event via LISTEN/NOTIFY → DEL |
| `facets:{sha(filters)}` | 120 s | soft TTL |
| `saved_search_results:{ss_id}:latest` | 60 s | new listing matching filters |
| `ratelimit:{user_id}:{minute}` | 70 s | self-expire |

Cache key hashing uses a **canonicalizer**: sort object keys, drop nulls, lowercase enum values, so `{type:["byt"],rooms:[2,3]}` and `{rooms:[2,3],type:["byt"]}` hash identically.

Invalidation strategy: short TTLs dominate because ingestion is continuous (new scrapes every 5–15 min per portal). We do **not** try to invalidate every search cache on every listing write — that would shred the hit rate. Instead: 60 s TTL matches the scrape cadence, and a single `listing:{id}` targeted DEL keeps the detail page correct.

### 8.3 CDN (Vercel Edge)

- `GET /api/public/top-cities` — list of (city, listing_count, median_price). 1 h TTL. Used by the city autocomplete.
- `GET /api/public/feature-dict` — list of `features` enum values, localized labels. 24 h TTL.
- Nothing listing-specific goes on CDN.

### 8.4 Client / localStorage

- Last 10 executed search bodies → quick-redo dropdown.
- Last viewport bbox per user → map opens on their last view.
- Saved-search names list, mirror of server; refreshed on login and after any `POST /saved-searches`.

---

## 9. Map view

### 9.1 Library choice — **MapLibre GL JS** (vector tiles)

Compared:

| | Mapbox GL | MapLibre GL | Leaflet | Google |
|---|---|---|---|---|
| Cost at scale | $ per map load | free, OSS fork | free | $ + attribution |
| Vector tiles / smooth zoom | ✓ | ✓ | only with plugin | ✓ |
| Clustering | ✓ built-in | ✓ built-in | plugin | ✓ |
| Heatmap layer | ✓ | ✓ | plugin | limited |
| SK/CZ POI quality | good | good (OSM) | good (OSM) | best |
| Already in stack | no | no | no | no |

Pick **MapLibre GL + OpenMapTiles** (self-hosted or via Stadia/Protomaps free tier). Zero per-map-load cost, same feature set as Mapbox, attribution-friendly for a B2B SaaS. Leaflet is fine but raster-tile UX feels dated next to Airbnb/Idealista, which brokers compare us against.

### 9.2 Data flow

1. User pans/zooms → debounce 250 ms → emit `{bbox, zoom, filters}`.
2. Client calls `POST /api/listings/map` (§4.4).
3. Server picks cluster vs. point mode from `zoom`:
   - `zoom < 10`: always cluster (country-level).
   - `10 ≤ zoom < 14`: cluster with `ST_ClusterDBSCAN` (§7.9).
   - `zoom ≥ 14`: raw points, cap 2 000.
4. MapLibre renders. Cluster click → fly-to & re-fetch.
5. Heatmap toggle: same query, but client feeds points into MapLibre `heatmap` layer with `heatmap-weight = price_per_m2`.

### 9.3 Split view sync

The map and the list share the same `filters` object. Panning the map adds a `bbox` filter to the list query, so the list always shows "what you see". A "Lock bbox" checkbox lets brokers pin the list while scrolling the map.

---

## 10. Saved searches & alerts

### 10.1 Schema (recap)

`saved_searches` (see §0) + delivery log:

```sql
CREATE TABLE alert_deliveries (
  id               uuid PRIMARY KEY,
  saved_search_id  uuid REFERENCES saved_searches(id) ON DELETE CASCADE,
  listing_id       uuid REFERENCES listings(id),
  matched_at       timestamptz NOT NULL,
  channels_sent    text[] DEFAULT '{}',
  read_at          timestamptz,
  UNIQUE (saved_search_id, listing_id)   -- dedup guarantee
);
CREATE INDEX alert_deliveries_ss_unread_idx
  ON alert_deliveries (saved_search_id, matched_at DESC) WHERE read_at IS NULL;
```

The `UNIQUE (saved_search_id, listing_id)` is the whole dedup story — a listing can match one saved search exactly once, regardless of how many times the cron runs.

### 10.2 Flow

```
cron tick (every 5 min)
  └── for each saved_search WHERE alert_frequency='realtime'
        AND last_run_at < now() - interval '4 min':
        ├── translate filters → SQL (§1)
        ├── append  WHERE first_seen_at > last_run_at
        ├── INSERT ... ON CONFLICT DO NOTHING into alert_deliveries
        └── UPDATE saved_searches SET last_run_at = now()

fanout worker (listens on pg_notify('alert_inserted', id))
  ├── look up channels_sent of alert_deliveries row
  ├── for each channel in saved_search.alert_channels not yet sent:
  │     - inapp: increment user badge counter (Redis INCR), WS push
  │     - email: Resend / SES batch every 15 min
  │     - push / whatsapp: phase 2
  └── UPDATE alert_deliveries SET channels_sent = channels_sent || $channel
```

Hourly / daily alerts use a second cron that buckets matches and sends one digest email per user per bucket.

### 10.3 Guardrails

- Max **20 saved searches per broker** (UI enforces; DB CHECK trigger as belt-and-braces).
- If a saved search would match >500 new listings in one tick, clamp to top-500 by `rank_score` and flag the search as "too broad — narrow filters?" in the UI.
- Alerts never fire for listings where `user_listing_state.is_hidden = true`.

---

## 11. Duplicate grouping UX

STRICT dedup is a product promise — the list shows 1 canonical card per real property.

### 11.1 Card UX (consistent with existing `lc2-*` styling)

- Main card = canonical (§0). All existing pills (phone, location, size, €/m², market badge, status) render unchanged.
- A new pill **"Aj na N portáloch"** (sibling of the existing `lc-dup-badge` used for heuristic duplicate detection in `renderLeadCards`). Click opens an inline panel (not a modal — fits the glassmorphism aesthetic of the app) listing each `listing_sources` row:
  ```
  ┌─ Zdroje ────────────────────────────────────┐
  │ bazos.sk          180 000 €   pred 3 dňami ↗│
  │ nehnutelnosti.sk  195 000 €   pred 1 dňom  ↗│
  │ topreality.sk     189 000 €   pred 5 h     ↗│
  └─────────────────────────────────────────────┘
  ```
- If source prices disagree by >3 %, show a secondary badge **"Rozptyl cien 8 %"** in the existing market-badge slot style (tooltip = "Najnižšia 180k na bazos, najvyššia 195k na nehnutelnosti — priestor na vyjednávanie"). This is the broker's actual alpha and deserves prominence.

### 11.2 Admin split-cluster flow

If the dedup algo wrongly merged two distinct properties, the broker sees a **"Toto nie je rovnaká nehnuteľnosť"** action in the sources panel. This posts to:

```
POST /api/admin/listings/:id/split
  { source_ids: ["...","..."], reason: "different_floor" }
```

which moves the indicated `listing_sources` rows off the canonical and re-runs canonicalization on just them, creating a new canonical. Logged to `dedup_audit` for ML retraining. Only users with `role='admin'` or `role='senior_broker'` can call this.

---

## 12. Performance optimizations

Beyond the indexes in §0:

### 12.1 Materialized views

```sql
CREATE MATERIALIZED VIEW mv_city_type_stats AS
SELECT city, type,
       COUNT(*) AS n,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY price_per_m2) AS median_ppm,
       AVG(price_eur) AS avg_price
FROM listings
WHERE is_active AND price_per_m2 BETWEEN 200 AND 15000
GROUP BY city, type;
CREATE UNIQUE INDEX ON mv_city_type_stats (city, type);
```
Powers the `price_quality` ranking factor and the `Dobrá cena` market badge. REFRESH CONCURRENTLY nightly.

### 12.2 Partial indexes

Every hot index filters on `WHERE is_active = true`. Dormant listings (~30 % of table over time) drop out of index size → ~40 % smaller indexes, faster scans, warmer cache.

### 12.3 Covering indexes (INCLUDE)

`listings_active_rank_idx` (§0) is index-only for 90 % of list queries — Postgres never touches the heap unless the user picks a rare column like `description` or `features`. Measured on 500 k rows: 2–4 ms p50 hot, 8–12 ms cold.

### 12.4 Denormalization

`city`, `district`, `region` live on `listings` instead of a FK lookup. The normalization cost is accepted because (a) these are slowly-changing dimensions, (b) the index-only scan depends on it, (c) every filter query touches them.

### 12.5 Connection pooling

Supabase's pgbouncer in transaction mode. App uses prepared statements via `pg-promise` with the `preparedStatement` flag. Pool size: 15 per edge region.

### 12.6 LISTEN/NOTIFY cache busting

```sql
CREATE TRIGGER listings_notify AFTER UPDATE OR INSERT OR DELETE ON listings
  FOR EACH ROW EXECUTE FUNCTION pg_notify_row_change();
```
Node worker subscribes, issues targeted `DEL listing:{id}` in Redis. Keeps detail-page cache coherent without inventing a cache-tag system.

### 12.7 Query budget

Every query has a `SET LOCAL statement_timeout = '2s'`. A runaway query never starves the pool. Timeouts are surfaced as a 503 with `warnings: ["search_timeout_try_narrower_filters"]`.

---

## 13. Security & abuse

### 13.1 Filter whitelist

Filters arrive as JSON. The edge function walks the dict against a hard-coded schema (§1). Unknown keys → dropped with a warning in response. Operator mapping is switch/case, never string concatenation. Parameters go through `pg-promise` named binding; **no dynamic SQL assembly** touches user input.

### 13.2 Rate limits

- Search: **30 req/min/user** (token bucket in Redis).
- Detail: 120 req/min/user.
- Map: 60 req/min/user.
- Saved-search CRUD: 10 req/min/user.
- Exceeding → 429 with `Retry-After`.

### 13.3 PII — phone numbers

`phone_normalized` is never returned in list responses; the listing card exposes `phone_masked = "+421 9•• ••• •21"` (last 2 digits). The full number is only returned via `GET /api/listings/:id` and only if the caller's role is `broker` or above. Scraping-style clients (hitting detail endpoint >100× in 10 min) are auto-rate-limited to 1/min on the detail endpoint and flagged.

### 13.4 Audit log

```sql
CREATE TABLE search_audit (
  id           bigserial PRIMARY KEY,
  user_id      uuid,
  action       text,   -- search|view|save|export
  filters      jsonb,
  result_count integer,
  ip           inet,
  created_at   timestamptz DEFAULT now()
);
CREATE INDEX search_audit_user_day_idx ON search_audit (user_id, created_at);
```
Partitioned monthly. Retained 12 months for GDPR compliance & internal misuse investigation.

### 13.5 RLS

Supabase RLS on `user_listing_state`, `saved_searches`, `alert_deliveries`: row visible only to its `user_id`. `listings` is readable by any authenticated user. No anonymous listing read — every broker must sign in.

---

## 14. Frontend UI sketch

The search screen replaces the current "Leady" tab when `?mode=search`. Layout (desktop, ≥1280 px):

```
┌──────────────────────────────────────────────────────────────────────────┐
│  [🔍 Hľadať: "2-izbový Petržalka balkón…"]   [Uložené hľadania ▾]  [🔔3] │
│  chips: [2-izb ×] [Petržalka ×] [balkón ×] [do 200k ×] [súkromný ×]      │
├────────────┬─────────────────────────────────────────────┬───────────────┤
│            │                                             │               │
│ FILTRE     │  Výsledky (1 247)                           │   Mapa        │
│ ▸ Lokalita │  ┌───────────────┐  ┌───────────────┐       │   [MapLibre]  │
│ ▸ Typ      │  │ lc2 card      │  │ lc2 card      │       │   clusters    │
│ ▸ Cena     │  │ (existing)    │  │ (existing)    │       │   + heatmap   │
│ ▸ Predajca │  └───────────────┘  └───────────────┘       │               │
│ ▸ Stav     │  ┌───────────────┐  ┌───────────────┐       │               │
│ ▸ Kvalita  │  │ …             │  │ …             │       │               │
│ ▸ Môj CRM  │  └───────────────┘  └───────────────┘       │               │
│            │   [Načítať ďalšie 20]                       │               │
├────────────┴─────────────────────────────────────────────┴───────────────┤
│  [💾 Uložiť toto hľadanie]  [🔔 Vytvoriť upozornenie]  [⇩ Export CSV]   │
└──────────────────────────────────────────────────────────────────────────┘
```

Key behaviors:

- The left sidebar collapses to an icon rail on <1024 px; chips at the top always stay.
- Grid uses the existing `leads-cards-grid` container and `lc2-*` classes — no new card styling.
- The map column is a toggle on tablet/mobile (`?view=list|map|split`).
- "Uložené hľadania" dropdown is a grouped list: Realtime alerts | Hourly | Daily | Manual.
- Alert bell badge count comes from `GET /api/listings/alerts/unread-count` (polled every 30 s, or pushed via Supabase Realtime).
- Keyboard shortcuts: `/` focuses search box, `m` toggles map, `f` toggles filter sidebar, `s` opens "save search" modal.
- Slovak UI strings throughout (consistent with existing app): `Ghost`, `Predajca`, `Súkromný inzerent`, `Zrekonštruované`, `Novostavba`, `Bez telefónu` mirror patterns already in `renderLeadCards`.

---

## 15. Metrics

Exposed via Grafana (Supabase logs → Loki; edge function → Vercel Analytics → Postgres `metrics` schema).

### 15.1 Latency
- `search_latency_ms` p50 / p95 / p99 per endpoint.
- Target: p95 < 500 ms, p99 < 1 200 ms. Alert at p95 > 700 ms for 5 min.
- Broken down by (has_geo, has_fts, has_user_filter) to catch regressions in specific paths.

### 15.2 Filter popularity
- Count of each filter key used in last 24 h / 7 d.
- Drives: which facets to surface first, which indexes to double down on, which filters to deprecate if <0.1 % use.

### 15.3 Conversion funnel
```
search  →  listing detail view  →  saved  →  contacted  →  closed
```
Measured per broker, per tenant, weekly. A listing with many `search → view` but few `view → saved` signals bad ranking for that query shape.

### 15.4 Zero-result searches
- Log every query with `total_count = 0`. Cluster weekly by top tokens. Feed the top 20 into (a) the feature dictionary (if brokers ask for a feature we don't index), (b) geocoding gaps (if they search a town we don't cover), (c) the recommendation engine (auto-relax filter X first).

### 15.5 Cache hit rate
- Redis `search:*` hit/miss ratio. Target ≥40 % steady-state; drops below 25 % indicate either a bug in the canonicalizer or an unusually diverse traffic pattern (e.g. nightly crawl from a logged-in bot).

### 15.6 Alert health
- `alert_latency_seconds` = `now() - first_seen_at` at notify time. Target p95 < 10 min (matches `alert_frequency='realtime'` promise and scrape cadence).
- Alerts sent / alerts acknowledged ratio, per broker. Low ack ratio = noisy saved search → prompt broker to tighten.

---

## Appendix A — filter key reference (machine-readable)

```json
{
  "location": ["region","district","city","city_part","exclude_city_part","radius","polygon","bbox"],
  "property": ["type","subtype","size_m2","land_m2","rooms","floor","condition","energy_class","year_built","features_all","features_any"],
  "price":    ["price_eur","price_per_m2","price_drop_pct","price_drop_days"],
  "seller":   ["seller_type","agency_ids","has_phone"],
  "freshness":["first_seen_within_days","updated_within_days","never_seen_by_user"],
  "quality":  ["min_photos","has_gps","has_energy_class","has_size"],
  "workflow": ["status","saved","hidden","notes_query"],
  "text":     ["q"]
}
```

## Appendix B — open questions

1. **Slovak stemming.** `simple + unaccent` is a pragmatic v1. Needs measurement against real broker queries before deciding Hunspell vs Meilisearch mirror.
2. **ML re-rank.** `rank_score` is a hand-tuned linear formula. Once we have ≥3 months of `search_audit` + `user_listing_state` outcomes, a gradient-boosted re-ranker on the top-200 candidates (LambdaMART-style) is the natural next step. Keep the formula shippable and explainable until then.
3. **Multi-tenant ranking weights.** Different agencies may want different `seller_type` weights (a franchise RK will *not* prefer private sellers). Plumb weights through `tenants.ranking_weights jsonb` before rolling out to the second tenant.
4. **Push / WhatsApp alerts.** Out of scope for v1. Architecture above is channel-agnostic; adding a channel is a row in `alert_channels` enum + a fanout handler.
