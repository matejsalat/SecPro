#!/usr/bin/env python3
"""Finish translating the last 19 Slovak strings in index.html.

Each entry below is (search_substring, replacement_substring).
The search must be unique enough across the whole file to avoid mis-matches.
"""
import os, re, sys
import json

HTML = "/Users/matej/Desktop/Projects/secpro/public/index.html"
DICT = "/Users/matej/Desktop/Projects/secpro/public/i18n-dict.js"

# (old, new) html replacements. Each old MUST appear exactly once in the file.
replacements = [
    # L998 — mhypoteka PDF report button (text is inside button, find by surrounding)
    (
        '            &#128196; Stiahnuť PDF Report pre klienta\n',
        '            <span data-i18n-html="mort.btn.pdf_report">&#128196; Stiahnuť PDF Report pre klienta</span>\n'
    ),
    # L1001
    (
        '            &#128190; Uložiť analýzu\n',
        '            <span data-i18n-html="mort.btn.save_analysis">&#128190; Uložiť analýzu</span>\n'
    ),
    # L1891 (page-ai help inside a div)
    (
        '                Kľúč sa ukladá len lokálne vo vašom prehliadači.\n',
        '                <span data-i18n="ai.key.local_only">Kľúč sa ukladá len lokálne vo vašom prehliadači.</span>\n'
    ),
    # L1989
    (
        '              Napíšte vlastné inštrukcie, ktoré AI zohľadní pri generovaní. Napr. "Vždy spomeň blízkosť k centru" alebo "Nepoužívaj slovo exkluzívny".\n',
        '              <span data-i18n="ai.custom.long_help">Napíšte vlastné inštrukcie, ktoré AI zohľadní pri generovaní. Napr. "Vždy spomeň blízkosť k centru" alebo "Nepoužívaj slovo exkluzívny".</span>\n'
    ),
    # L1998
    (
        '              Vložte svoje predošlé inzeráty. AI sa naučí váš štýl a bude generovať podobné texty.\n',
        '              <span data-i18n="ai.samples.long_help">Vložte svoje predošlé inzeráty. AI sa naučí váš štýl a bude generovať podobné texty.</span>\n'
    ),
    # L2591 — page-signatures legal disclaimer (contains <b>...</b>, use data-i18n-html)
    (
        '          Lokálne podpisy sú <b>jednoduché elektronické podpisy</b> (§40 OZ). Každý záznam obsahuje SHA-256 hash obsahu ako audit dôkaz.\n',
        '          <span data-i18n-html="sigs.disclaimer.local">Lokálne podpisy sú <b>jednoduché elektronické podpisy</b> (§40 OZ). Každý záznam obsahuje SHA-256 hash obsahu ako audit dôkaz.</span>\n'
    ),
    # L2809
    (
        '                💡 Odkaz sa vygeneruje pri odoslaní. Telo je upraviteľné.\n',
        '                <span data-i18n="sigs.helper.link_generated">💡 Odkaz sa vygeneruje pri odoslaní. Telo je upraviteľné.</span>\n'
    ),
    # L2845
    (
        '              alebo iba skopírovať samotný odkaz (bez emailu)\n',
        '              <span data-i18n="sigs.helper.or_copy_link">alebo iba skopírovať samotný odkaz (bez emailu)</span>\n'
    ),
    # L3639 — PDF protocol button text
    (
        '            Vygenerovať a stiahnuť PDF protokol\n',
        '            <span data-i18n="docs.protocol.generate">Vygenerovať a stiahnuť PDF protokol</span>\n'
    ),
    # L3774 — placeholder (atomic attribute add)
    (
        '<input type="text" id="sig-signer-name" placeholder="Ján Novák" style="width:100%;" />',
        '<input type="text" id="sig-signer-name" placeholder="Ján Novák" data-i18n-attr-placeholder="profile.placeholder.name" style="width:100%;" />'
    ),
    # L3791 — signature legal disclaimer
    (
        '            ℹ️ Podpisom beriete na vedomie, že ide o <b>jednoduchý elektronický podpis</b> v zmysle §40 Občianskeho zákonníka. Audit záznam (meno, čas, dokument) sa uloží do histórie.\n',
        '            <span data-i18n-html="sigs.disclaimer.civil_code">ℹ️ Podpisom beriete na vedomie, že ide o <b>jednoduchý elektronický podpis</b> v zmysle §40 Občianskeho zákonníka. Audit záznam (meno, čas, dokument) sa uloží do histórie.</span>\n'
    ),
    # L3813
    (
        '<input type="text" id="contact-name" placeholder="Ján Novák" required />',
        '<input type="text" id="contact-name" placeholder="Ján Novák" data-i18n-attr-placeholder="profile.placeholder.name" required />'
    ),
    # L4192
    (
        '<input type="text" id="prop-owner" placeholder="Ján Novák" />',
        '<input type="text" id="prop-owner" placeholder="Ján Novák" data-i18n-attr-placeholder="profile.placeholder.name" />'
    ),
    # L4234 — Use template button
    (
        '                  📝 Použiť šablónu\n',
        '                  <span data-i18n="prop.modal.use_template">📝 Použiť šablónu</span>\n'
    ),
    # L4237 — Sample listings
    (
        '                  📚 Vzorové inzeráty\n',
        '                  <span data-i18n="prop.modal.sample_listings">📚 Vzorové inzeráty</span>\n'
    ),
    # L4268 — preview helper
    (
        '              Pozrite si ako bude váš inzerát vyzerať pred publikovaním. Vpravo sú kontroly kvality pre vybraný portál.\n',
        '              <span data-i18n="prop.preview.helper">Pozrite si ako bude váš inzerát vyzerať pred publikovaním. Vpravo sú kontroly kvality pre vybraný portál.</span>\n'
    ),
    # L4441 — Sample ads helper
    (
        '        Vložte texty svojich predošlých inzerátov (5-10). AI sa naučí váš štýl písania a bude generovať popisy v rovnakom tóne a štruktúre.\n',
        '        <span data-i18n="ai.samples_modal.helper">Vložte texty svojich predošlých inzerátov (5-10). AI sa naučí váš štýl písania a bude generovať popisy v rovnakom tóne a štruktúre.</span>\n'
    ),
    # L4499 — Anthropic key help (contains <a>, use data-i18n-html)
    (
        '          Získajte kľúč na <a href="https://console.anthropic.com" target="_blank" style="color:var(--primary);">console.anthropic.com</a>.\n',
        '          <span data-i18n-html="ai.modal.key_get_at">Získajte kľúč na <a href="https://console.anthropic.com" target="_blank" style="color:var(--primary);">console.anthropic.com</a>.</span>\n'
    ),
    # L4500 — duplicate "Kľúč sa ukladá..."
    (
        '          Kľúč sa ukladá len lokálne vo vašom prehliadači.\n',
        '          <span data-i18n="ai.key.local_only">Kľúč sa ukladá len lokálne vo vašom prehliadači.</span>\n'
    ),
]

