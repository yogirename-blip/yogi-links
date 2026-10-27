const { admin } = require("../supabase");

const DEFAULTS = { rate_p1: "0.50", rate_p2: "1.00", rate_p3: "1.50", min_withdraw: "5.00", currency: "$" };
let cache = null, at = 0;

async function getSettings() {
  if (cache && Date.now() - at < 30_000) return cache;
  const s = { ...DEFAULTS };
  if (admin) {
    const { data } = await admin.from("app_settings").select("key, value");
    (data || []).forEach(r => { s[r.key] = r.value; });
  }
  cache = s; at = Date.now();
  return s;
}
const clearSettingsCache = () => { cache = null; };

module.exports = { getSettings, clearSettingsCache, DEFAULTS };
