Sessions
========

This folder holds authenticated cookies for IDOR testing.

Format: sessions/<name>.json

Example:
  {
    "name": "user_a",
    "cookies": {
      "session": "…",
      "csrftoken": "…"
    }
  }

How to export cookies
---------------------
1. Log into the target with a browser profile dedicated to testing.
2. Open DevTools → Application → Cookies.
3. Copy the values for the target's domain.
4. Paste them into the JSON above.
5. Repeat with a second, separate account as user_b.

Rules
-----
- Never commit these files. Add sessions/*.json to .gitignore.
- Use throwaway accounts on the target, not personal accounts.
- Do not use the same browser profile for both accounts.
