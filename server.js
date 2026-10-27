const express = require("express");
const helmet = require("helmet");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "20kb" }));
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let admin = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

function validHttpUrl(value) {
  try {
    const u = new URL(value);
    return (u.protocol === "https:" || u.protocol === "http:") &&
      !["localhost", "127.0.0.1", "::1"].includes(u.hostname);
  } catch { return false; }
}

function makeCode(length = 7) {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

async function requireUser(req, res, next) {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return res.status(500).json({ error: "Supabase environment variables are not configured." });
    }
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Please sign in first." });
    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const { data, error } = await authClient.auth.getUser(token);
    if (error || !data.user) return res.status(401).json({ error: "Session expired. Please sign in again." });
    req.user = data.user;
    req.authClient = authClient;
    next();
  } catch {
    return res.status(500).json({ error: "Authentication check failed." });
  }
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/api/links", requireUser, async (req, res) => {
  const original_url = String(req.body?.url || "").trim();
  if (!validHttpUrl(original_url)) {
    return res.status(400).json({ error: "Enter a valid public http:// or https:// URL." });
  }

  try {
    let inserted = null;
    let lastError = null;
    for (let i = 0; i < 4; i++) {
      const short_code = makeCode();
      const { data, error } = await req.authClient
        .from("short_links")
        .insert({ user_id: req.user.id, original_url, short_code })
        .select("id, original_url, short_code, total_clicks, created_at")
        .single();
      if (!error) { inserted = data; break; }
      lastError = error;
      if (error.code !== "23505") break;
    }
    if (!inserted) {
      console.error("Link insert failed:", lastError?.message);
      return res.status(400).json({ error: "Could not create link. Check database setup and try again." });
    }
    const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
    return res.json({ ...inserted, short_url: `${base.replace(/\/$/, "")}/${inserted.short_code}` });
  } catch {
    return res.status(500).json({ error: "Unexpected error while creating link." });
  }
});

app.get("/api/links", requireUser, async (req, res) => {
  const { data, error } = await req.authClient
    .from("short_links")
    .select("id, original_url, short_code, total_clicks, created_at, is_active")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return res.status(400).json({ error: "Could not load links. Check database setup." });
  const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
  res.json((data || []).map(row => ({ ...row, short_url: `${base.replace(/\/$/, "")}/${row.short_code}` })));
});

app.get("/:code", async (req, res, next) => {
  const code = String(req.params.code || "");
  if (!/^[a-zA-Z0-9]{4,20}$/.test(code) || ["api", "health", "favicon.ico"].includes(code)) return next();
  if (!admin) return res.status(503).send("Short links are not configured yet. Please try again later.");
  try {
    const { data: link, error } = await admin
      .from("short_links")
      .select("id, original_url, is_active")
      .eq("short_code", code)
      .eq("is_active", true)
      .maybeSingle();
    if (error || !link) return res.status(404).send("This short link was not found or is disabled.");
    // Count redirects server-side. Earnings are deliberately not credited here:
    // real earnings must be reconciled against an approved advertising provider.
    const { error: clickError } = await admin.from("link_clicks").insert({
      short_link_id: link.id,
      user_agent: String(req.get("user-agent") || "").slice(0, 500),
      referrer: String(req.get("referer") || "").slice(0, 1000)
    });
    const { error: countError } = await admin.rpc("increment_short_link_clicks", { link_id: link.id });
    if (clickError) console.error("Click event insert failed:", clickError.message);
    if (countError) console.error("Click counter update failed:", countError.message);
    return res.redirect(302, link.original_url);
  } catch (e) {
    console.error("Redirect failed:", e.message);
    return res.status(500).send("Could not open this short link.");
  }
});

app.get("/{*splat}", (_req, res) => res.sendFile(require("path").join(__dirname, "public", "index.html")));

app.listen(PORT, () => console.log(`YoGi Links server listening on ${PORT}`));

