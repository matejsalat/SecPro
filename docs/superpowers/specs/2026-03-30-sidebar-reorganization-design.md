# Sidebar Reorganization — Grouped Sections Design

## Problem

The SecPro sidebar has 20+ flat items with no logical grouping. Two user types exist (finance-focused and real-estate-focused) but both occasionally cross over. The flat list makes navigation chaotic and slow.

## Decision

Reorganize the sidebar into logically grouped, collapsible sections. No pages or functionality will be removed — only the sidebar navigation structure changes.

## Sidebar Structure (top to bottom)

### Global Items (always visible, above groups)
1. **Prehľad** (Home/Dashboard) — first item, home icon
2. **História analýz** (Analysis History) — second item, clipboard icon

### Section 1 — Nehnuteľnosti (Real Estate) — green accent
- Vyhľadávanie (Leads search)
- Moje nehnuteľnosti (My Properties)
- AI Inzeráty (AI Listing Generator)

### Section 2 — Investičné kalkulačky (Investment Calculators) — blue accent
- Investovanie
- Miliónová kalkulačka
- Mesačná renta
- Tvorba rezervy
- Dividendové fondy
- II. Pilier
- Finančná matematika

### Section 3 — Hypotéky (Mortgages) — dark blue accent
- Hypotéka - Jedna domácnosť
- Hypotéka - Viac domácností
- Hypotéka + Investícia
- Rovné splátky
- Klesajúce splátky

### Section 4 — Metodika & Klient (Methodology & Client) — gray accent
- Porovnanie bánk (Metodika)
- Vstupné údaje klienta (AOF)
- Rozloženie

### Header
- Login/Register/Profile stays in the top-right header area (unchanged)

## Behavior

- **Collapsible groups:** Clicking a group header collapses/expands the group's items
- **State persistence:** Collapsed/expanded state saved to localStorage per group
- **Default state:** All groups expanded on first visit
- **Active item highlight:** The currently active page is highlighted in the sidebar regardless of group state (if group is collapsed and user navigates via direct link, group auto-expands)

## Visual Design

- Group headers: uppercase label, section-specific color accent, collapse/expand chevron icon
- Divider line between global items (Prehľad, História) and grouped sections
- Color accents per section:
  - Nehnuteľnosti: green (#059669)
  - Investičné kalkulačky: blue (#2563eb)
  - Hypotéky: dark blue (#1e40af)
  - Metodika & Klient: gray (#6b7280)
- Items within groups: standard sidebar item style (existing), indented under group header

## Technical Scope

- **Only file changed:** `public/index.html` (sidebar HTML markup + JS for collapse/expand + CSS for group styling)
- **No backend changes**
- **No page content changes** — all `showPage()` targets remain identical
- **No pages removed** — every existing page ID stays in the DOM
- **Nothing deleted** — only sidebar navigation markup is reorganized

## What Does NOT Change

- All calculator pages and their functionality
- All real estate tools (leads, detail, AI generate)
- Page IDs and showPage() function
- Header layout and login/register
- PDF generation
- localStorage data for analyses
- API endpoints
- Any scraper logic
