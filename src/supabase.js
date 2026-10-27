const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const noSession = { autoRefreshToken: false, persistSession: false };

// Admin client (bypasses RLS) - used ONLY for public redirects + click counting.
const admin = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: noSession })
  : null;

// Client acting as the signed-in user (RLS applies).
function userClient(token) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: noSession
  });
}

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) console.warn("WARNING: SUPABASE_URL / SUPABASE_ANON_KEY not set.");
if (!SUPABASE_SERVICE_ROLE_KEY) console.warn("WARNING: SUPABASE_SERVICE_ROLE_KEY not set - redirects will not work.");

module.exports = { admin, userClient, SUPABASE_URL, SUPABASE_ANON_KEY };
