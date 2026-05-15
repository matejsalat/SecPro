#!/usr/bin/env python3
"""Pass 3: Wrap showToast / alert / confirm Slovak strings with t() calls.

Reads app.js, finds every SK-content string literal inside these calls,
replaces it with t('key'), and adds dictionary entries (sk + en).
"""
import os
import re
import unicodedata

APP_JS = "/Users/matej/Desktop/Projects/secpro/public/app.js"
DICT = "/Users/matej/Desktop/Projects/secpro/public/i18n-dict.js"

SK_DIACR = re.compile(r"[áäčďéíľĺňóôŕšťúýžÁÄČĎÉÍĽĹŇÓÔŔŠŤÚÝŽ]")

# Hand-written translation table (most common 50 strings; agent-translated).
# Key format: snake_case stripped of diacritics + truncated.
TRANSLATIONS = {
    # showToast — feedback after user actions
    "Najprv spravte výpočet!": "Run a calculation first.",
    "Analýza uložená!": "Analysis saved.",
    "Analýza aktualizovaná!": "Analysis updated.",
    "Profil uložený": "Profile saved.",
    "Profil uložený.": "Profile saved.",
    "Záznam uložený": "Record saved.",
    "Záznam uložený.": "Record saved.",
    "Záznam vymazaný": "Record deleted.",
    "Záznam vymazaný.": "Record deleted.",
    "Vymazané": "Deleted.",
    "Skopírované do schránky": "Copied to clipboard.",
    "Skopírované do schránky.": "Copied to clipboard.",
    "Skopírované": "Copied.",
    "Skopírované.": "Copied.",
    "Nepodarilo sa skopírovať": "Failed to copy.",
    "Nepodarilo sa uložiť": "Failed to save.",
    "Nepodarilo sa odoslať": "Failed to send.",
    "Nepodarilo sa odstrániť": "Failed to delete.",
    "Nepodarilo sa načítať": "Failed to load.",
    "Vyplňte povinné polia": "Fill in required fields.",
    "Vyplňte všetky polia": "Fill in all fields.",
    "Neplatný formát": "Invalid format.",
    "Neplatné údaje": "Invalid data.",
    "Niečo sa pokazilo": "Something went wrong.",
    "Niečo sa pokazilo. Skúste znova.": "Something went wrong. Try again.",
    "Chyba siete": "Network error.",
    "Chyba siete. Skúste znova.": "Network error. Try again.",
    "Chyba pri ukladaní": "Save error.",
    "Chyba pri odosielaní": "Send error.",
    "Pridané": "Added.",
    "Aktualizované": "Updated.",
    "Schválené": "Approved.",
    "Zamietnuté": "Rejected.",
    "Odoslané": "Sent.",
    "Stiahnuté": "Downloaded.",
    "Generuje sa…": "Generating…",
    "Generuje sa...": "Generating…",
    "Načítavam…": "Loading…",
    "Načítavam...": "Loading…",
    "Hotovo": "Done.",
    "Hotovo!": "Done!",
    "Hotovo.": "Done.",
    "Klient bol pridaný": "Client added.",
    "Klient bol vymazaný": "Client deleted.",
    "Klient bol aktualizovaný": "Client updated.",
    "Nehnuteľnosť bola pridaná": "Property added.",
    "Nehnuteľnosť bola uložená": "Property saved.",
    "Nehnuteľnosť bola vymazaná": "Property deleted.",
    "Nehnuteľnosť bola aktualizovaná": "Property updated.",
    "Podpis bol uložený": "Signature saved.",
    "Podpis bol vymazaný": "Signature deleted.",
    "Odkaz bol skopírovaný": "Link copied.",
    "Email odoslaný": "Email sent.",
    "Email bol odoslaný": "Email sent.",
    "Maximálne {n} fotiek.": "Maximum {n} photos.",  # template form
    # alert
    "Vyplňte meno klienta.": "Fill in the client's name.",
    # confirm
    "Naozaj chcete odstrániť tohto klienta?": "Are you sure you want to delete this client?",
    "Vymazať tento podpis?": "Delete this signature?",

    # Additional discovered strings — pass 3 round 2
    "Adresu sa nepodarilo nájsť": "Address not found.",
    "Analýza načítaná!": "Analysis loaded.",
    "Analýza premenovaná!": "Analysis renamed.",
    "Analýza vymazaná!": "Analysis deleted.",
    "Cena uložená": "Price saved.",
    "Chyba pri načítaní": "Loading error.",
    "Chyba pri načítavaní POI": "Error loading points of interest.",
    "Chyba pri vyhľadávaní adresy": "Address lookup error.",
    "Chyba: dáta nie sú dostupné": "Error: data not available.",
    "Dokument je znova editovateľný. Po úprave odošlite klientovi nový odkaz na podpis.": "Document is editable again. After making changes, send the client a new signing link.",
    "Link skopírovaný do schránky!": "Link copied to clipboard.",
    "Link skopírovaný!": "Link copied.",
    "Mapa nie je ešte pripravená — počkajte sekundu a skúste znova": "Map not ready yet — wait a moment and try again.",
    "Najprv sa podpíšte.": "Please sign first.",
    "Neplatná cena": "Invalid price.",
    "Nepodarilo sa načítať fotku": "Failed to load the photo.",
    "Nepodarilo sa načítať podpis": "Failed to load the signature.",
    "Nepodarilo sa prečítať údaje": "Failed to read the data.",
    "Nie ste prihlásený": "You are not signed in.",
    "Odkaz skopírovaný do schránky ✓": "Link copied to clipboard ✓",
    "POI cache vyčistená — fetchujem znova...": "POI cache cleared — fetching again…",
    "Podpis zaznamenaný": "Signature captured.",
    "Priblížil som mapu — POI sa zobrazujú od mestského zoomu.": "Zoomed in — points of interest appear at city zoom level.",
    "Pripomienka pridaná": "Reminder added.",
    "Pripravené na novú analýzu": "Ready for a new analysis.",
    "Relácia vypršala. Prihláste sa znova.": "Session expired. Please sign in again.",
    "Skopírované — vložte do Gmail/Outlook compose ✓": "Copied — paste into Gmail/Outlook compose ✓",
    "Stav obchodu uložený ✓": "Deal status saved ✓",
    "Ukladanie zlyhalo. Dáta sú uložené lokálne.": "Save failed. Data is stored locally.",
    "V tomto výseku sa nenašli žiadne POI — skúste posunúť mapu alebo zväčšiť výsek": "No points of interest in this area — try panning the map or zooming out.",
    "Vybrané nehnuteľnosti sú už publikované alebo neaktívne": "The selected properties are already published or inactive.",
    "Vyplňte dátum a čas": "Fill in the date and time.",
    "Vyplňte meno klienta": "Fill in the client's name.",
    "Vyplňte text pripomienky": "Fill in the reminder text.",
    "Zadajte celé meno": "Enter the full name.",
    "Zadajte meno podpisujúceho.": "Enter the signer's name.",
    "Žiadna z vybraných nie je publikovaná": "None of the selected items is published.",
}


