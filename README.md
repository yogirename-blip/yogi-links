# YoGi Links

Link shortener with ad pages (1-3), wallet + withdrawals, API key, and an admin panel.

## Folder structure
```
yogi-links/
├─ server.js
├─ package.json / render.yaml / .env.example / .gitignore
├─ src/
│  ├─ ads.js                # PASTE YOUR AD CODE + wait seconds here
│  ├─ token.js              # signed step tokens
│  ├─ supabase.js, utils.js
│  ├─ middleware/           # auth.js (user + admin), rateLimit.js
│  ├─ services/             # settings.js, links.js
│  ├─ views/interstitial.js # the ad page design
│  └─ routes/               # links, me (wallet/stats), admin, v1 (public API), redirect
├─ public/                  # index.html, css/style.css, js/app.js
└─ supabase/schema.sql      # run in Supabase SQL Editor (safe to re-run)
```

## Setup
1. Supabase -> SQL Editor -> paste ALL of `supabase/schema.sql` -> Run (every time you update the project).
2. Supabase -> Authentication -> URL Configuration: Site URL = your Render URL; Redirect URLs add `https://YOUR-APP.onrender.com/**`.
3. Render -> Environment: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, PUBLIC_BASE_URL, ADMIN_EMAILS, AD_SECRET.
4. Sign up with the email you put in ADMIN_EMAILS -> an Admin tab appears.

## Money rules
- Rates (per 1000 finished, unique views) are set by the admin per ad-page count.
- A view pays only if: it finished all ad pages, not a bot, and the same visitor (IP) was not paid for that link in 24h.
- Withdrawals are requested by users and paid MANUALLY by the admin, then marked Paid (or Rejected = refund).
- Keep rates below what your ad network pays you.

## Public API
`GET /api/v1/shorten?api=KEY&url=https://example.com&pages=2&format=json|text`
