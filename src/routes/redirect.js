const express = require("express");
const { admin } = require("../supabase");
const rateLimit = require("../middleware/rateLimit");

const router = express.Router();
const RESERVED = new Set(["api", "health", "config", "favicon", "robots", "index"]);
const redirectLimit = rateLimit({ windowMs: 60_000, max: 120, message: "Too many requests." });

// GET /:code -> redirect + count
router.get("/:code", redirectLimit, async (req, res, next) => {
  const code = String(req.params.code || "");
  if (!/^[a-zA-Z0-9]{4,20}$/.test(code) || RESERVED.has(code.toLowerCase())) return next();
  if (!admin) return res.status(503).send("Short links are not configured yet. Please try again later.");

  try {
    const { data: link, error } = await admin
      .from("short_links")
      .select("id, original_url")
      .eq("short_code", code)
      .eq("is_active", true)
      .maybeSingle();
    if (error) {
      console.error("Lookup failed:", error.message);
      return res.status(500).send("Could not open this short link.");
    }
    if (!link) return res.status(404).send("This short link was not found or is disabled.");

    // Record the click, but never block the redirect if counting fails.
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

    res.set("Cache-Control", "no-store");
    res.redirect(302, link.original_url);
  } catch (e) {
    console.error("Redirect failed:", e.message);
    res.status(500).send("Could not open this short link.");
  }
});

module.exports = router;
