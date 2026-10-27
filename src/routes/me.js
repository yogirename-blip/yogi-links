const crypto = require("crypto");
const express = require("express");
const requireUser = require("../middleware/auth");
const { admin } = require("../supabase");
const { getSettings } = require("../services/settings");

const router = express.Router();
const METHODS = ["UPI", "PayPal", "Paytm", "Bank transfer", "Other"];

// GET /api/me  -> profile, wallet, rates
router.get("/me", requireUser.allowPending, async (req, res) => {
  if (!req.isApproved) return res.json({ email: req.user.email, is_admin: false, is_approved: false });
  const s = await getSettings();
  const p = req.profile || {};
  res.json({
    email: req.user.email,
    is_admin: req.isAdmin,
    is_approved: true,
    api_key: p.api_key || null,
    balance: Number(p.balance || 0),
    total_earned: Number(p.total_earned || 0),
    total_withdrawn: Number(p.total_withdrawn || 0),
    payment_method: p.payment_method || "",
    payment_details: p.payment_details || "",
    settings: {
      rate_p1: Number(s.rate_p1), rate_p2: Number(s.rate_p2), rate_p3: Number(s.rate_p3),
      min_withdraw: Number(s.min_withdraw), currency: s.currency
    }
  });
});

// PUT /api/me/payment
router.put("/me/payment", requireUser, async (req, res) => {
  const method = String(req.body?.method || "");
  const details = String(req.body?.details || "").trim().slice(0, 200);
  if (!METHODS.includes(method) || !details) return res.status(400).json({ error: "Choose a method and enter your payment details." });
  const { error } = await admin.from("profiles").update({ payment_method: method, payment_details: details }).eq("id", req.user.id);
  if (error) return res.status(400).json({ error: "Could not save." });
  res.json({ ok: true });
});

// POST /api/me/api-key  -> new key
router.post("/me/api-key", requireUser, async (req, res) => {
  const api_key = crypto.randomBytes(20).toString("hex");
  const { error } = await admin.from("profiles").update({ api_key }).eq("id", req.user.id);
  if (error) return res.status(400).json({ error: "Could not create key." });
  res.json({ api_key });
});

// GET /api/stats
router.get("/stats", requireUser, async (req, res) => {
  const { data, error } = await admin.rpc("user_stats", { p_user: req.user.id });
  if (error) {
    console.error("user_stats failed:", error.message);
    return res.status(400).json({ error: "Could not load stats. Run the latest supabase/schema.sql." });
  }
  res.json(data);
});

// GET /api/withdrawals
router.get("/withdrawals", requireUser, async (req, res) => {
  const { data, error } = await admin.from("withdrawals")
    .select("id, amount, method, status, note, created_at, processed_at")
    .eq("user_id", req.user.id).order("created_at", { ascending: false }).limit(50);
  if (error) return res.status(400).json({ error: "Could not load withdrawals." });
  res.json(data || []);
});

// POST /api/withdrawals { amount }
router.post("/withdrawals", requireUser, async (req, res) => {
  const amount = Math.round(Number(req.body?.amount) * 1e6) / 1e6;
  const s = await getSettings();
  const { data, error } = await admin.rpc("request_withdrawal", { p_user: req.user.id, p_amount: amount, p_min: Number(s.min_withdraw) });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ id: data });
});

module.exports = router;
