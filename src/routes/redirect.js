const express = require("express");
const { admin } = require("../supabase");
const rateLimit = require("../middleware/rateLimit");
const { WAIT_SECONDS } = require("../ads");
const { sign, verify, consume } = require("../token");
const { renderStep } = require("../views/interstitial");
const { isBot, hashIp } = require("../utils");

const router = express.Router();
const RESERVED = new Set(["api", "health", "config", "favicon", "robots", "index"]);
const limit = rateLimit({ windowMs: 60_000, max: 120, message: "Too many requests." });
const validCode = c => /^[a-zA-Z0-9]{4,20}$/.test(c) && !RESERVED.has(c.toLowerCase());

async function findLink(code) {
  return admin.from("short_links")
    .select("id, user_id, original_url, ad_pages")
    .eq("short_code", code).eq("is_active", true).maybeSingle();
}

function sendStep(res, code, step, total) {
  const token = sign({ c: code, s: step, iat: Date.now() });
  res.set("Cache-Control", "no-store").type("html")
    .send(renderStep({ code, step, total, token, wait: WAIT_SECONDS }));
}

// Count one finished visit (and pay the owner), then send the visitor to the real URL.
async function finish(req, res, link) {
  const ua = String(req.get("user-agent") || "");
  const { error } = await admin.rpc("record_view", {
    p_link_id: link.id,
    p_ip_hash: hashIp(req.ip),
    p_ua: ua.slice(0, 500),
    p_ref: String(req.get("referer") || "").slice(0, 1000),
    p_is_bot: isBot(ua)
  });
  if (error) console.error("record_view failed:", error.message);   // never block the visitor
  res.set("Cache-Control", "no-store").redirect(302, link.original_url);
}

// GET /:code/continue?t=TOKEN  -> next ad page, or final redirect
router.get("/:code/continue", limit, async (req, res, next) => {
  const code = String(req.params.code || "");
  if (!validCode(code)) return next();
  if (!admin) return res.status(503).send("Short links are not configured yet.");
  try {
    const t = verify(String(req.query.t || ""));
    const age = t ? Date.now() - Number(t.iat) : -1;
    if (!t || t.c !== code || !(t.s >= 1) || age < 0 || age > 30 * 60_000) return res.redirect(302, `/${code}`);

    const { data: link, error } = await findLink(code);
    if (error) throw new Error(error.message);
    if (!link) return res.status(404).send("This short link was not found or is disabled.");
    const total = Math.min(3, Math.max(1, Number(link.ad_pages) || 1));

    // Clicked before the timer ended -> show the same step again.
    if (age < (WAIT_SECONDS - 1) * 1000) return sendStep(res, code, Math.min(t.s, total), total);

    if (t.s >= total) {
      if (!consume(String(req.query.t))) return res.redirect(302, `/${code}`);
      return finish(req, res, link);
    }
    sendStep(res, code, t.s + 1, total);
  } catch (e) {
    console.error("Continue failed:", e.message);
    res.status(500).send("Could not open this short link.");
  }
});

// GET /:code -> first ad page
router.get("/:code", limit, async (req, res, next) => {
  const code = String(req.params.code || "");
  if (!validCode(code)) return next();
  if (!admin) return res.status(503).send("Short links are not configured yet. Please try again later.");
  try {
    const { data: link, error } = await findLink(code);
    if (error) {
      console.error("Lookup failed:", error.message);
      return res.status(500).send("Could not open this short link.");
    }
    if (!link) return res.status(404).send("This short link was not found or is disabled.");
    const total = Math.min(3, Math.max(0, Number(link.ad_pages) || 0));
    if (total === 0) return finish(req, res, link);
    // remember that someone opened the first ad page (used for "left without finishing")
    if (!isBot(req.get("user-agent"))) {
      admin.from("link_starts").insert({ short_link_id: link.id, user_id: link.user_id }).then(null, () => {});
    }
    sendStep(res, code, 1, total);
  } catch (e) {
    console.error("Redirect failed:", e.message);
    res.status(500).send("Could not open this short link.");
  }
});

module.exports = router;
