-- ============================================================================
-- Seed data — portals, config, initial agent blacklist
-- ============================================================================

-- Portals (9 active + fb_marketplace reserved for phase 2)
insert into portals (slug, name, base_url, priority, scrape_interval_minutes, notes) values
  ('nehnutelnosti',  'Nehnutelnosti.sk',   'https://www.nehnutelnosti.sk',      10,  60, 'JSON-LD rich, offeredBy @type exposes RK. Main portal.'),
  ('bezrealitky',    'Bezrealitky.sk',     'https://www.bezrealitky.sk',        20,  60, 'Public GraphQL at api.bezrealitky.cz. Marketing claim: no agencies.'),
  ('bazos',          'Bazos.sk',           'https://reality.bazos.sk',          30,  60, 'Phones in description plain text. No real captcha gate.'),
  ('bazar',          'Bazar.sk',           'https://reality.bazar.sk',          40,  60, 'JSON-LD offers.seller.@type: Person — 98% accurate RK signal.'),
  ('reality',        'Reality.sk',         'https://www.reality.sk',            50,  60, 'Has /reality-sukromne-inzeraty/ section for private only.'),
  ('topreality',     'TopReality.sk',      'https://www.topreality.sk',         60,  60, 'Supports ?iba_sukr=1 for private-only filter.'),
  ('byty',           'Byty.sk',            'https://www.byty.sk',               70,  60, 'Supports ?inzerent=sukromna-osoba.'),
  ('trh',            'Trh.sk',             'https://www.trh.sk',                80, 120, 'Smaller classifieds portal.'),
  ('pozemky',        'Pozemky.sk',         'https://www.pozemky.sk',            90, 240, '~13k land listings. Specialized portal.'),
  ('fb_marketplace', 'Facebook Marketplace','https://www.facebook.com/marketplace', 200, 360,
                                                                             'Reserved — phase 2. Requires authenticated account + stealth tooling.')
on conflict (slug) do nothing;

-- Mark fb_marketplace inactive until we build its scraper
update portals set is_active = false where slug = 'fb_marketplace';

-- Runtime config defaults
insert into config (key, value, description) values
  ('scrape.max_pages_per_portal',   '5',      'Default pagination depth per scrape run.'),
  ('scrape.parallel_workers',       '3',      'Concurrent scraper workers.'),
  ('scrape.user_agents',            '["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36","Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36","Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"]',
                                              'Pool of UA strings, picked round-robin per request.'),
  ('scrape.request_delay_ms',       '{"min": 800, "max": 2500}', 'Random delay between requests.'),
  ('dedup.auto_merge_threshold',    '0.85',   'Confidence above which we auto-merge sources.'),
  ('dedup.title_jaccard_min',       '0.55',   'Min title similarity to consider title-based merge.'),
  ('ai.model',                      '"gemini-2.0-flash-exp"', 'Default AI model for extraction.'),
  ('ai.prompt_version',             '"v1"',   'Current prompt version — bump to force re-extraction.'),
  ('notifications.in_app_default',  'true',   'New brokers get in-app notifications by default.'),
  ('notifications.email_default',   'false',  'Email notifications require explicit opt-in.')
on conflict (key) do nothing;

-- Initial agent_blacklist seed (fill with real RK phones later from ORSR / NARKS / ZRKS scrape)
-- These are placeholders; populate via a separate script that scrapes public agency directories.
insert into agent_blacklist (kind, value, company_name, source, notes) values
  ('name', 'remax',               'RE/MAX Slovakia',       'manual', 'One of the largest SK agencies.'),
  ('name', 'century 21',          'Century 21 Slovakia',   'manual', null),
  ('name', 'herrys',              'HERRYS',                'manual', null),
  ('name', 'cpm real estate',     'CPM Real Estate',       'manual', null),
  ('name', 'sotheby',             'Sotheby International', 'manual', null),
  ('name', 'max realitná',        'Max Realitná',          'manual', null)
on conflict (kind, value) do nothing;