# Dictionary entries (key, sk_value, en_value)
dict_entries = [
    ("mort.btn.pdf_report", '&#128196; Stiahnuť PDF Report pre klienta', '&#128196; Download PDF report for client'),
    ("mort.btn.save_analysis", '&#128190; Uložiť analýzu', '&#128190; Save analysis'),
    ("ai.key.local_only", 'Kľúč sa ukladá len lokálne vo vašom prehliadači.', 'The key is stored only locally in your browser.'),
    ("ai.custom.long_help", 'Napíšte vlastné inštrukcie, ktoré AI zohľadní pri generovaní. Napr. "Vždy spomeň blízkosť k centru" alebo "Nepoužívaj slovo exkluzívny".', 'Write custom instructions the AI should follow when generating. E.g. "Always mention proximity to the centre" or "Do not use the word exclusive".'),
    ("ai.samples.long_help", 'Vložte svoje predošlé inzeráty. AI sa naučí váš štýl a bude generovať podobné texty.', 'Paste your past listings. The AI will learn your style and generate similar copy.'),
    ("sigs.disclaimer.local", 'Lokálne podpisy sú <b>jednoduché elektronické podpisy</b> (§40 OZ). Každý záznam obsahuje SHA-256 hash obsahu ako audit dôkaz.', 'Local signatures are <b>simple electronic signatures</b> (§40 of the Civil Code). Each record contains a SHA-256 hash of the content as audit evidence.'),
    ("sigs.helper.link_generated", '💡 Odkaz sa vygeneruje pri odoslaní. Telo je upraviteľné.', '💡 The link is generated upon sending. The body is editable.'),
    ("sigs.helper.or_copy_link", 'alebo iba skopírovať samotný odkaz (bez emailu)', 'or just copy the link itself (without email)'),
    ("docs.protocol.generate", 'Vygenerovať a stiahnuť PDF protokol', 'Generate and download PDF protocol'),
    ("sigs.disclaimer.civil_code", 'ℹ️ Podpisom beriete na vedomie, že ide o <b>jednoduchý elektronický podpis</b> v zmysle §40 Občianskeho zákonníka. Audit záznam (meno, čas, dokument) sa uloží do histórie.', 'ℹ️ By signing, you acknowledge this is a <b>simple electronic signature</b> per §40 of the Slovak Civil Code. The audit record (name, time, document) is preserved.'),
    ("prop.modal.use_template", '📝 Použiť šablónu', '📝 Use template'),
    ("prop.modal.sample_listings", '📚 Vzorové inzeráty', '📚 Sample listings'),
    ("prop.preview.helper", 'Pozrite si ako bude váš inzerát vyzerať pred publikovaním. Vpravo sú kontroly kvality pre vybraný portál.', 'Preview how your listing will appear before publishing. Quality checks for the chosen portal are on the right.'),
    ("ai.samples_modal.helper", 'Vložte texty svojich predošlých inzerátov (5-10). AI sa naučí váš štýl písania a bude generovať popisy v rovnakom tóne a štruktúre.', 'Paste the text of your past listings (5–10). The AI will learn your writing style and generate descriptions in the same tone and structure.'),
    ("ai.modal.key_get_at", 'Získajte kľúč na <a href="https://console.anthropic.com" target="_blank" style="color:var(--primary);">console.anthropic.com</a>.', 'Get your key at <a href="https://console.anthropic.com" target="_blank" style="color:var(--primary);">console.anthropic.com</a>.'),
]


