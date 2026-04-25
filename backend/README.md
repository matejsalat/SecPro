# SecPro Backend (v2)

Greenfield rebuild of the SecPro real-estate aggregator backend.
Status: **bootstrapping** — schema ready, scrapers in progress.

## Stack

| Layer | Tech | Plan |
|---|---|---|
| Database | Supabase (Postgres 15 + PostGIS + Auth + Storage) | Free tier initially |
| Queue | Postgres (pgmq) — native, no extra service | Free |
| Worker host | Fly.io free tier (3 shared-cpu VMs) | Free (scale to $5-10/mo) |
| Proxies | IPRoyal Residential Lite ($2/GB) | $10-15/mo |
| AI | Gemini 2.0 Flash (free tier then paid) | $0 initially |
| Monitoring | Better Uptime free + Supabase dashboards | Free |

**Budget target**: $15-30/mo bootstrap, ≤$100/mo ceiling.

## Repository layout

```
backend/
├── README.md                        # you are here
├── db/
│   └── migrations/
│       ├── 001_initial_schema.sql   # tables, enums, extensions, indexes
│       ├── 002_seed.sql             # portals, config defaults, blacklist seed
│       └── 003_rls.sql              # row-level security policies
├── scrapers/                        # per-portal scrapers (will be rebuilt)
├── extraction/                      # Gemini AI extraction pipeline
├── workers/                         # cron orchestration, queue consumers
├── api/                             # search/serving endpoints
└── lib/                             # shared utilities (DB client, proxy pool, etc.)
```

## Setup

### 1. Create Supabase project
- Go to https://supabase.com/dashboard
- Create project named `real-estate-data`, region **Frankfurt**, free plan
- Copy from Settings → API:
  - Project URL
  - `anon` key (public, for frontend)
  - `service_role` key (secret, for backend)

### 2. Run migrations

In Supabase SQL Editor, run in order:

```sql
-- 1. Paste contents of backend/db/migrations/001_initial_schema.sql
-- 2. Paste contents of backend/db/migrations/002_seed.sql
-- 3. Paste contents of backend/db/migrations/003_rls.sql
```

Or via Supabase CLI:
```bash
supabase db push --db-url "postgresql://postgres.xxxxx:PASSWORD@aws-0-eu-central-1.pooler.supabase.com:6543/postgres"
```

### 3. Environment variables

Create `backend/.env` (gitignored):

```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # secret!

GEMINI_API_KEY=...

# proxies (optional for phase 1)
IPROYAL_USERNAME=
IPROYAL_PASSWORD=
PROXY_POOL_ENDPOINT=

# worker config
WORKER_CONCURRENCY=3
SCRAPE_INTERVAL_MINUTES=60
```

### 4. Install dependencies

```bash
cd backend
npm install
```

(package.json will be added in next commit.)

## Design references

Before implementing anything, read the architecture docs:

- `/docs/portal-research.md`        — per-portal scraping strategy
- `/docs/data-architecture.md`      — full schema rationale (~6k words)
- `/docs/ai-extraction-pipeline.md` — Gemini prompts, cost analysis
- `/docs/ingestion-orchestration.md`— cron, proxies, worker hosting
- `/docs/search-serving.md`         — query patterns, ranking, map
- `/docs/rk-filter-strategy.md`     — how we detect agencies vs private sellers

## Implementation order (phased rollout)

| Week | Work | Exit criteria |
|---|---|---|
| 1 | Schema deployed + 3 scrapers (nehnutelnosti, bezrealitky, bazos) using public data | 10k+ listings in DB |
| 2 | Gemini extraction pipeline + photo classification | 95% of listings have structured fields |
| 3 | Remaining 6 scrapers + proxy rotation | All 9 portals active |
| 4 | Dedup algorithm + price history | Canonical listings merged cross-portal |
| 5 | RK filter stack (URL + JSON-LD + phone blacklist + description regex + vision) | ≥95% precision on private-only filter |
| 6 | Phone unlock (Playwright for gated portals) | ≥90% of listings have phones |
| 7 | Search API + filters + facets + ranking | p95 < 500ms |
| 8 | Map view + saved searches + alerts | Full broker UX |

## Security / anonymity notes

- Service role key NEVER goes to frontend
- Git commits use anonymous email (no personal identity)
- Proxies routed via IPRoyal in non-SK geos (DE/US) — Slovak portals see foreign traffic
- VPN on dev box (Mullvad)
- Project named `real-estate-data` (not SecPro) in external dashboards
