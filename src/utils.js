const crypto = require("crypto");

const CODE_CHARS = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";

// crypto-based (Math.random is predictable)
function makeCode(length = 7) {
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  return out;
}

function baseUrl(req) {
  const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
  return base.replace(/\/+$/, "");
}

function validPublicUrl(value, req) {
  if (typeof value !== "string" || value.length > 2048) return false;
  let u;
  try { u = new URL(value); } catch { return false; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") && !h.includes(":")) return false;            // localhost, intranet names
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  if (h.endsWith(".local") || h.endsWith(".internal") || h === "[::1]") return false;
  // Block pointing a short link at this site itself (redirect loops)
  const own = new Set([String(req.hostname || "").toLowerCase()]);
  try { if (process.env.PUBLIC_BASE_URL) own.add(new URL(process.env.PUBLIC_BASE_URL).hostname.toLowerCase()); } catch {}
  return !own.has(h);
}

const BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegram|preview|curl|wget|python|httpclient|headless|lighthouse|monitor|uptime/i;
const isBot = ua => !ua || BOT_RE.test(ua);

// Visitors are stored only as a salted hash (no raw IPs in the database).
function hashIp(ip) {
  const salt = process.env.AD_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "dev";
  return crypto.createHash("sha256").update(`${ip}|${salt}`).digest("hex").slice(0, 32);
}

module.exports = { makeCode, baseUrl, validPublicUrl, isBot, hashIp };
