const express = require("express");
const { admin } = require("../supabase");
const rateLimit = require("../middleware/rateLimit");
const { WAIT_SECONDS } = require("../ads");
const { sign, verify, consume } = require("../token");
const { renderStep } = require("../views/interstitial");

const router = express.Router();
const RESERVED = new Set(["api", "health", "config", "favicon", "robots", "index"]);
const limit = rateLimit({ windowMs: 60_000, max: 120, message: "Too many requests." });
const validCode = c => /^[a-zA-Z0-9]{4,20}$/.test(c) && !RESERVED.has(c.toLowerCase());

async function findLink(code) {
  return admin.from("short_links")
    .select("id, original_url, ad_pages")
    .eq("short_code", code).eq("is_active", true).maybeSingle();
}

function sendStep(res, code, step, total) {
  const token = sign({ c: code, s: step, iat: Date.now() });
  res.set("Cache-Control", "no-store").type("html")
    .send(renderStep({ code, step, total, token, wait: WAIT_SECONDS }));
}

// Count one finished visit, then send the visitor to the real URL.
async function finish(req, res, link) {
  const [ins, inc] = await Promise.allSettled([
    admin.from("link_clicks").insert({
      short_link_id: link.id,
      user_agent: String(req.get("user-agent") || "").slice(0, 500),
      referrer: String(req.get("referer") || "").slice(0, 1000)
    }),
    admin.rpc("increment_short_link_clicks", { link_id: link.id })
  ]);
  const e1 = ins.status === "fulfilled" ? ins.value.error : ins.reason;
  const e2 = inc.status === "fulfilled" ? inc.value.error : inc.reason;
  if (e1) console.error("Click insert failed:", e1.message);
  if (e2) console.error("Click counter failed:", e2.message);
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
    sendStep(res, code, 1, total);
  } catch (e) {
    console.error("Redirect failed:", e.message);
    res.status(500).send("Could not open this short link.");
  }
});

module.exports = router;
