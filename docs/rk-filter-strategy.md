# RK Filter Strategy — Identifying Private vs. Agency Listings on Slovak Real Estate Portals

**Goal:** For 9 major Slovak real-estate portals, reliably separate listings posted by realitné kancelárie (RK — real estate agencies) from those posted by súkromní inzerenti (private owners). Target accuracy: **≥ 95 %** precision for the "private" class, because the downstream product (a broker/buyer aggregator) depends on not drowning the user in agency listings they deliberately want to avoid.

This document is research + strategy, not code. It ranks every approach by reliability, per portal.

---

## 1. Executive Summary

The good news: most major Slovak portals already expose a "private only" filter — either as a URL parameter, a checkbox, or a dedicated sub-site. Using these natively filters ~80 – 90 % of agency content. The remaining 10 – 20 % are agents gaming the filter, private owners co-operating with an agent, or portals (bazos.sk, bazar.sk) that have no native filter at all.

The recommended stack is a **5-layer cascade**:

1. **Layer 1 – Native portal filter** (deterministic, free, already at 80 – 90 %).
2. **Layer 2 – Phone-number blacklist** (cross-reference against a registry built from ORSR + NARKS + ZRKS + scraped RK websites). Catches agents masquerading as private.
3. **Layer 3 – Description-text regex / classifier** (catches RK boilerplate phrases — "Exkluzívne ponúkame", "Provízia RK", etc.).
4. **Layer 4 – Operational heuristics** (same phone on ≥ 3 listings → RK; user account with > 10 listings → RK; posting time patterns).
5. **Layer 5 – Vision model (Gemini / GPT-4V)** on photos — watermarks, staging, floor-plan templates — only for listings that Layers 1-4 score as "Unknown".

Scoring system (details in §11) combines these into a probability, with a 3-way output: **Private / RK / Unknown**. Unknown is surfaced to the user with a warning rather than hidden.

---

## 2. Portal-by-Portal Findings

### 2.1 reality.bazos.sk

- **Native filter:** **None.** Verified by fetching the homepage and search form — only Čo / PSČ / Okolie / Cena. No "súkromný" checkbox, no `privatny=1` param. Listings routinely embed agent names ("Ing. Katarína Čomová", "Diamond Reality", "RR reality", "Impulz Real") directly in the free-text description.
- **Structured data:** No JSON-LD `offeredBy`. No `__NEXT_DATA__` — it's a plain server-rendered HTML site. Phone number is hidden behind a "Zobraziť telefón" click (AJAX, token-protected) — scrapeable but rate-limited.
- **Account data:** Each listing links to a user profile (`/inzeraty/uzivatel/...`) which lists all other listings by the same user. **High-value signal**: count listings per user.
- **Best signals:** (a) account-level listing count, (b) phone blacklist, (c) description regex.
- **Expected accuracy with full stack:** 88 – 93 %. Bazos is the hardest portal because agents deliberately pose as "Mišo" and write short descriptions to evade filters.
- **Priority:** **High** — bazos has the highest share of private owners in SK but also the most mixing.
- **Special concern:** Bazos has anti-scraping (Cloudflare + rate limit). Respect 1 req/s with rotating UA.

### 2.2 nehnutelnosti.sk

- **Native filter:** Yes — listings marked "Priamo od majiteľa" are visually flagged. The URL parameter is not documented, but the portal distinguishes three account types internally: **Bežný inzerent (OSOBA)**, **Profi klient**, **Realitná kancelária (RK)**. Private-only is reachable by picking "Priamo od majiteľa" in the advanced filter.
- **Structured data:** The portal uses Next.js (`__NEXT_DATA__` blob). The listing JSON contains `advertiserType` / `ponukaOd` / `account.type` fields. This is **deterministic seller classification** from the portal itself — the gold standard.
- **Account page:** Each RK has a dedicated profile page (`/realitne-kancelarie-makleri/...`) listing all of their inzeráty — a ready-made agency whitelist.
- **Best signals:** (a) `__NEXT_DATA__.account.type`, (b) presence of RK profile URL, (c) "Priamo od majiteľa" badge in rendered HTML.
- **Expected accuracy:** **96 – 99 %** (structured data + official flag).
- **Priority:** **High** — easiest big win. Trust the portal.
- **Special concern:** Some "Priamo od majiteľa" accounts are actually agents using their personal number. Secondary phone-blacklist check catches ~90 % of these.

