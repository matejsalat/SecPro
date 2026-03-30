# Sidebar Reorganization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the flat 20+ item sidebar into logically grouped collapsible sections (Nehnuteľnosti first, then Finance sub-groups), with global items (Prehľad, História) pinned at top.

**Architecture:** Replace the existing sidebar HTML (lines 2148-2233 in `public/index.html`) with a new grouped structure. Reuse existing CSS classes (`.sidebar-title`, `.sidebar-section`, `.nav-item`) and JS functions (`toggleSection`, `showPage`). Add section-specific color accents via new CSS and localStorage persistence for collapse state.

**Tech Stack:** HTML, CSS, vanilla JavaScript (no new dependencies)

**Constraint:** Nothing is deleted. All page IDs, showPage targets, and page content remain unchanged.

---

### Task 1: Add section-specific CSS styles

**Files:**
- Modify: `public/index.html:93-115` (CSS section for sidebar)

- [ ] **Step 1: Add color accent CSS for each sidebar group**

Add these styles after line 115 (after `.sidebar-section.collapsed` rule) in the `<style>` block:

```css
/* Section-specific color accents */
.sidebar-global {
  padding-bottom: 0.5rem;
  margin-bottom: 0.25rem;
  border-bottom: 1px solid rgba(46,196,212,0.1);
}
.sidebar-global .nav-item.active {
  border-left-color: #2EC4D4;
  color: #2EC4D4;
}

.sidebar-title[data-section="nehnutelnosti"] { color: rgba(52,211,153,0.7); }
.sidebar-title[data-section="nehnutelnosti"]:hover { color: rgba(52,211,153,1); }
.sidebar-title[data-section="nehnutelnosti"] + .sidebar-section .nav-item.active {
  border-left-color: #34d399;
  color: #34d399;
  background: rgba(52,211,153,0.08);
}

.sidebar-title[data-section="kalkulacky"] { color: rgba(96,165,250,0.7); }
.sidebar-title[data-section="kalkulacky"]:hover { color: rgba(96,165,250,1); }
.sidebar-title[data-section="kalkulacky"] + .sidebar-section .nav-item.active {
  border-left-color: #60a5fa;
  color: #60a5fa;
  background: rgba(96,165,250,0.08);
}

.sidebar-title[data-section="hypoteky"] { color: rgba(129,140,248,0.7); }
.sidebar-title[data-section="hypoteky"]:hover { color: rgba(129,140,248,1); }
.sidebar-title[data-section="hypoteky"] + .sidebar-section .nav-item.active {
  border-left-color: #818cf8;
  color: #818cf8;
  background: rgba(129,140,248,0.08);
}

.sidebar-title[data-section="metodika"] { color: rgba(156,163,175,0.7); }
.sidebar-title[data-section="metodika"]:hover { color: rgba(156,163,175,1); }
.sidebar-title[data-section="metodika"] + .sidebar-section .nav-item.active {
  border-left-color: #9ca3af;
  color: #9ca3af;
  background: rgba(156,163,175,0.08);
}
```

- [ ] **Step 2: Verify the CSS is valid**

