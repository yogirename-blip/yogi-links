const { makeCode } = require("../utils");

const COLS = "id, original_url, short_code, total_clicks, created_at, is_active, ad_pages";
const SCHEMA_ERRORS = new Set(["42703", "42P01", "PGRST204", "PGRST205", "42501"]);

// Creates a short link. `client` = user client (RLS) or admin client (API key).
async function createLink(client, userId, url, pages) {
  let last = null;
  for (let i = 0; i < 4; i++) {
    const { data, error } = await client
      .from("short_links")
      .insert({ user_id: userId, original_url: url, short_code: makeCode(), ad_pages: pages })
      .select(COLS).single();
    if (!error) return { link: data };
    last = error;
    if (error.code !== "23505") break;      // retry only on duplicate code
  }
  console.error("Link insert failed:", last?.code, last?.message);
  const needsSql = SCHEMA_ERRORS.has(last?.code);
  return {
    status: 400,
    error: needsSql
      ? "Database is not updated. Run the latest supabase/schema.sql in Supabase SQL Editor, then try again."
      : "Could not create link."
  };
}

const parsePages = v => { const n = parseInt(v, 10); return n >= 1 && n <= 3 ? n : 1; };

module.exports = { createLink, parsePages, COLS };