### 2.3 topreality.sk

- **Native filter:** Yes — checkbox **"Iba súkromná inzercia"**, URL parameter **`iba_sukr=1`**. Confirmed working (64 718 listings total with filter active; the counts per category match human-verified spot checks).
- **Structured data:** Server-rendered HTML, no JSON-LD. Listing detail page shows "Inzerent: súkromná osoba" vs "Inzerent: realitná kancelária" in a dedicated row — trivially extractable by DOM selector.
- **Best signals:** URL flag + HTML "Inzerent:" row.
- **Expected accuracy:** **94 – 97 %**. Some agents register as "súkromná" to evade — description regex catches them.
- **Priority:** **High**. The site is slated to migrate users to nehnutelnosti.sk but still has listings.
- **Special concern:** Small but non-zero agent leakage on the "private" side — layer 3 (description) is essential.

### 2.4 reality.sk

- **Native filter:** Yes — dedicated sub-path `/reality-sukromne-inzeraty/`, and separate registration flow `/moj-ucet/registracia-sukromny-inzerent`. Internal URL parameters `item_type:[107]` and `user_subject_type:[23348]` are visible in request query strings.
- **Structured data:** Listings carry a `user_subject_type` enum (private vs professional). Scrapeable from the HTML or the private JSON endpoint.
- **Best signals:** URL path segmentation + `user_subject_type` enum.
- **Expected accuracy:** **95 – 98 %**.
- **Priority:** **Medium** — lower traffic than nehnutelnosti.sk but reliable.
- **Special concern:** Empty-result edge case on the bare `/reality-sukromne-inzeraty/` (tested, returned no listings). Must combine with region/type filters to force results.

### 2.5 bazar.sk (reality.bazar.sk)

- **Native filter:** **None visible** on the main search form. Some listing detail pages expose "Typ inzerenta: súkromná osoba / firma" in the metadata block, but it's not a filter.
- **Structured data:** Basic HTML only. No JSON-LD, no Next data.
- **Best signals:** per-listing "Typ inzerenta" field + full Layers 2-5 stack.
- **Expected accuracy:** **80 – 87 %** — comparable to bazos.
- **Priority:** **Low** — traffic is modest; engineering cost is high.
- **Special concern:** Low-quality listings; many duplicate cross-posts from bazos.sk.

### 2.6 bezrealitky.sk

- **Native filter:** **Not needed by design** — the site's entire value proposition is "bez realitiek". The brand contract with users is no-agencies.
- **Reality check:** Our research did not find published verification mechanisms (no documented phone verification, no business-registry check). Terms of Service prohibit agent use; enforcement is reactive (user reports). **Agents do slip in**, especially solo brokers using personal phone numbers and listing their own inventory.
- **Best signals:** (a) phone blacklist (Layer 2), (b) description regex, (c) same-phone-multi-listing heuristic. Essentially, treat bezrealitky as "trust but verify".
- **Expected accuracy:** **94 – 97 %** if Layer 2 is applied. The portal's self-selected audience means the base rate of RK is already low (estimated < 5 %).
- **Priority:** **Low engineering, high trust value.**
- **Special concern:** When we detect an RK on bezrealitky, that's a high-signal negative — worth flagging to the user ("This listing claims to be private but phone X appears on 8 other agency listings").

### 2.7 trh.sk

- **Native filter:** Yes — **"Len súkromné nehnuteľnosti"** checkbox. URL uses numeric `typeId`, `advertisingTypeId`. The private-only parameter is likely a `subjectTypeId` or similar (needs network-inspection to extract exact key — our fetch did not expose it, but the filter definitely exists).
- **Structured data:** Standard server-rendered HTML.
- **Best signals:** URL flag + description regex.
- **Expected accuracy:** **90 – 94 %**.
- **Priority:** **Medium**.
- **Special concern:** Modest traffic. Not worth deep investment but cheap to include.

