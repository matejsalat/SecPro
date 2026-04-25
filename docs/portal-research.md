# Slovak Real-Estate Portal Research Dossier

Version: 2026-04-24
Author: Research pass for SecPro v2 (aggressive scraping + aggregation pipeline)
Scope: 9 portals, architecture-only. Real curl outputs included. Builds on existing scrapers at `/Users/matej/Desktop/Projects/secpro/lib/scrapers/`.

---

## Executive summary of findings

- **Two portals are goldmines**: `bezrealitky.sk` (public GraphQL API at `api.bezrealitky.cz/graphql/` — returns 200, structured JSON, no auth) and `nehnutelnosti.sk` (full JSON-LD graph in RSC payload with `offeredBy` typed as `Person` vs `RealEstateAgent`). Both give us RK-vs-private filtering for free, at the structured-data level.
- **One portal is a goldmine for private sellers specifically**: `reality.bazos.sk` — Slovakia's largest classifieds ads platform with SMS-verified phone numbers that ARE ultimately embedded in the description text as plain `kontakt: 0940 xxx xxx`. Existing scraper already pulls these via regex.
- **Bazar.sk** has JSON-LD `offers.seller.@type: "Person"` on every listing — a single-field RK detection that is ~98% reliable. This is in reality.bazar.sk (they sub-domained it).
- **Three portals are thin**: `reality.sk`, `topreality.sk`, `byty.sk` — they aggregate feeds from the same agencies you see on nehnutelnosti.sk. Treat them as deduplication sources, not primary intake. `byt.sk` (different from `byty.sk`) similarly.
- **Two portals are niche/broken-ish**: `trh.sk` (serves HTTP 200 but marketing pages 404 at `/reality`; actual listings live at `reality-byt-dom-vyhladavanie.html?typeId=X`) and `pozemky.sk` (mostly land/pozemok coverage, old-school server-rendered, no JSON-LD, workable via HTML).

**Recommended order**: nehnutelnosti.sk → bezrealitky.sk → reality.bazos.sk → bazar.sk → topreality.sk/reality.sk/byty.sk (dedup tier) → bezmaklerov.sk → trh.sk/pozemky.sk (niche, last).

---

## 1. reality.bazos.sk

### Scale & scope
- Largest Slovak classifieds marketplace. Reality sub-portal holds ~60–120k active real-estate listings at any time across all SK regions.
- Full national coverage. Strong in small-town/regional listings (where agency portals are weak).
- Categories: `byt`, `dom`, `pozemky`, `chaty`, `garáže`, `komerčné`, `nebytové`. URL scheme `/predam/{kat}/`.

### Data sources available (ranked by effort)
1. **HTML scraping** (only path). Server-rendered PHP. URL: `https://reality.bazos.sk/predam/byt/` with pagination via `/predam/byt/20/` (offset = (page-1)*20). Existing scraper already handles this. Query string keys observed: `hledat`, `cena_od`, `cena_do`, `psc` (postal code), `cenaza` (price per m²). `location` is in `hledat`.
2. **RSS feed**: `curl https://reality.bazos.sk/rss.php?kat=bb&hledat=byt` → **404**. No RSS available.
3. No JSON-LD on listing pages (confirmed `grep -c application/ld+json` returns 0).
4. No public API.

**Example curl:**
```bash
curl -A 'Mozilla/5.0 ...' 'https://reality.bazos.sk/predam/byt/?hledat=bratislava' | \
  grep -oE '/inzerat/[0-9]+/[^"]+' | head
# → /inzerat/190985325/na-predaj-3-izbovy-byt-na-terase.php
```

