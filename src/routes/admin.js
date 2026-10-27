const express = require("express");
const requireUser = require("../middleware/auth");
const { requireAdmin } = require("../middleware/auth");
const { admin } = require("../supabase");
const { getSettings, clearSettingsCache } = require("../services/settings");

const router = express.Router();
router.use(requireUser, requireAdmin);

const fail = (res, msg = "Request failed.") => res.status(400).json({ error: msg });

router.get("/overview", async (_req, res) => {
  const { data, error } = await admin.rpc("admin_stats");
  if (error) { console.error("admin_stats:", error.message); return fail(res, "Run the latest supabase/schema.sql."); }
  res.json({ stats: data, settings: await getSettings() });
});

router.put("/settings", async (req, res) => {
  const b = req.body || {};
  const rows = [];
  for (const k of ["rate_p1", "rate_p2", "rate_p3", "min_withdraw"]) {
    const n = Number(b[k]);
    if (!Number.isFinite(n) || n < 0 || n > 100000) return fail(res, `Invalid value for ${k}.`);
    rows.push({ key: k, value: String(n) });
  }
  const currency = String(b.currency || "$").trim().slice(0, 4) || "$";
  rows.push({ key: "currency", value: currency });
  const { error } = await admin.from("app_settings").upsert(rows, { onConflict: "key" });
  if (error) return fail(res, "Could not save settings.");
  clearSettingsCache();
  res.json({ settings: await getSettings() });
});

router.put("/ads", async (req, res) => {
  const b = req.body || {};
  const wait = Math.round(Number(b.wait_seconds));
  if (!Number.isFinite(wait) || wait < 3 || wait > 60) return fail(res, "Wait time must be 3 to 60 seconds.");
  const rows = [{ key: "wait_seconds", value: String(wait) }];
  for (const k of ["ad_top", "ad_middle", "ad_bottom"]) rows.push({ key: k, value: String(b[k] ?? "").slice(0, 20000) });
  const { error } = await admin.from("app_settings").upsert(rows, { onConflict: "key" });
  if (error) return fail(res, "Could not save ads.");
  clearSettingsCache();
  res.json({ settings: await getSettings() });
});

router.get("/users", async (_req, res) => {
  const { data, error } = await admin.rpc("admin_users");
  if (error) return fail(res);
  res.json(data);
});

router.patch("/users/:id", async (req, res) => {
  if (typeof req.body?.is_banned !== "boolean") return fail(res);
  const { error } = await admin.from("profiles").update({ is_banned: req.body.is_banned }).eq("id", req.params.id);
  if (error) return fail(res);
  res.json({ ok: true });
});

router.get("/withdrawals", async (_req, res) => {
  const { data, error } = await admin.rpc("admin_withdrawals");
  if (error) return fail(res);
  res.json(data);
});

router.post("/withdrawals/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const status = String(req.body?.status || "");
  const note = String(req.body?.note || "").slice(0, 300);
  const { error } = await admin.rpc("process_withdrawal", { p_id: id, p_status: status, p_note: note });
  if (error) return fail(res, error.message);
  res.json({ ok: true });
});

router.get("/links", async (_req, res) => {
  const { data, error } = await admin.rpc("admin_links");
  if (error) return fail(res);
  res.json(data);
});

router.patch("/links/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || typeof req.body?.is_active !== "boolean") return fail(res);
  const { error } = await admin.from("short_links").update({ is_active: req.body.is_active }).eq("id", id);
  if (error) return fail(res);
  res.json({ ok: true });
});

router.delete("/links/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return fail(res);
  const { error } = await admin.from("short_links").delete().eq("id", id);
  if (error) return fail(res);
  res.json({ ok: true });
});

module.exports = router;