Open `public/index.html` in the browser and check that the page loads without console errors. The sidebar will still have the old structure at this point — we're just adding CSS that will take effect after we change the HTML.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: add section-specific color accent CSS for sidebar groups"
```

---

### Task 2: Replace sidebar HTML with new grouped structure

**Files:**
- Modify: `public/index.html:2148-2233` (sidebar nav element)

- [ ] **Step 1: Replace the sidebar content**

Replace lines 2148-2233 (the entire `<nav class="sidebar">...</nav>` block) with this new sidebar markup:

```html
  <nav class="sidebar">
    <!-- Global items - always visible -->
    <div class="sidebar-global">
      <div class="nav-item active" onclick="showPage('home')">
        <span class="nav-icon"><i data-lucide="layout-dashboard"></i></span> Prehľad
      </div>
      <div class="nav-item" onclick="showPage('historia')">
        <span class="nav-icon"><i data-lucide="history"></i></span> História analýz
      </div>
    </div>

    <!-- Section 1: Nehnuteľnosti -->
    <div class="sidebar-title" data-section="nehnutelnosti" onclick="toggleSection(this)">Nehnuteľnosti <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></div>
    <div class="sidebar-section">
      <div class="nav-item" onclick="showPage('leads')">
        <span class="nav-icon"><i data-lucide="search"></i></span> Vyhľadávanie
      </div>
      <div class="nav-item" onclick="showPage('myproperties')">
        <span class="nav-icon"><i data-lucide="home"></i></span> Moje nehnuteľnosti
      </div>
      <div class="nav-item" onclick="showPage('contacts')">
        <span class="nav-icon"><i data-lucide="contact"></i></span> Kontakty
      </div>
      <div class="nav-item" onclick="openAiSettings()">
        <span class="nav-icon"><i data-lucide="sparkles"></i></span> AI Nastavenia
      </div>
    </div>

    <!-- Section 2: Investičné kalkulačky -->
    <div class="sidebar-title" style="margin-top:0.75rem" data-section="kalkulacky" onclick="toggleSection(this)">Investičné kalkulačky <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></div>
    <div class="sidebar-section">
      <div class="nav-item" onclick="showPage('investovanie')">
        <span class="nav-icon"><i data-lucide="trending-up"></i></span> Investovanie
      </div>
      <div class="nav-item" onclick="showPage('milionova')">
        <span class="nav-icon"><i data-lucide="target"></i></span> Miliónová kalkulačka
      </div>
      <div class="nav-item" onclick="showPage('renta')">
        <span class="nav-icon"><i data-lucide="wallet"></i></span> Mesačná renta
      </div>
      <div class="nav-item" onclick="showPage('rezerva')">
        <span class="nav-icon"><i data-lucide="piggy-bank"></i></span> Tvorba rezervy
      </div>
      <div class="nav-item" onclick="showPage('dividenda')">
        <span class="nav-icon"><i data-lucide="coins"></i></span> Dividendové fondy
      </div>
      <div class="nav-item" onclick="showPage('pilier')">
        <span class="nav-icon"><i data-lucide="shield-check"></i></span> II. Pilier
      </div>
      <div class="nav-item" onclick="showPage('finmath')">
        <span class="nav-icon"><i data-lucide="calculator"></i></span> Finančná matematika
      </div>
    </div>

    <!-- Section 3: Hypotéky -->
    <div class="sidebar-title" style="margin-top:0.75rem" data-section="hypoteky" onclick="toggleSection(this)">Hypotéky <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></div>
    <div class="sidebar-section">
      <div class="nav-item" onclick="showPage('mhypoteka')">
        <span class="nav-icon"><i data-lucide="home"></i></span> Jedna domácnosť
      </div>
      <div class="nav-item" onclick="showPage('mhypoteka-multi')">
        <span class="nav-icon"><i data-lucide="users"></i></span> Viac domácností
      </div>
      <div class="nav-item" onclick="showPage('hypoteka')">
        <span class="nav-icon"><i data-lucide="building-2"></i></span> Hypotéka + Investícia
      </div>
      <div class="nav-item" onclick="showPage('mhypoteka-rovne')">
        <span class="nav-icon"><i data-lucide="equal"></i></span> Rovné splátky
      </div>
      <div class="nav-item" onclick="showPage('mhypoteka-klesajuce')">
        <span class="nav-icon"><i data-lucide="trending-down"></i></span> Klesajúce splátky
      </div>
    </div>

    <!-- Section 4: Metodika & Klient -->
    <div class="sidebar-title" style="margin-top:0.75rem" data-section="metodika" onclick="toggleSection(this)">Metodika & Klient <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></div>
    <div class="sidebar-section">
      <div class="nav-item" onclick="showPage('metodika')">
        <span class="nav-icon"><i data-lucide="bar-chart-3"></i></span> Porovnanie bánk
      </div>
      <div class="nav-item" onclick="showPage('aof')">
        <span class="nav-icon"><i data-lucide="clipboard-list"></i></span> Vstupné údaje klienta
      </div>
      <div class="nav-item" onclick="showPage('rozlozenie')">
        <span class="nav-icon"><i data-lucide="pie-chart"></i></span> Rozloženie investície
      </div>
    </div>
  </nav>
```

- [ ] **Step 2: Verify all nav items are present**

Checklist — every one of these page IDs must appear in the new sidebar:
- `home`, `historia` (global)
- `leads`, `myproperties`, `contacts`, `openAiSettings()` (nehnuteľnosti)
- `investovanie`, `milionova`, `renta`, `rezerva`, `dividenda`, `pilier`, `finmath` (kalkulačky)
- `mhypoteka`, `mhypoteka-multi`, `hypoteka`, `mhypoteka-rovne`, `mhypoteka-klesajuce` (hypotéky)
- `metodika`, `aof`, `rozlozenie` (metodika)

Count: 20 items total. Same as before — nothing removed.

- [ ] **Step 3: Open in browser and test navigation**

Run: `node server.js` (if not already running)

Test each sidebar item — click it and verify the correct page appears. Pay special attention to:
- `home` and `historia` are above the groups, not inside any collapsible section
- Nehnuteľnosti section is first
- Each group collapses/expands when you click its header
- Active item highlighting uses the correct section color

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat: reorganize sidebar into grouped sections (nehnuteľnosti, kalkulačky, hypotéky, metodika)"
```