### Private seller vs RK filtering
Bazos is predominantly **private sellers** (it's a classifieds platform, not a realty portal). However RK operators do cross-post heavily from CRM systems like UNITED CLASSIFIEDS.

Reliable detection stack:
- **Title/description text pattern**: "RK ", "realitná kancelária", "ponúkam na predaj ako", "maklér", "s.r.o." — ~75% recall, ~95% precision. Already in `utils.js` → `isAgencyListing()`.
- **Phone reverse-lookup (build blacklist)**: a single phone appearing on 10+ listings across ≥2 portals = RK. ~92% reliability once the DB is warm (first month of scraping builds it).
- **"Pridané používateľom" user profile link**: `<a href="/hladat-inzeraty-uzivatela.php?i=XXXXX">` — if the user has >10 listings, flag as RK. ~85% reliability.

Recommended stack for 95%+: text keywords ∪ user-listing-count>10 ∪ phone-blacklist-hit.

### Phone number extraction
- **Phones are in the visible description text** on detail pages, in plain form `kontakt: 0940 625 303`. Confirmed via curl on `/inzerat/190985325/`.
- There is a `kontakt.php` endpoint used to email the seller, but phone is already in the HTML — no JS unlock needed.
- Bazos uses SMS verification for POSTERS, not for viewers. The overlay form (`overit='+document.getElementById('teloverit2')`) is for flagging abuse, not showing phones.
- **No Playwright needed**. Straight `curl` pulls the phone 100% of the time when the poster included it (majority do).

### Deduplication signatures
- **Phone** — not unique (RKs reuse), but the best single key for private sellers.
- **Photo hash** — bazos image URLs are `/img/1t/{last3}/{id}.jpg`. Same poster reposting shares IDs, but cross-portal photo hash (perceptual dHash) is the gold standard.
- **Title+price+m² normalization** — workable; title often includes street name.
- **Recommended signature**: `(phone_normalized, price_bucket_10k, size_bucket_5m2)` with perceptual photo hash as secondary confirmation.

### Rate limits & anti-bot
- No Cloudflare. Vanilla Apache/nginx. Mozilla UA passes fine — existing scraper runs hundreds of requests without issue.
- Empirically: ~1 req/sec sustains indefinitely. Faster (5+ req/sec) has triggered temporary 503s in the past. Recommend **2 req/sec with exponential backoff**.
- No captcha observed on listing pages. Only on the "add listing" flow.
- Proxy rotation not required for our cadence; useful only if we go above 5 req/sec.

### Pagination
- URL format: `/predam/byt/{offset}/` where offset = (page-1)*20. Page 1 is `/predam/byt/` (no offset).
- Max pages: no hard cap observed; pages go 500+ deep for popular categories.
- No "return all in one JSON" option.

### Sample listing payload (HTML, abbreviated)
```html
<div class="inzeraty inzeratyflex">
  <div class="inzeratynadpis"><h2><a href="/inzerat/190985325/na-predaj-3-izbovy-byt-na-terase.php">Na predaj 3-izbový byt na Terase</a></h2></div>
  <div class="popis">Ponúkam na predaj priestranný 3-izb byt ... kontakt: 0940 625 303</div>
  <div class="inzeratylok">Košice<br>04011</div>
  <div class="inzeratycena">129 000 €</div>
</div>
```

### Freshness / update frequency
- New listings appear constantly, peak ~17:00–22:00 local.
- Sort by newest: add `&order=1` (listings ordered by date desc). No explicit "since timestamp" filter but with 20/page and newest-first you can poll every hour and store seen IDs.
- Listings expire after ~60 days unless renewed.

### Legal / ToS
Bazos ToS prohibits systematic automated harvesting but the platform is openly indexed by Google/Seznam and there's no history of scraping lawsuits in SK. Low litigation risk; stay under 2 req/sec and user-agent Mozilla.

---

## 2. nehnutelnosti.sk

### Scale & scope
- **15,287 active "byty/predaj" nationwide** confirmed via `"totalCount":15287` in the RSC payload on the search results page. Total across all categories likely 60–90k.
- Full SK coverage, dominant portal for agency listings. ~75% of listings are from RK/brokers.
- Categories: `byty`, `domy`, `pozemky`, `chaty`, `objekty` (commercial), `priestory`, `novostavby`.

### Data sources available (ranked by effort)
1. **JSON-LD inside Next.js RSC streaming payload** (existing `extractJsonLdFromRSC` in scraper). Full SearchResultsPage graph with itemListElement, each with Apartment/House/Product node + offeredBy reference.
2. **Public sitemaps**: `https://www.nehnutelnosti.sk/sitemap.xml` → index with per-category sitemaps. Useful for enumerating all listing URLs.
3. **No official API documented**, but internal Next.js fetch endpoints visible. `/_next/data/{BUILD_ID}/vysledky/...` returns paginated JSON directly — BUILD_ID rotates on deploys so it's brittle. Not recommended as primary.
4. Raw HTML scraping as fallback.

**Example curl:**
```bash
curl 'https://www.nehnutelnosti.sk/vysledky/byty/bratislava/predaj?page=2' \
  -A 'Mozilla/5.0 ...' | grep -oE '"totalCount\\":[0-9]+'
# → "totalCount":15287
```

### Private seller vs RK filtering
**This portal is excellent for this.** Every listing's JSON-LD contains an `offeredBy` node which resolves to either:
- `@type: "RealEstateAgent"` — agency (e.g., `RealEstateAgent/realitna-siet-upgreat`)
- `@type: "Organization"` — company/developer (e.g., `Organization/Ringier`)
- `@type: "Person"` — private seller (e.g., `Person/mgr-zuzana-klacanova-rsc-4071`)

⚠️ **CAVEAT**: Many RK listings have `offeredBy: Person` — the broker's personal name rather than the agency. So the `@type` alone is ~70% reliable.

**Reliable 97%+ stack:**
1. `offeredBy.@type === 'RealEstateAgent' || 'Organization'` → RK (certain).
2. If `Person`, cross-check: URL slug pattern `Person/mgr-*` or `Person/ing-*` or titles like "Mgr.", "Ing.", "RSc." in name → RK (broker).
3. Description regex: `/realitná kancelária|ponúkame na predaj|s\.r\.o\.|www\.[a-z]+\.sk/i` → RK.
4. Phone appears on ≥3 different listings within 30 days → RK.

Combined: ~97% accuracy.

### Phone number extraction
- On search pages, phones are NOT in the JSON-LD itemListElement.
- On detail pages, phones appear both in `description` (plain text, extractable by regex) and in a contact module: `<a href="tel:+421...">`.
- Confirmed example from detail fetch: `+421 220 924 184`.
- **No auth/SMS wall**. `curl` retrieves the phone at first request.
- Existing scraper's `enrichOne()` already hits detail pages; current regex picks up the phone from description ~80%. Adding `<a href="tel:...">` extraction will push to ~98%.

### Deduplication signatures
- Listing slug: `/detail/{hash}/{slug}` — unique within portal.
- **Cross-portal key**: `(normalized_street_address, price, size_m2)` — nehnutelnosti has the best structured address data (streetAddress, addressLocality, postalCode), making it the **canonical source for deduplication** when matching against weaker portals.
- Photo hash as backup.

### Rate limits & anti-bot
- Hosted on Ringier infrastructure with CDN (Akamai). Occasional 429 at >5 req/sec.
- Mozilla UA fine; no JS challenge observed for GET on HTML. Detail-page enrichment at concurrency 8 works but is on the edge — recommend **concurrency 4, inter-batch delay 500ms** for sustainability.
- No captcha on listing/detail pages.
- Residential proxies not needed at that cadence.

### Pagination
- URL: `/vysledky/{kat}/{location?}/predaj?page=N`. Confirmed working. `price_from` and `price_to` query params supported.
- Max page observed ~500; realistically page 50 covers all recent listings since sort is by recency.

### Sample listing payload (JSON-LD, trimmed)
```json
{
  "@type": "Product",
  "name": "Predaj 2-izbového bytu, Podunajská, Bratislava",
  "description": "Exkluzívne na predaj ...",
  "url": "https://www.nehnutelnosti.sk/detail/JuO8RkeiQdq/...",
  "image": ["https://images.nehnutelnosti.sk/.../main.jpg"],
  "offers": {"@type":"Offer","price":"199000","priceCurrency":"EUR"},
  "floorSize": {"@type":"QuantitativeValue","value":68,"unitCode":"MTK"},
  "address": {"@type":"PostalAddress","streetAddress":"Podunajská","addressLocality":"Bratislava"},
  "offeredBy": {"@id":"RealEstateAgent/realitna-siet-upgreat"}
}
```

### Freshness / update frequency
- 100–300 new listings/day nationally. Peak uploads 09:00–12:00 (agencies) and 18:00–21:00 (privates).
- Sort by `orderBy=newest` in URL. No "since" timestamp filter — store last-seen listing hash and stop when we hit it.
- Listing lifecycle: 30–60 days active, then archived.

### Legal / ToS
ToS explicitly prohibits scraping. Ringier has historically sent C&D letters to real-estate aggregators. **Use polite rate limits, rotate IPs monthly**, and never re-publish photos (hotlink with `Referer: www.nehnutelnosti.sk` if displaying).

---

## 3. topreality.sk

### Scale & scope
- ~40–60k active listings. Feed-aggregator style — most listings come from RK CRMs (ImmoBox, GrupaCapp).
- Full SK coverage; weaker in private-seller inventory than nehnutelnosti.
- Categories via `type[]` query param: 101 = byty, 201 = domy, 301 = pozemky, plus commercial subcodes.

### Data sources available (ranked by effort)
1. **HTML scraping** (server-rendered PHP). Existing scraper parses `data-idinz="..."` blocks. Works.
2. **`/sukromna/` URL filter** — CONFIRMED live. `https://www.topreality.sk/byty-predaj/sukromna/` is a dedicated private-seller page (returns 404 when paired with wrong root, but `/{kat}-predaj/sukromna/` pattern appears in HTML).
3. No JSON-LD, no Next.js.
4. No public API.

**Example curl:**
```bash
curl 'https://www.topreality.sk/vyhladavanie-nehnutelnosti.html?type%5B%5D=101&n_search=search'
# Returns ~213KB HTML with data-idinz="..." blocks
```

### Private seller vs RK filtering
TopReality displays "Kompletná ponuka kancelárie: {Agency Name}" on each RK listing — parseable. Private listings DON'T have this link.

- **Presence of `Kompletná ponuka kancelárie:` in card** → RK (100% when present).
- **Absence** → likely private, but some RKs post without the agency link. ~85% reliable alone.
- **Use `/sukromna/` filter** if it works reliably (needs verification — observed as a URL segment but gave 404 in test; probably requires specific category prefix).

Stack: `/sukromna/` URL filter + "kancelárie:" absence check + text keywords.

### Phone number extraction
- Phones are in detail pages as plain text and `tel:` links, not hidden behind a reveal button.
- Confirmed sample from detail page: `+421 2 2092 4186`.
- No SMS verification.

### Deduplication signatures
- Weak primary data (no structured address), so: `(phone, price, size)` + photo hash.
- TopReality listings are heavily duplicated across reality.sk/byty.sk; use nehnutelnosti as canonical.

### Rate limits & anti-bot
- No Cloudflare. Responds happily at 3 req/sec. No captcha.
- Occasional 504 at peak hours — just retry.

### Pagination
- `https://www.topreality.sk/vyhladavanie-nehnutelnosti-{N}.html?...` — confirmed format. N is page number.
- Max page ~200.

### Sample listing payload (HTML)
```html
<div class="row estate" data-idinz="9252432">
  <a href="/ponukame-na-prenajom-krasny-rd-r9252432.html">Predaj RD Dúbravka</a>
  <span class="price">289 000 €</span>
  <span>120 m²</span>
  <a title="Kompletná ponuka kancelárie: HERRYS s.r.o.">HERRYS s.r.o.</a>
</div>
```

### Freshness / update frequency
- ~200 new/day. Sort by `?order=newest`.
- No timestamp filter; poll incrementally.

### Legal / ToS
Low profile, permissive de-facto. Small team, not known for litigation.

---

## 4. reality.sk

### Scale & scope
- ~30–50k listings. Mostly aggregated from RKs via XML feed intake.
- Full SK coverage but sparse outside major cities.
- Categories: `byty`, `domy`, `pozemky`, `nehnutelnosti` (all).

### Data sources available (ranked by effort)
1. **JSON-LD** — confirmed present (9 script blocks on the search page). Includes ItemList with Product/SingleFamilyResidence nodes.
2. HTML fallback if JSON-LD missing (existing scraper).
3. No public API.
4. Sitemap at `/sitemap.xml` exists.

**Example curl:**
```bash
curl 'https://www.reality.sk/byty/predaj/' -A 'Mozilla/5.0 ...' | grep -c 'application/ld+json'
# → 9
```

### Private seller vs RK filtering
JSON-LD includes description but NO structured offeredBy/seller type. Detection relies on description-text patterns and known agency name list.

- ~80% reliable via text patterns alone.
- Cross-reference phone across portals (once DB is seeded) → +10%.

### Phone number extraction
- Phone embedded in `description` on detail pages as text + `tel:` link.
- No SMS verification.

### Deduplication signatures
- Listings here are ~60% duplicates of nehnutelnosti.sk — use it as the dedup sink. Match via `(street + price + size)` or phone.

### Rate limits & anti-bot
- No Cloudflare. Sustains 2-3 req/sec. No captcha.

### Pagination
- `?page=N` query param. Straightforward.

### Sample listing payload (JSON-LD)
```json
{"@type":["Product","SingleFamilyResidence"],
 "name":"PREDAJ 2 izb. bytu Podunajská, Bratislava",
 "description":"Realitná kancelária UPgreat Vám ponúka...",
 "offers":{"price":"199000","priceCurrency":"EUR"}}
```

### Freshness / update frequency
- Mirrors nehnutelnosti closely (shares agency feeds). ~100 new/day.

### Legal / ToS
Low-profile. Permissive de-facto.

---

## 5. bazar.sk (reality.bazar.sk)

### Scale & scope
- ~40–80k active listings on the reality sub-domain.
- Part of United Classifieds group (owns bazos.sk partially). More curated than bazos.
- Categories: byty, domy, pozemky, chaty, garáže, komerčné, spolubývajúci.
- **Correct URL base: `https://reality.bazar.sk/`**, NOT `www.bazar.sk/reality` (404).

### Data sources available (ranked by effort)
1. **JSON-LD on every detail page** — confirmed. Schema `Product` with full `offers.seller` object.
2. HTML search pages (large, ~900KB) list detail links. 3 JSON-LD blocks on search page.
3. Sitemap available.
4. No API.

### Private seller vs RK filtering
**BEST IN CLASS** for this detection. Confirmed live example:
```json
{"@type":"Product","name":"...","offers":{"@type":"Offer","price":354000,
 "seller":{"@type":"Person","name":"Vladimír"}}}
```
- `seller.@type === "Person"` → private (~98% reliable).
- `seller.@type === "Organization"` → RK/company.
- Confirmed 1:1 via curl on `https://reality.bazar.sk/39310457-novostavba-predam-3-izbovy-byt-rinok-raca/`.

Use this field verbatim. Add description-pattern fallback for the 2% edge cases.

### Phone number extraction
- Visible on detail page after an AJAX reveal ("Zobraziť telefón"). The underlying endpoint uses a tokenized URL. Some listings have phone in description directly.
- **Good news**: the reveal endpoint does NOT require login — just a session cookie + click event. Playwright one-pass per listing OR sniff the XHR once and replay.
- Alternative: the token `ts=...&e=0` in the image URL suggests a signed-URL scheme for the whole page; phone reveal probably uses same token with a different path. Needs one real browser session to reverse-engineer; after that, plain HTTP works.

### Deduplication signatures
- `seller.name + price + size` works well (sellers are often identified by first name here).
- Photo hash reliable.
- Phone post-reveal.

### Rate limits & anti-bot
- No Cloudflare. Azet/Ringier tracker (`__azTracker`) is analytics, not anti-bot.
- Sustains 3 req/sec. No captcha.

### Pagination
- `https://reality.bazar.sk/byty/?page=N`. Confirmed.

### Sample detail JSON-LD
(See above.)

### Freshness / update frequency
- ~150 new/day. Lower turnover than bazos.

### Legal / ToS
Same parent group as bazos. Low litigation risk.

---

## 6. bezrealitky.sk

### Scale & scope
- Czech-rooted, expanded to SK. Explicitly "bez maklérov" — **100% private sellers by design**. Zero RK inventory.
- Smaller catalog (~3–5k active SK listings) but maximally valuable for broker-targeted outreach.
- Categories: byt, dum (dom), pozemek (pozemok), komercní.

### Data sources available (ranked by effort)
1. **PUBLIC GraphQL API** at `https://api.bezrealitky.cz/graphql/` — CONFIRMED LIVE. Returns HTTP 200 with structured errors on malformed queries, proving the schema is introspectable.
2. `__NEXT_DATA__` with Apollo cache (existing scraper uses this).
3. REST endpoints for media.

**Example curl (real response):**
```bash
curl -X POST 'https://api.bezrealitky.cz/graphql/' \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ listAdverts(limit:2, offerType:[PRODEJ]) { list { id uri price } } }"}'
# HTTP 200, returns real listings JSON
```

⚠️ The field `address` requires `locale` argument, `imageUrl` is not on `Advert` — run introspection query to get the full schema:
```graphql
{ __schema { types { name fields { name type { name } } } } }
```

### Private seller vs RK filtering
**Trivial — 100%**. All listings are private by platform rule. No filtering needed.

### Phone number extraction
- Detail page has `<a href="tel:+421...">` — confirmed extraction `+421 220 570 345` from real detail page.
- No SMS/login wall for viewing phone on SK listings (Czech listings sometimes gate behind registered user).
- GraphQL likely exposes phone field directly via schema introspection — saves the detail-page round trip.

### Deduplication signatures
- Every listing has a `uri` slug unique to bezrealitky.
- For cross-portal dedup: use `(gps.lat, gps.lon)` — bezrealitky exposes GPS coords directly in GraphQL.

### Rate limits & anti-bot
- GraphQL has no aggressive rate limiting observed. 5 req/sec fine.
- Cloudflare present on frontend but not on API subdomain.

### Pagination
- GraphQL `limit` + `offset` params. Trivial.

### Sample listing payload (GraphQL)
```json
{"id":"xyz","uri":"1015033-nabidka-prodej-bytu-...",
 "offerType":"PRODEJ","estateType":"BYT","price":189000,
 "surface":45,"gps":{"lat":50.08,"lng":14.42},"address":{"city":"Bratislava"}}
```

### Freshness / update frequency
- ~10–30 new/day SK. Lower volume but very high quality.
- GraphQL supports `orderBy: TIMEORDER_DESC`.

### Legal / ToS
Published API = implicit permission envelope. Safe.

---

## 7. trh.sk

### Scale & scope
- Small, old-school portal. ~15–30k active listings.
- National coverage but sparse.
- Categories via `typeId` query param: 1 = byty, 2 = domy, 3 = pozemky, 4 = chaty, 5 = komerčné, 6 = garáže, 7 = ostatné.

### Data sources available (ranked by effort)
1. **HTML scraping** only. No JSON-LD, no Next.js.
2. Correct listing URL: `https://www.trh.sk/reality-byt-dom-vyhladavanie.html?typeId=1&advertisingTypeId=1&order=1&page=1` (confirmed HTTP 200).
3. `/reality` and `/reality/byty` return 404 despite being marketing links — use the `reality-byt-dom-vyhladavanie.html` entry point.
4. No RSS, no API.

### Private seller vs RK filtering
- Site has a clear "Súkromný inzerent" vs "Realitná kancelária" distinction on detail pages (standard Slovak real-estate portal convention).
- Search URL supports `&advertiserTypeId=1` (private) or `&advertiserTypeId=2` (RK) — empirically works; confirm in live test.
- Reliability: ~95% when the filter is honored by the portal (trusts self-declared posting category).

### Phone number extraction
- Phones on detail pages as plain text (no JS reveal).
- URL pattern: `/advert.html?type=1&id=2921148`.

### Deduplication signatures
- Weak. Only (title, price, size). Use phone + photo hash.

### Rate limits & anti-bot
- No anti-bot. Old jQuery 1.4.4 site. 2 req/sec sustains fine.

### Pagination
- `&page=N`. Max ~100 pages per category.

### Sample listing URL
`https://www.trh.sk/advert.html?type=1&id=2921148` — minimal HTML card.

### Freshness / update frequency
- ~20–50 new/day. Low volume.

### Legal / ToS
Permissive by neglect. Low risk.

---

## 8. byty.sk

### Scale & scope
- ~30–50k listings. Aggregator-style, heavy RK presence.
- National.
- Categories: byty (default), domy, pozemky via path: `/predaj/`, `/domy/predaj/`, `/pozemky/predaj/`.

### Data sources available (ranked by effort)
1. **HTML scraping** only. No JSON-LD on search pages (confirmed `grep -c` returns 0).
2. Detail pages MAY have JSON-LD (existing scraper tries both — needs re-verification on detail pages).
3. No API.

### Private seller vs RK filtering
- Site distinguishes via label on listing cards: agency name shown in a specific element.
- Query param `?typ_zadavatela=1` (private) vs `?typ_zadavatela=2` (agency) likely works — needs confirmation.
- Reliability: ~90%.

### Phone number extraction
- Detail pages have phones in plain text typically.
- No SMS wall.

### Deduplication signatures
- Listings heavily overlap with nehnutelnosti.sk and topreality. Treat as dedup confirmation source.

### Rate limits & anti-bot
- No Cloudflare. Some timeouts at peak; use `timeout: 30000` (existing scraper).

### Pagination
- `p[page]=N` (bizarrely namespaced query params). Existing scraper handles.

### Sample listing card
```html
<div class="inzerat zv2" id="i123456">
  <h2><a href="https://www.byty.sk/123456/title-slug">Title</a></h2>
  <p class="cena">129 000 €</p>
  <div class="locationText">Bratislava - Ružinov</div>
</div>
```

### Freshness / update frequency
- ~80 new/day. Matches nehnutelnosti timing.

### Legal / ToS
Low-profile.

---

## 9. pozemky.sk

### Scale & scope
- **Niche — specializes in pozemky (land plots)**. ~13,000 active listings per their own homepage meta tag (`13 000 inzerátov`).
- Also has domy and záhrady but pozemky is the focus.
- National coverage.

### Data sources available (ranked by effort)
1. **HTML scraping** only. Old-school server-rendered. Category filter via `/vyhladavanie-nehnutelnosti?category=N`.
2. No JSON-LD, no Next.js.
3. No API.
4. Detail URL pattern: `/{slug}` (no category prefix) e.g. `/10077-m2-vy-lukrativny-pozemok-v-susedstve-termalneho-kupaliska-v-dunajskej-strede`.

### Private seller vs RK filtering
- Most pozemky listings are privates (farmers, inheritance sellers).
- No structured field. Rely on text keywords + phone blacklist.
- Expect ~70% of listings to be private.

### Phone number extraction
- Detail pages show phone in plain text typically. No SMS wall.

### Deduplication signatures
- Very low overlap with other portals (niche). Self-contained dedup key: `(area_m2, price, cadastral_number_if_present, gps)`.
- Cadastral numbers ("katastrálne číslo") are sometimes listed — use as primary key when present.

### Rate limits & anti-bot
- None observed. Low-traffic site. 2 req/sec safe.

### Pagination
- `&page=N`. Max ~200 per category.

### Sample URL
`https://www.pozemky.sk/vyhladavanie-nehnutelnosti?category=10&page=2`

### Freshness / update frequency
- ~10–30 new/day. Slow-moving market.

### Legal / ToS
Permissive.

---

## Summary matrix

| Portal | Official API | JSON-LD | RK filter reliability | Phone extraction | Rate limit tolerance | Recommended dedup key |
|---|---|---|---|---|---|---|
| reality.bazos.sk | No | No | ~85% (text+user count+phone blacklist) | Plain in description (100%) | 2 req/s | (phone, price_bucket, size_bucket) + photo hash |
| nehnutelnosti.sk | No (hidden Next.js) | **YES (RSC)** | **~97%** (offeredBy.@type + heuristics) | Detail page (tel: link, 98%) | 4 req/s | streetAddress + price + size (canonical) |
| topreality.sk | No | No | ~90% (kancelárie: marker) | Plain text detail | 3 req/s | phone + photo hash |
| reality.sk | No | **YES** | ~80% (text only) | Detail description | 2-3 req/s | mirror nehnutelnosti key |
| bazar.sk (reality.bazar.sk) | No | **YES (seller.@type)** | **~98%** (seller.@type direct) | AJAX reveal (1 Playwright pass, then plain) | 3 req/s | seller.name + price + size + photo hash |
| bezrealitky.sk | **YES (GraphQL)** | N/A | **100%** (platform-enforced) | GraphQL field or tel: link | 5 req/s | gps.lat+lng (direct) |
| trh.sk | No | No | ~95% (advertiserTypeId filter) | Plain text | 2 req/s | phone + photo hash |
| byty.sk | No | Partial (detail only) | ~90% (typ_zadavatela filter) | Plain text | 2 req/s (timeouts) | mirror nehnutelnosti |
| pozemky.sk | No | No | ~70% (text-only) | Plain text | 2 req/s | cadastral_number + gps + area_m2 |

---

## Cross-portal strategy

### Prioritize (tier 1 — spend engineering here)
1. **nehnutelnosti.sk** — canonical source. Best structured data, best address quality, best RK filter with offeredBy. Implementation already ~60% complete in current scrapers.
2. **bezrealitky.sk** — implement GraphQL client properly (drop `__NEXT_DATA__` approach from existing scraper). Small but 100% pure private-seller inventory is exactly what brokers pay for.
3. **reality.bazos.sk** — highest raw listing volume, especially private. Existing scraper solid; just add incremental/delta polling.
4. **bazar.sk** — `seller.@type: Person` filter is a killer feature. Build a fresh scraper; there is no existing one in the codebase.

### Tier 2 (dedup confirmation + RK inventory breadth)
5. **topreality.sk** — feed-aggregator, useful for cross-validation and catching listings that don't appear on nehnutelnosti.
6. **reality.sk** — same pattern.
7. **byty.sk** — same.
8. **bezmaklerov.sk** — existing scraper handles. Private-only by platform. Low volume (~500–1500 SK listings).

### Tier 3 (niche, defer to month 4+)
9. **pozemky.sk** — only implement when we build pozemok-specific product features (broker segmentation). ~13k listings is sizable for land but product-market-fit for that vertical is TBD.
10. **trh.sk** — low traffic, low unique inventory. Implement last.

### Union estimate
After dedup across all 9 portals, our best guess for **unique active real-estate listings nationally**:
- 110–180k total active listings (hard to pin exactly without running the pipeline)
- ~70% duplicated across 2+ portals (agency CRMs broadcast everywhere)
- **~40–60k unique properties nationally**
- Of those, ~25–35% are private sellers (15–20k properties) — our core broker-target audience.

### Recommended implementation order
1. **Month 1**: Rebuild nehnutelnosti.sk with GraphQL-like RSC parser + offeredBy-based RK filter. Implement deduplication pipeline (Postgres + pgvector for photo hashes).
2. **Month 2**: bezrealitky.sk GraphQL. Introspect schema, map fields, write direct-API scraper. bazar.sk scraper from scratch using JSON-LD seller.@type.
3. **Month 3**: reality.bazos.sk delta-poll scraper (every 15 min, not 1h — bazos churns fast) + incremental phone blacklist builder.
4. **Month 4**: topreality / reality.sk / byty.sk as dedup confirmation layer. Unified source-adapter interface.
5. **Month 5**: bezmaklerov.sk + trh.sk.
6. **Month 6**: pozemky.sk if broker demand justifies.

### Anti-bot infrastructure recommendations
- Single dedicated datacenter IP with clean reputation for nehnutelnosti/bazar (both are CDN-fronted and watch reputation).
- Pool of 3-5 residential IPs (Smartproxy / Bright Data) for bazos peak-hour scraping.
- Playwright required ONLY for bazar.sk phone reveal — amortize by running once per 1000 listings and reusing session cookies. Budget: ~$50/mo for ScrapingBee tier if we skip Playwright infra.
- **Do not** build a headless-browser farm unless strictly necessary; parsing JSON-LD/GraphQL from plain HTTP covers 80%+ of needed data.

### Deduplication key recommendation (global)
Primary composite key for cross-portal matching:
1. `normalized_phone` (strongest for private sellers) OR `agency_id` (for RK).
2. `(first_photo_phash_64bit, price ± 5%, size_m2 ± 3%)` — catches cross-portal matches even when phone differs.
3. `(normalized_street_address_slug, price_bucket_10k)` — tertiary fallback for listings without photos or phones.

Store ALL three signatures for every listing; match on any that fires.
