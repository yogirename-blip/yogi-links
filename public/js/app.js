import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// Public browser config is served by the server (/config.js) from Render env vars.
const { SUPABASE_URL = "", SUPABASE_ANON_KEY = "" } = window.APP_CONFIG || {};
const configured = SUPABASE_URL.startsWith("https://") && !!SUPABASE_ANON_KEY;
const $ = id => document.getElementById(id);
let supabase = null, mode = "signup", session = null;

function showMessage(id, text, error = false) {
  const el = $(id); el.textContent = text; el.classList.remove("hidden"); el.classList.toggle("error", error);
}
function hideMessage(id) { $(id).classList.add("hidden"); }
function setMode(next) {
  mode = next;
  $("authTitle").textContent = mode === "signup" ? "Create your account" : "Welcome back";
  $("authSubmit").textContent = mode === "signup" ? "Sign up" : "Log in";
  $("toggleAuth").textContent = mode === "signup" ? "I already have an account" : "Create an account";
  $("password").autocomplete = mode === "signup" ? "new-password" : "current-password";
}
$("toggleAuth").addEventListener("click", () => setMode(mode === "signup" ? "login" : "signup"));

async function api(path, options = {}) {
  const token = session?.access_token;
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function loadLinks() {
  if (!session) return;
  $("linksBody").innerHTML = '<tr><td colspan="5" class="muted">Loading…</td></tr>';
  try {
    const rows = await api("/api/links");
    $("linkCount").textContent = rows.length;
    $("clickCount").textContent = rows.reduce((n, r) => n + Number(r.total_clicks || 0), 0);
    $("linksBody").innerHTML = "";
    if (!rows.length) $("linksBody").innerHTML = '<tr><td colspan="5" class="muted">No links yet. Create your first link above.</td></tr>';
    for (const r of rows) {
      const tr = document.createElement("tr");
      const short = document.createElement("a");
      short.href = r.short_url; short.target = "_blank"; short.rel = "noopener noreferrer"; short.textContent = r.short_url;
      const dest = document.createElement("span"); dest.textContent = r.original_url;
      const cells = [short, dest, document.createTextNode(String(r.ad_pages || 1)), document.createTextNode(String(r.total_clicks || 0)), document.createTextNode(new Date(r.created_at).toLocaleDateString())];
      for (const c of cells) { const td = document.createElement("td"); td.append(c); tr.append(td); }
      $("linksBody").append(tr);
    }
  } catch (e) {
    $("linksBody").innerHTML = '<tr><td colspan="5" class="muted">Could not load links.</td></tr>';
    showMessage("linkMessage", e.message, true);
  }
}

function renderAuth() {
  $("authCard").classList.toggle("hidden", !!session);
  $("dashboard").classList.toggle("hidden", !session);
  if (session) { $("signedInAs").textContent = session.user.email || ""; loadLinks(); }
}

$("authForm").addEventListener("submit", async e => {
  e.preventDefault(); hideMessage("message");
  if (!configured) return showMessage("message", "Setup needed: set SUPABASE_URL and SUPABASE_ANON_KEY in Render environment variables.", true);
  const email = $("email").value.trim(), password = $("password").value;
  try {
    let result;
    if (mode === "signup") result = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } });
    else result = await supabase.auth.signInWithPassword({ email, password });
    if (result.error) throw result.error;
    if (mode === "signup" && !result.data.session) showMessage("message", "Account created. Check your email (and spam folder) to confirm, then log in.");
    else { session = result.data.session; renderAuth(); }
  } catch (e) { showMessage("message", e.message || "Authentication failed.", true); }
});

$("linkForm").addEventListener("submit", async e => {
  e.preventDefault(); hideMessage("linkMessage");
  try {
    const result = await api("/api/links", { method: "POST", body: JSON.stringify({ url: $("url").value.trim(), ad_pages: Number($("adPages").value) }) });
    showMessage("linkMessage", "Short link created: " + result.short_url);
    $("url").value = ""; await loadLinks();
  } catch (e) { showMessage("linkMessage", e.message, true); }
});

$("refresh").addEventListener("click", loadLinks);
$("signOut").addEventListener("click", async () => { await supabase.auth.signOut(); session = null; renderAuth(); });

if (configured) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data } = await supabase.auth.getSession(); session = data.session;
  supabase.auth.onAuthStateChange((event, newSession) => {
    const wasSignedIn = !!session;
    session = newSession;
    // Token refresh just updates the token; don't reload the whole dashboard.
    if (event === "TOKEN_REFRESHED" && wasSignedIn && newSession) return;
    renderAuth();
  });
  renderAuth();
} else {
  showMessage("message", "Setup needed: set SUPABASE_URL and SUPABASE_ANON_KEY in Render environment variables.", true);
}