---

### Task 3: Add localStorage persistence for collapse state

**Files:**
- Modify: `public/index.html:4674-4679` (toggleSection function)

- [ ] **Step 1: Replace the toggleSection function**

Replace the existing `toggleSection` function (around line 4674-4679) with this version that saves state to localStorage:

```javascript
function toggleSection(titleEl) {
  const section = titleEl.nextElementSibling;
  if (!section || !section.classList.contains('sidebar-section')) return;
  titleEl.classList.toggle('collapsed');
  section.classList.toggle('collapsed');

  // Save collapse state to localStorage
  const sectionName = titleEl.getAttribute('data-section');
  if (sectionName) {
    const states = JSON.parse(localStorage.getItem('secpro-sidebar-state') || '{}');
    states[sectionName] = titleEl.classList.contains('collapsed');
    localStorage.setItem('secpro-sidebar-state', JSON.stringify(states));
  }
}
```

- [ ] **Step 2: Add restore function after toggleSection**

Add this function directly after `toggleSection`:

```javascript
function restoreSidebarState() {
  const states = JSON.parse(localStorage.getItem('secpro-sidebar-state') || '{}');
  Object.keys(states).forEach(function(sectionName) {
    if (states[sectionName]) {
      const titleEl = document.querySelector('.sidebar-title[data-section="' + sectionName + '"]');
      if (titleEl) {
        titleEl.classList.add('collapsed');
        var section = titleEl.nextElementSibling;
        if (section) section.classList.add('collapsed');
      }
    }
  });
}
```

- [ ] **Step 3: Call restoreSidebarState on page load**

Find the existing `DOMContentLoaded` listener or the `lucide.createIcons()` call (around line 4668-4671) and add `restoreSidebarState();` right after `lucide.createIcons();`:

```javascript
document.addEventListener('DOMContentLoaded', function() {
  lucide.createIcons();
  restoreSidebarState();
});
```

If `lucide.createIcons()` is already inside a DOMContentLoaded handler, just add `restoreSidebarState();` on the next line.

- [ ] **Step 4: Test persistence**

1. Open the app in the browser
2. Collapse "Investičné kalkulačky" section
3. Refresh the page (Cmd+R)
4. Verify "Investičné kalkulačky" is still collapsed
5. Expand it again, refresh — verify it stays expanded

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat: persist sidebar collapse state in localStorage"
```

---

### Task 4: Final verification

- [ ] **Step 1: Full navigation test**

Open the app and click through every single sidebar item. Verify each one shows the correct page:

| Sidebar item | Expected page ID |
|---|---|
| Prehľad | page-home |
| História analýz | page-historia |
| Vyhľadávanie | page-leads |
| Moje nehnuteľnosti | page-myproperties |
| Kontakty | page-contacts |
| AI Nastavenia | opens AI settings modal |
| Investovanie | page-investovanie |
| Miliónová kalkulačka | page-milionova |
| Mesačná renta | page-renta |
| Tvorba rezervy | page-rezerva |
| Dividendové fondy | page-dividenda |
| II. Pilier | page-pilier |
| Finančná matematika | page-finmath |
| Jedna domácnosť | page-mhypoteka |
| Viac domácností | page-mhypoteka-multi |
| Hypotéka + Investícia | page-hypoteka |
| Rovné splátky | page-mhypoteka-rovne |
| Klesajúce splátky | page-mhypoteka-klesajuce |
| Porovnanie bánk | page-metodika |
| Vstupné údaje klienta | page-aof |
| Rozloženie investície | page-rozlozenie |

- [ ] **Step 2: Test collapse/expand**

1. Collapse all 4 sections — verify all items hide with smooth animation
2. Expand all 4 sections — verify all items appear
3. Verify global items (Prehľad, História) are NEVER hidden by collapse

- [ ] **Step 3: Test active state colors**

1. Click a Nehnuteľnosti item — active highlight should be green
2. Click an Investičné kalkulačky item — active highlight should be blue
3. Click a Hypotéky item — active highlight should be indigo/purple
4. Click a Metodika item — active highlight should be gray

- [ ] **Step 4: Test auto-expand on navigation**

1. Collapse "Hypotéky" section
2. Click a home page link that navigates to `mhypoteka` (e.g. from the home page featured cards)
3. Verify the Hypotéky section auto-expands and the item is highlighted

- [ ] **Step 5: Commit if any fixes were needed**

```bash
git add public/index.html
git commit -m "fix: sidebar reorganization fixes after testing"
```
