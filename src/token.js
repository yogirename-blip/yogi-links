const crypto = require("crypto");

// Signed tokens stop visitors from skipping steps or faking the timer.
// Secret: set AD_SECRET in Render (any long random text). Falls back to the service key.
function secret() {
  return process.env.AD_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "dev-only-secret";
}
const mac = body => crypto.createHmac("sha256", secret()).update(body).digest("base64url");

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${mac(body)}`;
}

function verify(token) {
  if (typeof token !== "string" || token.length > 600) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(mac(body));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { return JSON.parse(Buffer.from(body, "base64url").toString()); } catch { return null; }
}

// A finishing token can count only once (in-memory; fine for one Render instance).
const used = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, exp] of used) if (exp <= now) used.delete(k);
}, 60_000).unref();

function consume(token) {
  if (used.has(token)) return false;
  used.set(token, Date.now() + 35 * 60_000);
  return true;
}

module.exports = { sign, verify, consume };