def slug_key(s):
    """Derive a snake_case toast.* key from the original Slovak string."""
    # Remove diacritics
    nfkd = unicodedata.normalize('NFKD', s)
    ascii_str = ''.join(c for c in nfkd if not unicodedata.combining(c))
    # Lower, alphanumerics + spaces only
    ascii_str = re.sub(r'[^a-zA-Z0-9 ]+', ' ', ascii_str).lower().strip()
    parts = ascii_str.split()
    # Truncate to 6 words for sane keys
    return '_'.join(parts[:6])


def auto_translate(sk):
    """Light fallback EN translation if not in TRANSLATIONS table."""
    # Just trim and titlecase as a placeholder so missing entries stay legible
    return sk  # caller will check and skip if missing


def main():
    with open(APP_JS, 'r') as f:
        content = f.read()

    # Find every unique SK string used in showToast/alert/confirm
    show_re = re.compile(r"showToast\(\s*'([^']{3,200})'(\s*[,)])", re.MULTILINE)
    alert_re = re.compile(r"\balert\(\s*'([^']{3,200})'\s*\)", re.MULTILINE)
    confirm_re = re.compile(r"\bconfirm\(\s*'([^']{3,200})'\s*\)", re.MULTILINE)

    seen = {}  # sk_string → (key, en_text)
    for fn, regex, replacer in [
        ('showToast', show_re, lambda key, suffix: f"showToast(t('{key}'){suffix}"),
        ('alert',     alert_re, lambda key, _: f"alert(t('{key}'))"),
        ('confirm',   confirm_re, lambda key, _: f"confirm(t('{key}'))"),
    ]:
        def sub_fn(m):
            sk = m.group(1)
            if not SK_DIACR.search(sk):
                return m.group(0)  # no SK content, skip
            if sk not in TRANSLATIONS:
                # Not in our translation table — leave it alone (will catch in next pass)
                return m.group(0)
            if sk not in seen:
                base = slug_key(sk)
                key = f"toast.{base}"
                # Disambiguate collisions
                existing = {v[0] for v in seen.values()}
                idx = 2
                while key in existing:
                    key = f"toast.{base}_{idx}"
                    idx += 1
                seen[sk] = (key, TRANSLATIONS[sk])
            key, _ = seen[sk]
            suffix = m.group(2) if fn == 'showToast' else ''
            return replacer(key, suffix)
        content = regex.sub(sub_fn, content)

    # Write atomic
    tmp = APP_JS + '.tmp'
    with open(tmp, 'w') as f:
        f.write(content)
    os.replace(tmp, APP_JS)
    print(f"Replaced {len(seen)} unique SK strings in app.js (showToast/alert/confirm).")

    # Append to dictionary
    if seen:
        with open(DICT, 'r') as f:
            dict_content = f.read()

        sk_lines = []
        en_lines = []
        for sk, (key, en) in sorted(seen.items()):
            sk_esc = sk.replace('\\', '\\\\').replace("'", "\\'")
            en_esc = en.replace('\\', '\\\\').replace("'", "\\'")
            sk_lines.append(f"    '{key}': '{sk_esc}',")
            en_lines.append(f"    '{key}': '{en_esc}',")
        sk_block = '\n    // ── Pass 3: JS toast/alert/confirm ──\n' + '\n'.join(sk_lines) + '\n'
        en_block = '\n    // ── Pass 3: JS toast/alert/confirm ──\n' + '\n'.join(en_lines) + '\n'

        # Insert before "  },\n\n  en: {"
        sk_end = '\n  },\n\n  en: {'
        if sk_end not in dict_content:
            sk_end = '\n  },\n  en: {'
        if sk_end not in dict_content:
            print("⚠ Could not find sk: block closing in dict")
            return
        dict_content = dict_content.replace(sk_end, sk_block + sk_end, 1)

        en_end = '\n  },\n};'
        if en_end not in dict_content:
            print("⚠ Could not find en: block closing in dict")
            return
        dict_content = dict_content.replace(en_end, en_block + en_end, 1)

        tmp = DICT + '.tmp'
        with open(tmp, 'w') as f:
            f.write(dict_content)
        os.replace(tmp, DICT)
        print(f"Added {len(seen)} keys to SK + EN dict blocks.")


if __name__ == '__main__':
    main()