def apply_html():
    with open(HTML, 'r') as f:
        content = f.read()

    misses = []
    for old, new in replacements:
        count = content.count(old)
        if count == 0:
            misses.append(("not found", old[:80]))
            continue
        if count > 1:
            misses.append((f"{count} matches (must be unique)", old[:80]))
            continue
        content = content.replace(old, new, 1)

    tmp = HTML + ".tmp"
    with open(tmp, 'w') as f:
        f.write(content)
    os.replace(tmp, HTML)
    return misses


def js_escape(s):
    # JS string literal — escape backslashes, single quotes, and use single-quote wrap
    return s.replace('\\', '\\\\').replace("'", "\\'")


def apply_dict():
    with open(DICT, 'r') as f:
        content = f.read()

    # Build the entries block
    sk_lines = []
    en_lines = []
    for key, sk_v, en_v in dict_entries:
        sk_lines.append(f"    '{key}': '{js_escape(sk_v)}',")
        en_lines.append(f"    '{key}': '{js_escape(en_v)}',")

    sk_block = '\n    // ── Final leftovers (Pass 2D) ──\n' + '\n'.join(sk_lines) + '\n'
    en_block = '\n    // ── Final leftovers (Pass 2D) ──\n' + '\n'.join(en_lines) + '\n'

    # Find the end of sk: { ... } block. The dict structure ends with: "  },\n  en: {"
    # We need to insert before the closing "},\n  en: {"
    sk_end_marker = '\n  },\n\n  en: {'
    if sk_end_marker not in content:
        sk_end_marker = '\n  },\n  en: {'
    if sk_end_marker not in content:
        return ["sk: block closing not found"]
    content = content.replace(sk_end_marker, sk_block + sk_end_marker, 1)

    # Find the en block close: last "  },\n};" before the file end
    en_end_marker = '\n  },\n};'
    if en_end_marker not in content:
        return ["en: block closing not found"]
    content = content.replace(en_end_marker, en_block + en_end_marker, 1)

    tmp = DICT + ".tmp"
    with open(tmp, 'w') as f:
        f.write(content)
    os.replace(tmp, DICT)
    return []


if __name__ == '__main__':
    print("Applying HTML replacements…")
    misses = apply_html()
    if misses:
        print("HTML misses:")
        for m in misses:
            print(f"  {m}")
    else:
        print(f"  ✓ All {len(replacements)} HTML replacements applied.")

    print("\nAppending dictionary entries…")
    dict_errors = apply_dict()
    if dict_errors:
        print("Dict errors:")
        for e in dict_errors:
            print(f"  {e}")
        sys.exit(1)
    print(f"  ✓ {len(dict_entries)} keys added to SK + EN blocks.")
