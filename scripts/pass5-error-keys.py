#!/usr/bin/env python3
"""Pass 5: Add errorKey to all backend error responses.

Backend keeps emitting the SK `error` string for backward compatibility, but
also includes `errorKey` so the i18n-aware frontend can translate.
"""
import os
import re

AUTH_JS = "/Users/matej/Desktop/Projects/secpro/api/auth.js"
DICT_JS = "/Users/matej/Desktop/Projects/secpro/public/i18n-dict.js"

# Map each Slovak error → (errorKey, English text).
# When we encounter `error: 'SK string'` we'll inject `errorKey: 'auth.error.X'` alongside.
ERROR_MAP = {
    'Server nie je nakonfigurovaný (KV)': ('auth.error.server_misconfigured', 'Server not configured (KV).'),
    'Príliš veľa pokusov. Skúste znova neskôr.': ('auth.error.rate_limit', 'Too many attempts. Try again later.'),
    'Neznáma akcia: ': ('auth.error.unknown_action', 'Unknown action.'),
    'Interná chyba servera.': ('auth.error.server', 'Internal server error.'),
    'Meno, email a heslo sú povinné.': ('auth.error.required_fields_register', 'Name, email and password are required.'),
    'Chyba servera pri registrácii.': ('auth.error.server_register', 'Server error during registration.'),
    'Email a heslo sú povinné.': ('auth.error.required_fields', 'Email and password are required.'),
    'Nesprávny e-mail alebo heslo.': ('auth.error.wrong_credentials', 'Incorrect email or password.'),
    'Chyba servera pri prihlásení.': ('auth.error.server_login', 'Server error during sign-in.'),
    'Token chýba.': ('auth.error.token_missing', 'Token missing.'),
    'Sedenie vypršalo.': ('auth.error.session_expired', 'Session expired.'),
    'Sedenie vypršalo alebo neexistuje.': ('auth.error.session_invalid', 'Session expired or does not exist.'),
    'Účet nenájdený.': ('auth.error.account_not_found', 'Account not found.'),
    'Chyba servera.': ('auth.error.server', 'Server error.'),
    'Chyba servera pri overení sedenia.': ('auth.error.server_session', 'Server error during session check.'),
    'Kód vypršal. Požiadajte o nový.': ('auth.error.code_expired', 'Code expired. Request a new one.'),
    'Nesprávny kód.': ('auth.error.code_wrong', 'Incorrect code.'),
}


def patch_auth_js():
    with open(AUTH_JS, 'r') as f:
        content = f.read()

    used = set()

    # Strategy: for each unique SK error string in ERROR_MAP, find every
    # `{ error: 'SK' }` or `{ error: 'SK' + something }` occurrence and
    # inject `errorKey: 'X'` alongside.
    for sk, (key, _) in ERROR_MAP.items():
        # Variant 1: { error: 'SK' }
        v1 = re.compile(r"\{\s*error:\s*'" + re.escape(sk) + r"'\s*(,|\})")
        # Variant 2: { error: 'SK' + action } (one specific case)
        v2 = re.compile(r"\{\s*error:\s*'" + re.escape(sk) + r"'\s*\+\s*([^,}]+)\s*(,|\})")

        def sub_v1(m):
            used.add(key)
            return "{ error: '" + sk + "', errorKey: '" + key + "' " + m.group(1)
        new_content = v1.sub(sub_v1, content)

        def sub_v2(m):
            used.add(key)
            return "{ error: '" + sk + "' + " + m.group(1) + ", errorKey: '" + key + "' " + m.group(2)
        new_content = v2.sub(sub_v2, new_content)

        content = new_content

    tmp = AUTH_JS + '.tmp'
    with open(tmp, 'w') as f:
        f.write(content)
    os.replace(tmp, AUTH_JS)
    print(f"Patched {len(used)} unique errorKeys into auth.js")
    return used


def patch_dict_js(used_keys):
    """Make sure every used errorKey exists in the dict (sk + en)."""
    with open(DICT_JS, 'r') as f:
        content = f.read()

    new_sk_entries = []
    new_en_entries = []
    for sk, (key, en) in ERROR_MAP.items():
        if key not in used_keys:
            continue
        # Skip if already present in dict
        if f"'{key}':" in content:
            continue
        new_sk_entries.append(f"    '{key}': '{sk}',")
        new_en_entries.append(f"    '{key}': '{en}',")

    if not new_sk_entries:
        print("All errorKeys already in dict — no changes needed.")
        return

    sk_block = '\n    // ── Pass 5: backend error keys ──\n' + '\n'.join(new_sk_entries) + '\n'
    en_block = '\n    // ── Pass 5: backend error keys ──\n' + '\n'.join(new_en_entries) + '\n'

    sk_end = '\n  },\n\n  en: {'
    if sk_end not in content:
        sk_end = '\n  },\n  en: {'
    content = content.replace(sk_end, sk_block + sk_end, 1)

    en_end = '\n  },\n};'
    content = content.replace(en_end, en_block + en_end, 1)

    tmp = DICT_JS + '.tmp'
    with open(tmp, 'w') as f:
        f.write(content)
    os.replace(tmp, DICT_JS)
    print(f"Added {len(new_sk_entries)} error keys to dict (sk + en).")


if __name__ == '__main__':
    used = patch_auth_js()
    patch_dict_js(used)
