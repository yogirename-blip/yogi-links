const express = require("express");
const requireUser = require("../middleware/auth");
const rateLimit = require("../middleware/rateLimit");
const { baseUrl, validPublicUrl } = require("../utils");
const { createLink, parsePages, COLS } = require("../services/links");

const router = express.Router();
const createLimit = rateLimit({ windowMs: 60_000, max: 20, message: "Too many links created. Try again in a minute." });
const withUrl = (req, r) => ({ ...r, short_url: `${baseUrl(req)}/${r.short_code}` });

// POST /api/links
router.post("/", createLimit, requireUser, async (req, res) => {
  const url = String(req.body?.url || "").trim();
  if (!validPublicUrl(url, req)) {
    return res.status(400).json({ error: "Enter a valid public http:// or https:// URL (not this site)." });
  }
  const out = await createLink(req.authClient, req.user.id, url, parsePages(req.body?.ad_pages));
  if (out.error) return res.status(out.status).json({ error: out.error });
  res.json(withUrl(req, out.link));
});

// GET /api/links
router.get("/", requireUser, async (req, res) => {
  const { data, error } = await req.authClient
    .from("short_links").select(COLS)
    .eq("user_id", req.user.id).order("created_at", { ascending: false }).limit(200);
  if (error) {
    console.error("Link list failed:", error.code, error.message);
    return res.status(400).json({ error: "Could not load links. Run the latest supabase/schema.sql." });
  }
  res.json((data || []).map(r => withUrl(req, r)));
});

// PATCH /api/links/:id  { is_active }
router.patch("/:id", requireUser, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || typeof req.body?.is_active !== "boolean") return res.status(400).json({ error: "Bad request." });
  const { data, error } = await req.authClient.from("short_links")
    .update({ is_active: req.body.is_active }).eq("id", id).eq("user_id", req.user.id)
    .select("id, is_active").maybeSingle();
  if (error || !data) return res.status(400).json({ error: "Could not update link." });
  res.json(data);
});

// DELETE /api/links/:id
router.delete("/:id", requireUser, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "Bad request." });
  const { error } = await req.authClient.from("short_links").delete().eq("id", id).eq("user_id", req.user.id);
  if (error) return res.status(400).json({ error: "Could not delete link." });
  res.json({ ok: true });
});

module.exports = router;