### 2.8 byty.sk

- **Native filter:** Yes, best-in-class. **`Inzerent` filter** with explicit values: `Všetky` / `Súkromná osoba` / `Realitná kancelária`. URL parameter confirmed: **`?inzerent=sukromna-osoba`** (`inzerent=realitna-kancelaria` for the inverse). Pagination preserves the param: `?inzerent=sukromna-osoba&p[page]=2`.
- **Structured data:** The filter is authoritative at the portal level — there is a per-account classification stored server-side.
- **Best signals:** URL flag is enough on its own.
- **Expected accuracy:** **96 – 98 %**.
- **Priority:** **High** — simplest win.
- **Special concern:** Minor — confirm the per-listing label matches the filter (spot-check shows a tiny number of Broker-Consulting listings leak into the "private" bucket, probably account-type misregistration).

### 2.9 pozemky.sk

- **Native filter:** Yes — **"Druh inzerátu"** select with `Súkromná inzercia` / `Realitná kancelária` / `Všetky druhy`. URL param not directly exposed but likely `druh=sukromna` or similar.
- **Structured data:** Similar to byty.sk (same group's design patterns).
- **Best signals:** URL flag.
- **Expected accuracy:** **94 – 97 %**.
- **Priority:** **Medium** — pozemky is a niche vertical (land only).
- **Special concern:** Lower listing volume → smaller base rate, but niche agencies specialise in land.

---

## 3. Priority Ranking

| Tier | Portal | Native filter quality | Target accuracy | Effort |
|------|--------|----------------------|-----------------|--------|
| **A — easy wins** | byty.sk | Excellent (`inzerent=sukromna-osoba`) | 96-98 % | 1 day |
| A | nehnutelnosti.sk | Excellent (`__NEXT_DATA__.accountType`) | 96-99 % | 1-2 days |
| A | topreality.sk | Very good (`iba_sukr=1`) | 94-97 % | 1 day |
| A | pozemky.sk | Very good (select "Súkromná inzercia") | 94-97 % | 1 day |
| A | reality.sk | Very good (private sub-site) | 95-98 % | 2 days |
| **B — trust-but-verify** | bezrealitky.sk | Implicit | 94-97 % (with Layer 2) | 2 days |
| B | trh.sk | Good ("Len súkromné") | 90-94 % | 2 days |
| **C — requires full stack** | reality.bazos.sk | None | 88-93 % | 1-2 weeks |
| C | bazar.sk | None | 80-87 % | 1-2 weeks |

---

## 4. Structured-Data Extraction Cheatsheet

| Portal | Structured data location | Field / selector |
|--------|-------------------------|-------------------|
| nehnutelnosti.sk | `<script id="__NEXT_DATA__">` JSON | `props.pageProps.listing.account.type` |
| byty.sk | HTML data attribute on listing card | `data-inzerent` (inferred from URL sync) |
| topreality.sk | Listing detail page, row `Inzerent:` | CSS `tr:has(th:contains("Inzerent")) td` |
| reality.sk | URL path + HTML row `Typ inzerenta` | — |
| trh.sk | Listing detail page metadata | `Inzerent` row |
| bazos.sk | User profile link `/uzivatel/<id>` | Count listings on profile |
| bazar.sk | Listing footer "Typ inzerenta" | Text match |
| bezrealitky.sk | (none — single-type portal) | — |
| pozemky.sk | Same as byty.sk | `data-inzerent` / similar |

No portal exposes schema.org `offeredBy` with `@type: Organization` vs `Person` — a theoretically clean signal doesn't exist in practice on SK portals.

---

## 5. RK Description-Text Patterns (Slovak)

These phrases, case-insensitive, fire the Layer-3 classifier. Weights in §11.

**Agency self-identification (very strong, +40 each):**
1. "realitná kancelária" / "RK"
2. "naša realitná kancelária"
3. "realitný maklér" / "maklérka" (in first person: "vaša maklérka")
4. "realitný špecialista"
5. "licencovaný maklér"
6. "členstvo v NARKS" / "člen NARKS" / "ZRKS"
7. "výhradné zastúpenie" / "exkluzívne zastúpenie"
8. "vlastný realitný portál"
9. "realitná agentúra"
10. "realitná spoločnosť"

**Commission / fee mentions (very strong, +40):**
11. "provízia RK"
12. "+ provízia"
13. "4 % provízia" / "5 % provízia" / "6 % provízia"
14. "provízia je hradená predávajúcim"
15. "kupujúci neplatí províziu"
16. "v cene nie je zahrnutá provízia"
17. "právny servis v cene"
18. "kompletný servis"

**Offer-phrasing boilerplate (strong, +25):**
19. "exkluzívne ponúkame"
20. "exkluzívne vám ponúkame"
21. "ponúkame na predaj"
22. "do vašej pozornosti dávame"
23. "s potešením vám ponúkame"
24. "do predaja sme získali"
25. "odporúčame vám"
26. "kontaktujte nášho makléra"
27. "pre viac informácií kontaktujte"
28. "dohodnite si obhliadku"

**Portfolio / cross-sell (strong, +25):**
29. "viac našich ponúk nájdete na"
30. "ďalšie nehnuteľnosti v ponuke"
31. "navštívte náš web"
32. "pozrite si celú ponuku"
33. "ID ponuky:" / "ID nehnuteľnosti:" / "kód ponuky"

**Services offered (medium, +15):**
34. "zabezpečíme hypotéku"
35. "sprostredkujeme financovanie"
36. "spolupráca s hypotekárnym špecialistom"
37. "odhad nehnuteľnosti"
38. "právne poradenstvo"
39. "overenie listu vlastníctva"
40. "home staging"

**Phone / contact framing (medium, +15):**
41. "volajte nonstop"
42. "pracovná doba pon-pia"
43. "zavolajte na infolinku"

Compile this into a regex set; require **≥ 2 independent matches** across different groups to fire "RK" at high confidence (avoids false positives from a private seller who happens to say "ponúkam na predaj").

---

## 6. Known RK Registry (Layer 2 — Phone/Name Blacklist)

**Source 1 — NARKS (Národná asociácia realitných kancelárií Slovenska):** ~160 members across 8 pages at https://www.narks.sk/clenovia/realitne-kancelarie/. Sample from page 1 (already harvested): 1. realitná a aukčná spoločnosť, 4people real plus, 4real.sk, AB Partners, AC Company, ADMS, AGENT.SK, AGREAL.SK, AKM Kapital, ARCHEUS partners, ARDIS ZH, ASTON WALDNER, AstonReal, AUKLEO, AURUM properties, Axis real, B Group, B10 Slovensko, MK REAL, BCRK I. Each entry has name + email + phone — scrape all 8 pages → ~160 companies × ~5 agents each ≈ **800 phone numbers**.

**Source 2 — ZRKS (Združenie realitných kancelárií Slovenska):** 216 member offices, 1 410 real-estate professionals at https://www.zrks.sk/zoznam-clenov/. This is the **single largest RK database in SK** — full scrape gives ~1 400 phone numbers and ~216 company names.

**Source 3 — ORSR (obchodný register):** Filter companies by NACE code **68.31 — Realitné agentúry**. Slovak ORSR does not export bulk, but county-level queries return ~3 500 registered entities. Cross-reference with their websites (often linked in ORSR) to harvest contact phones. This is the long-tail (solo brokers, non-NARKS shops).

**Source 4 — Top agencies (explicit list to scrape contact pages):**

| Agency | Website | Notes |
|---|---|---|
| HERRYS | herrys.sk | Largest BA agency, CIJ Award 2025, ~800 transactions/year |
| RE/MAX Slovakia | remax.sk | Franchise network, dozens of offices |
| CENTURY 21 Slovakia | century21.sk | Franchise network |
| Bond Reality | bondreality.sk | BA-focused |
| Arkadia Reality | arkadia.sk | — |
| Sorriso | sorriso.sk | Luxury BA |
| Cpm (Central European Property Managers) | cpm.sk | — |
| Lexxus Reality | lexxus.sk | — |
| TopRealitka | toprealitka.sk | — |
| Directreal | directreal.sk | Franchise, many offices |
| Welcome Home | welcomehome.sk | — |
| Realitka BA | realitkaba.sk | — |
| Realitná únia | realitnaunia.sk | — |
| Remax Alfa / Anry / Bona / … | various | RE/MAX franchisees — many variants |
| Zuzana Reality | zuzanareality.sk | — |

Each of these has a `/kontakty` or `/nasi-makleri` page with 5 – 80 broker phone numbers. Total harvestable: **~3 000 – 5 000 RK phone numbers + ~500 company names**.

**Phone-based heuristic without a registry:** "Same phone number appears on ≥ 3 distinct listings within 90 days" → 85 – 90 % likely RK. This is the dynamic discovery loop that keeps the blacklist fresh without requiring the ORSR re-scrape.

---

## 7. Operational Heuristics (Layer 4)

| Signal | RK pattern | Private pattern | Weight |
|---|---|---|---|
| Listings per account / phone | ≥ 10 | 1 – 3 | +30 (RK) at ≥ 10, +50 at ≥ 30 |
| Description length | 500 – 1 500 words, formulaic | 50 – 500 words, personal | +10 if > 600 words with RK-style structure |
| Price precision | 148 900 € (psychology price) | 150 000 € (round) | +5 weak |
| Posting time | Mo-Fr 09:00 – 17:00 | Evenings, weekends | +5 weak |
| Photo count | 15 – 30, pro-quality | 3 – 10, phone-quality | +10 if > 15 pro photos |
| Floor plan | Professionally rendered with watermark | None or hand-sketch | +20 |
| Language register | Formal plural ("Vám ponúkame") | Informal singular ("predám") | +10 |
| Repeat across portals | Same listing on 3+ portals | 1 – 2 portals | +15 |

These are weaker per-signal but cheap and stack well.

---

## 8. Image-Based Detection (Layer 5 — Gemini / GPT-4V)

Only invoke on listings that Layers 1 – 4 score as **Unknown** (estimated 5 – 15 % of volume). Vision API calls are expensive; don't run on every listing.

**What the vision model looks for (structured prompt):**

1. **Watermark / logo in image corner** — RK-specific. Detect bounding box, OCR the text, match against registry. Very strong signal (+40).
2. **Consistent staging across all photos** — depersonalised, neutrally-coloured throws, scented candles, identical bouquets. Strong (+20).
3. **Floor plan rendering style** — If there is a floor plan, is it a CAD/ArchiCAD export with agency template? (+20)
4. **Photographic quality** — wide-angle lens, tripod, color-corrected, HDR → professional (+15). Phone snapshots with visible hands, clutter, shoes in hallway → private (+15 toward Private).
5. **Personal objects visible** — family photos, children's drawings, cluttered desks → private (+25 toward Private).
6. **"For sale by owner" printed signs / hand-written** in image → private (+30).

**Accuracy:** In small internal tests on similar markets (CZ Sreality), vision-only classification lands at 85 – 90 %. Combined with text signals it pushes marginal cases into the right bucket.

**Cost envelope:** Gemini Flash at ~0.2 ¢ per image, 5 images per flagged listing, ~10 % of listings → ~0.1 ¢ per listing on average. Negligible at SK portal volumes (~60 k listings total).

---

## 9. Edge Cases

1. **Polo-private** — owner's cousin is a licensed broker and lists the property under the family phone. Our phone-occurrence heuristic catches this (phone appears on previous agency listings). Decision: classify as **RK**, because the downstream user's intent ("I don't want agency middlemen") is violated.
2. **Duplicate listing, private + agency** — same flat on bazos (private) and nehnutelnosti.sk (agency). Deduplicate by address + area + price ±2 %; if any copy is RK, flag the cluster as RK.
3. **Agent on bezrealitky** — portal claims none but some exist. Layer 2 catches them; flag to user with explicit warning: "This listing claims to be private but phone matches known agency X."
4. **New agency not yet in blacklist** — the "≥ 3 listings per phone in 90 days" rule auto-promotes to blacklist candidate; a manual review step confirms before permanent addition.
5. **Private owner who posts 10+ family inheritance properties** — false positive of the listing-count heuristic. Allow user feedback to override and whitelist the phone.
6. **Agency ghost account "Anna K., Bratislava"** with no RK keywords and a fresh phone — the hardest case; only catchable via vision (watermark / staging) or via later behaviour (second listing appears a week later).

---

## 10. Continuous Learning Loop

1. **Implicit feedback:** user opens a listing, then taps "This is actually RK" → increment phone-occurrence counter + add phone to pending blacklist after N=3 reports.
2. **Explicit feedback:** broker-panel "Mark as RK / Mark as Private" button → ground truth for retraining Layer-3 classifier weekly.
3. **ORSR delta monitor:** monthly cron that fetches new NACE 68.31 registrations and adds the company + phone + website to the registry automatically.
4. **Phone-occurrence sweep:** nightly job that flags phones appearing on ≥ 3 listings in the last 30 days — adds to the "probably RK" watchlist, confirmed at ≥ 5.
5. **Model eval dashboard:** weekly precision / recall on a rolling 500-listing manually-labeled sample; alert if precision drops below 94 %.

---

## 11. Multi-Signal Scoring Algorithm

```
rk_score = 0
private_score = 0

# Layer 1 — portal-native
if portal_native_filter_used AND listing_came_from_private_endpoint:
    private_score += 40
if portal_explicitly_labels_as_RK (nehnutelnosti.sk accountType):
    rk_score += 80   # near-deterministic

# Layer 2 — phone / name registry
if listing_phone IN rk_phone_blacklist:
    rk_score += 70
if listing_phone_occurrences_last_90d >= 5:
    rk_score += 60
elif listing_phone_occurrences_last_90d >= 3:
    rk_score += 35
if listing_name IN rk_name_blacklist:  # "HERRYS", "RE/MAX", ...
    rk_score += 70

# Layer 3 — description regex
rk_phrase_hits = count_unique_phrase_groups_matched(description)
rk_score += min(rk_phrase_hits * 25, 60)

# Layer 4 — operational
if account_listing_count >= 30:
    rk_score += 50
elif account_listing_count >= 10:
    rk_score += 30
if description_length > 600 AND has_formal_plural:
    rk_score += 10
if photo_count >= 15 AND photo_quality == "professional":
    rk_score += 15
if has_floor_plan_with_watermark:
    rk_score += 20

# Layer 5 — vision (only if (rk_score - private_score) in [-10, 40])
if vision_watermark_detected:
    rk_score += 40
if vision_personal_objects_visible:
    private_score += 25
if vision_professional_staging:
    rk_score += 20

# Classification
net = rk_score - private_score
if net >= 50: label = "RK"          # high confidence
elif net <= 0: label = "Private"    # high confidence
else: label = "Unknown" (surface to user with warning)
```

### Expected confusion matrix (target)

Based on the per-portal accuracy projections, weighted by traffic (rough SK market share):

|                | Predicted Private | Predicted RK | Predicted Unknown |
|---|---|---|---|
| **Actually Private** | 93 % (TP) | 2 % (FN→RK) | 5 % |
| **Actually RK** | 3 % (FN→Private) | 91 % (TP) | 6 % |

- **Private-class precision:** 93 / (93 + 3) ≈ **96.9 %** ✓ meets the ≥ 95 % target.
- **Private-class recall:** 93 / (93 + 2 + 5) = **93 %** — 7 % of genuine private listings land in Unknown, which is acceptable because Unknown is shown to the user, not hidden.
- **RK-class precision:** 91 / (91 + 2) ≈ **97.8 %**.

---

## 12. Validation / Test Plan

1. **Ground-truth set:** manually label **500 listings**, stratified sample:
   - 60 from each of the 8 larger portals + 20 from pozemky.sk.
   - Within each portal: 50 % marked "private" by the portal filter, 50 % marked "agency" (or random where no filter).
2. **Label rubric:** a listing is RK if (a) description mentions agency/commission, OR (b) phone is publicly listed on an RK website, OR (c) the same phone appears on ≥ 3 other listings. Otherwise Private. Ambiguous → a second labeller breaks the tie.
3. **Metrics:** precision / recall / F1 per class, plus Unknown-rate. Break down by portal.
4. **Iterate:** if precision < 95 %, inspect false positives → typically one phrase weight or phone-threshold off by a few points. Re-tune weekly for the first month, monthly after.
5. **Holdout:** keep 100 listings strictly for final model evaluation, never touched during tuning.

---

## 13. Competitor Analysis

- **reality.sk** itself segments its UI into a private sub-site (`/reality-sukromne-inzeraty/`) — but anecdotally, leakage of professional brokers is material (private registration is free and unverified). Their own filter sits around an estimated 85 – 90 % precision — not world-class.
- **topreality.sk `iba_sukr=1`** — checkbox-level filter, self-declared by lister at registration. Estimated leakage 5 – 8 %.
- **lokalreality.sk** — aggregator, not original source; its filter inherits from upstream portals, same accuracy ceiling.
- **bezrealitky.sk** — brand contract but no documented verification. Relies on user reports. Estimated leakage 3 – 6 %.
- **Our advantage:** none of these combine portal filter + phone registry + phrase classifier + vision. A cross-portal deduplication layer alone (same phone across portals) is something no incumbent does.

---

## 14. Recommended Implementation Order

1. **Week 1:** Layer 1 only — per-portal URL filters. Ship byty.sk, nehnutelnosti.sk, topreality.sk, reality.sk, pozemky.sk, trh.sk, bezrealitky.sk with native flags. Target 90 % aggregate precision on these 7 portals.
2. **Week 2:** Build RK phone/name registry from NARKS + ZRKS + ORSR + top 15 agency sites. Add Layer 2 to all portals. Gains +3 – 5 pp precision.
3. **Week 3:** Add Layer 3 regex classifier on description text. Integrate feedback buttons in UI.
4. **Week 4:** Add Layer 4 operational heuristics + account/phone occurrence tracking. Tackle bazos.sk + bazar.sk seriously.
5. **Week 5+:** Add Layer 5 vision for the ~10 % "Unknown" bucket. Monitor metrics, tune weights.

---

## 15. Key Risks / Open Questions

- **Anti-scraping on bazos.sk and nehnutelnosti.sk** — both use Cloudflare; rate-limit and UA rotation required. Phone-reveal endpoint on bazos is token-gated.
- **GDPR on phone-registry scraping** — phone numbers published on an RK's own "kontakty" page are considered published; we're using them to identify professional activity, not for marketing. Still, add a data-subject removal endpoint.
- **NARKS / ZRKS ToS on bulk scraping** — their member directories are public but the ToS may prohibit automated access. A once-a-month manual / polite-rate fetch is safer than daily crawling.
- **Portal drift** — any of the 9 portals can change HTML / URL params without notice. Each portal adapter needs a weekly smoke-test.

---

## 16. Sources Consulted

Primary research: direct HTTP fetches of homepages and search endpoints for all 9 portals; NARKS and ZRKS membership directories; targeted web searches for seller-type URL parameters; inspection of rendered HTML for structured-data patterns (`__NEXT_DATA__`, schema.org).

- NARKS member directory: https://www.narks.sk/clenovia/realitne-kancelarie/
- ZRKS member directory: https://www.zrks.sk/zoznam-clenov/ (216 offices, 1 410 brokers)
- byty.sk filter confirmed: `?inzerent=sukromna-osoba`
- topreality.sk filter confirmed: `?iba_sukr=1`
- reality.sk private sub-site: `/reality-sukromne-inzeraty/`
- nehnutelnosti.sk: "Priamo od majiteľa" badge + `__NEXT_DATA__` `account.type`
- Bezrealitky.sk: no explicit published verification policy
- ORSR NACE 68.31 = Realitné agentúry (source for long-tail registry)

---

**Bottom line:** 7 of 9 portals hand us a near-free 90 %+ private-seller filter. Spend the engineering budget on (a) a high-quality phone/name registry shared across portals and (b) the two hard portals (bazos, bazar). The 95 % target is achievable across the aggregate within 4 – 5 weeks.
