// ── SecPro i18n engine ────────────────────────────────────────────────
// Runtime DOM translation. Two surfaces:
//   1. data-i18n="key"               on any element → swaps textContent
//      data-i18n-html="key"          → swaps innerHTML (use sparingly)
//      data-i18n-attr-<NAME>="key"   → swaps attribute NAME (e.g. placeholder, title, value, aria-label)
//   2. t('key')                       in JS → returns translated string
//
// Dictionary lives in i18n-dict.js (window.__I18N_DICT). Falls back to the
// key itself if missing, so untranslated strings stay legible.
//
// Language preference order:
//   1. localStorage 'lang' (mirrors KV user.language)
//   2. <html lang> attribute
//   3. 'sk' (default)

(function () {
  'use strict';

  const DEFAULT_LANG = 'sk';
  const SUPPORTED = ['sk', 'en'];

  function dict() {
    return (window.__I18N_DICT || { sk: {}, en: {} });
  }

  function detectLang() {
    try {
      const stored = localStorage.getItem('lang');
      if (stored && SUPPORTED.includes(stored)) return stored;
    } catch {}
    const htmlLang = document.documentElement.getAttribute('lang');
    if (htmlLang && SUPPORTED.includes(htmlLang)) return htmlLang;
    return DEFAULT_LANG;
  }

  let currentLang = detectLang();

  function t(key, fallback) {
    if (key == null) return '';
    const table = dict()[currentLang] || {};
    if (Object.prototype.hasOwnProperty.call(table, key)) return table[key];
    // Fallback chain: explicit fallback arg → SK dict (if we are in EN) → key string
    if (typeof fallback === 'string') return fallback;
    if (currentLang !== 'sk') {
      const sk = dict().sk || {};
      if (Object.prototype.hasOwnProperty.call(sk, key)) return sk[key];
    }
    return key;
  }

  function applyToElement(el) {
    // textContent
    const k = el.getAttribute('data-i18n');
    if (k) el.textContent = t(k);
    // innerHTML
    const kh = el.getAttribute('data-i18n-html');
    if (kh) el.innerHTML = t(kh);
    // any attribute via data-i18n-attr-<name>
    for (const attr of el.attributes) {
      const m = /^data-i18n-attr-(.+)$/.exec(attr.name);
      if (m) {
        const targetAttr = m[1];
        el.setAttribute(targetAttr, t(attr.value));
      }
    }
  }

  function applyAll(root) {
    const scope = root || document;
    // All elements that carry any i18n marker (matches the 3 attribute styles)
    const sel = '[data-i18n], [data-i18n-html], [data-i18n-attr-placeholder], [data-i18n-attr-title], [data-i18n-attr-value], [data-i18n-attr-aria-label], [data-i18n-attr-alt]';
    scope.querySelectorAll(sel).forEach(applyToElement);
    // Update <html lang>
    document.documentElement.setAttribute('lang', currentLang);
    document.title = t('app.title') || document.title;
  }

  function setLang(lang) {
    if (!SUPPORTED.includes(lang)) return;
    currentLang = lang;
    try { localStorage.setItem('lang', lang); } catch {}
    applyAll();
    // Notify listeners (so app.js can refresh dynamically-rendered content)
    document.dispatchEvent(new CustomEvent('i18n:changed', { detail: { lang } }));
  }

  function getLang() { return currentLang; }

  // MutationObserver: any dynamically-inserted element with data-i18n gets
  // translated automatically. Cheap because we only re-walk added subtrees.
  function observe() {
    const obs = new MutationObserver(mutations => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          // Translate the node itself (if it has data-i18n) and its descendants
          if (node.matches && (
            node.matches('[data-i18n], [data-i18n-html]') ||
            Array.from(node.attributes || []).some(a => a.name.startsWith('data-i18n-attr-'))
          )) applyToElement(node);
          if (node.querySelectorAll) applyAll(node);
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  // ── public API ──
  window.i18n = {
    t,
    setLang,
    getLang,
    applyAll,
    supported: SUPPORTED,
  };
  // Shorthand alias
  window.t = t;

  // Initial paint after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      applyAll();
      observe();
    });
  } else {
    applyAll();
    observe();
  }
})();
