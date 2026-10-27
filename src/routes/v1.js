const express = require("express");
const { admin } = require("../supabase");
const rateLimit = require("../middleware/rateLimit");
const { baseUrl, validPublicUrl } = require("../utils");
const { createLink, parsePages } = require("../services/links");

const router = express.Router();
const limit = rateLimit({ windowMs: 60_000, max: 60, message: "Too many API requests." });

// GET /api/v1/shorten?api=KEY&url=https://example.com&pages=2&format=text
router.get("/shorten", limit, async (req, res) => {
  const text = req.query.format === "text";
  const send = (code, obj) => text
    ? res.status(code).type("text/plain").send(obj.shortenedUrl || obj.message)
    : res.status(code).json(obj);
  try {
    if (!admin) return send(503, { status: "error", message: "Server not configured." });
    const key = String(req.query.api || "");
    if (!/^[a-f0-9]{32,64}$/.test(key)) return send(401, { status: "error", message: "Invalid API key." });

    const { data: p } = await admin.from("profiles").select("id, is_banned, is_approved").eq("api_key", key).maybeSingle();
    if (!p) return send(401, { status: "error", message: "Invalid API key." });
    if (p.is_banned) return send(403, { status: "error", message: "Account suspended." });
    if (!p.is_approved) return send(403, { status: "error", message: "Account is waiting for admin approval." });

    const url = String(req.query.url || "").trim();
    if (!validPublicUrl(url, req)) return send(400, { status: "error", message: "Invalid URL." });

    const out = await createLink(admin, p.id, url, parsePages(req.query.pages));
    if (out.error) return send(out.status, { status: "error", message: out.error });
    send(200, { status: "success", shortenedUrl: `${baseUrl(req)}/${out.link.short_code}`, pages: out.link.ad_pages });
  } catch (e) {
    console.error("API shorten failed:", e.message);
    send(500, { status: "error", message: "Server error." });
  }
});

module.exports = router;
