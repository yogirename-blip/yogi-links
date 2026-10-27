const express = require("express");
const requireUser = require("../middleware/auth");
const rateLimit = require("../middleware/rateLimit");
const { makeCode, baseUrl, validPublicUrl } = require("../utils");

const router = express.Router();
const createLimit = rateLimit({ windowMs: 60_000, max: 20, message: "Too many links created. Try again in a minute." });

// POST /api/links  -> create
router.post("/", createLimit, requireUser, async (req, res) => {
  const original_url = String(req.body?.url || "").trim();
  if (!validPublicUrl(original_url, req)) {
    return res.status(400).json({ error: "Enter a valid public http:// or https:// URL (not this site)." });
  }
  const n = parseInt(req.body?.ad_pages, 10);
  const ad_pages = n >= 1 && n <= 3 ? n : 1;
  try {
    let inserted = null, lastError = null;
    for (let i = 0; i < 4; i++) {
      const short_code = makeCode();
      const { data, error } = await req.authClient
        .from("short_links")
        .insert({ user_id: req.user.id, original_url, short_code, ad_pages })
        .select("id, original_url, short_code, total_clicks, created_at, is_active, ad_pages")
        .single();
      if (!error) { inserted = data; break; }
      lastError = error;
      if (error.code !== "23505") break; // only retry on duplicate code
    }
    if (!inserted) {
      console.error("Link insert failed:", lastError?.code, lastError?.message);
      return res.status(400).json({ error: "Could not create link. Check database setup (run supabase/schema.sql)." });
    }
    res.json({ ...inserted, short_url: `${baseUrl(req)}/${inserted.short_code}` });
  } catch {
    res.status(500).json({ error: "Unexpected error while creating link." });
  }
});

// GET /api/links -> list own links
router.get("/", requireUser, async (req, res) => {
  const { data, error } = await req.authClient
    .from("short_links")
    .select("id, original_url, short_code, total_clicks, created_at, is_active, ad_pages")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    console.error("Link list failed:", error.code, error.message);
    return res.status(400).json({ error: "Could not load links. Check database setup." });
  }
  const base = baseUrl(req);
  res.json((data || []).map(r => ({ ...r, short_url: `${base}/${r.short_code}` })));
});

module.exports = router;
