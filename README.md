# yogi-links
Earning Link Shortener Website
YoGi Links starter
Mobile-friendly link shortener starter with Supabase email authentication, user dashboard, link creation, and redirect counts.
Supabase
Run supabase_schema.sql in SQL Editor once.
In public/index.html, replace PASTE_SUPABASE_PROJECT_URL_HERE and PASTE_SUPABASE_ANON_KEY_HERE with your Supabase Project URL and anon/publishable key.
In Authentication → URL Configuration, set Site URL and Redirect URLs to your deployed website URL.
Render Web Service
Build command: npm install
Start command: npm start
Environment variables: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, PUBLIC_BASE_URL
SUPABASE_SERVICE_ROLE_KEY is secret: put it only in Render Environment Variables, never in GitHub or browser code.
This starter does not implement verified ad earnings, referrals, withdrawals, or a production admin panel. Do not display or pay real earnings until an approved ad network, anti-fraud checks, and secure accounting are implemented.
