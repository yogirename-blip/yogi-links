import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const { SUPABASE_URL = "", SUPABASE_ANON_KEY = "" } = window.APP_CONFIG || {};
const configured = SUPABASE_URL.startsWith("https://") && !!SUPABASE_ANON_KEY;
const $ = id => document.getElementById(id);
const qsa = s => [...document.querySelectorAll(s)];
let supabase = null, session = null, me = null, mode = "signup", entered = false, keyShown = false;

/* ---------- tiny helpers ---------- */
function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}
let toastTimer;
function toast(msg, isError = false) {
  const t = $("toast");
  t.textContent = msg; t.classList.toggle("error", isError); t.classList.remove("hidden");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add("hidden"), 2600);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = h("textarea", { style: "position:fixed;opacity:0" }); ta.value = text;
    document.body.append(ta); ta.select(); document.execCommand("copy"); ta.remove();
  }
  toast("Copied ✓");
}
const safe = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message || "Something went wrong", true); } };
const cur = () => me?.settings?.currency || "$";
const money = n => `${cur()}${Number(n || 0).toFixed(4)}`;
const num = n => Number(n || 0).toLocaleString();
const dayLabel = d => new Date(d + "T00:00:00").toLocaleDateString(undefined, { weekday: "short" });
const dateLabel = d => new Date(d).toLocaleDateString();

async function api(path, options = {}) {
  const token = session?.access_token;
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
const send = (method, path, body) => api(path, { method, body: body ? JSON.stringify(body) : undefined });

function stat(icon, label, value, sub, cls) {
  return h("div", { class: `stat ${cls}` }, h("div", { class: "ic" }, icon), h("div", { class: "lb" }, label),
    h("div", { class: "vl" }, value), sub ? h("div", { class: "sb" }, sub) : null);
}
function chart(el, days) {
  el.replaceChildren();
  const max = Math.max(1, ...days.map(d => Number(d.views)));
  for (const d of days) {
    el.append(h("div", { class: "bar-col", title: `${d.d}: ${d.views} views, ${money(d.earned)}` },
      h("div", { class: "bar-val" }, Number(d.views) || ""),
      h("div", { class: "bar", style: `height:${Math.max(2, (Number(d.views) / max) * 100)}%` }),
      h("div", { class: "bar-lbl" }, days.length > 8 ? new Date(d.d + "T00:00:00").getDate() : dayLabel(d.d))));
  }
}
const empty = t => h("div", { class: "empty" }, t);

/* ---------- auth ---------- */
function showMessage(id, text, error = false) {
  const el = $(id); el.textContent = text; el.classList.remove("hidden"); el.classList.toggle("error", error);
}
const hideMessage = id => $(id).classList.add("hidden");
function setMode(next) {
  mode = next;
  $("authTitle").textContent = mode === "signup" ? "Create your account" : "Welcome back";
  $("authSubmit").textContent = mode === "signup" ? "Sign up" : "Log in";
  $("toggleAuth").textContent = mode === "signup" ? "I already have an account" : "Create an account";
  $("password").autocomplete = mode === "signup" ? "new-password" : "current-password";
}
$("toggleAuth").addEventListener("click", () => setMode(mode === "signup" ? "login" : "signup"));

$("authForm").addEventListener("submit", async e => {
  e.preventDefault(); hideMessage("message");
  if (!configured) return showMessage("message", "Setup needed: set SUPABASE_URL and SUPABASE_ANON_KEY in Render environment variables.", true);
  const email = $("email").value.trim(), password = $("password").value;
  try {
    const result = mode === "signup"
      ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } })
      : await supabase.auth.signInWithPassword({ email, password });
    if (result.error) throw result.error;
    if (mode === "signup" && !result.data.session) showMessage("message", "Account created. Check your email (and spam folder) to confirm, then log in.");
    else { session = result.data.session; renderAuth(); }
  } catch (err) { showMessage("message", err.message || "Authentication failed.", true); }
});
$("signOut").addEventListener("click", async () => { await supabase.auth.signOut(); session = null; renderAuth(); });

function renderAuth() {
  $("authCard").classList.toggle("hidden", !!session);
  $("dashboard").classList.toggle("hidden", !session);
  $("userBar").classList.toggle("hidden", !session);
  if (session) { $("signedInAs").textContent = session.user.email || ""; if (!entered) enterApp(); }
  else { entered = false; me = null; }
}

/* ---------- tabs ---------- */
const loaders = { home: loadHome, links: loadLinks, earn: loadEarn, api: renderApi, admin: loadAdmin };
function showTab(name) {
  qsa(".tab").forEach(t => t.classList.toggle("hidden", t.id !== "tab-" + name));
  qsa("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === name));
  safe(loaders[name])();
}
$("tabs").addEventListener("click", e => { const b = e.target.closest("button[data-tab]"); if (b) showTab(b.dataset.tab); });
document.addEventListener("click", e => { const b = e.target.closest("[data-go]"); if (b) showTab(b.dataset.go); });

async function loadMe() {
  me = await api("/api/me");
  $("adminTabBtn").classList.toggle("hidden", !me.is_admin);
  $("heroBalance").textContent = money(me.balance);
  $("heroSub").textContent = `Total earned ${money(me.total_earned)} · Withdrawn ${money(me.total_withdrawn)}`;
  const s = me.settings;
  $("adPages").replaceChildren(...[1, 2, 3].map(n =>
    h("option", { value: n }, `${n} page${n > 1 ? "s" : ""} — ${cur()}${Number(s["rate_p" + n]).toFixed(2)} per 1000 views`)));
}
async function enterApp() {
  entered = true;
  try { await loadMe(); showTab("home"); } catch (e) { toast(e.message, true); }
}

/* ---------- dashboard ---------- */
async function loadHome() {
  await loadMe();
  const s = await api("/api/stats");
  const left = Math.max(0, Number(s.today_started) - Number(s.today_views));
  $("statGrid").replaceChildren(
    stat("👀", "Views today", num(s.today_views), "finished visits", "g1"),
    stat("✅", "Paid views today", num(s.today_unique), "unique visitors", "g2"),
    stat("💰", "Earned today", money(s.today_earned), null, "g3"),
    stat("🚪", "Left without finishing", num(left), `${num(s.today_started)} opened today`, "g4"),
    stat("🔗", "Total links", num(s.total_links), null, "g5"),
    stat("📈", "Total views", num(s.total_views), null, "g6"));
  chart($("chart7"), s.days || []);
  const st = me.settings;
  $("ratesBox").replaceChildren(...[1, 2, 3].map(n =>
    h("div", { class: "rate" }, h("b", {}, `${cur()}${Number(st["rate_p" + n]).toFixed(2)}`), h("span", {}, `${n} page${n > 1 ? "s" : ""} / 1000 views`))));
  const top = $("topLinks"); top.replaceChildren();
  if (!(s.top || []).length) top.append(empty("No views yet today. Share your links!"));
  for (const t of s.top || []) top.append(h("div", { class: "row" }, h("div", { class: "t" }, "/" + t.short_code), h("div", { class: "d" }, t.original_url), h("div", { class: "badges" }, h("span", { class: "badge on" }, `${t.views} views today`))));
}

/* ---------- links ---------- */
function linkRow(r, base) {
  const toggle = safe(async () => { await send("PATCH", `${base}/${r.id}`, { is_active: !r.is_active }); toast(r.is_active ? "Link disabled" : "Link enabled"); refreshLinks(); });
  const del = safe(async () => { if (!confirm("Delete this link permanently?")) return; await send("DELETE", `${base}/${r.id}`); toast("Deleted"); refreshLinks(); });
  const url = r.short_url || `${location.origin}/${r.short_code}`;
  return h("div", { class: "row" },
    h("div", { class: "t" }, h("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, url)),
    h("div", { class: "d" }, "→ " + r.original_url),
    h("div", { class: "badges" },
      h("span", { class: "badge" }, `${r.ad_pages || 1} ad page${(r.ad_pages || 1) > 1 ? "s" : ""}`),
      h("span", { class: "badge" }, `${num(r.total_clicks)} views`),
      h("span", { class: `badge ${r.is_active ? "on" : "off"}` }, r.is_active ? "Active" : "Disabled"),
      r.email ? h("span", { class: "badge" }, r.email) : null,
      h("span", { class: "badge" }, dateLabel(r.created_at))),
    h("div", { class: "actions" },
      h("button", { class: "btn sm", onclick: () => copyText(url) }, "Copy link"),
      h("button", { class: "btn ghost sm", onclick: toggle }, r.is_active ? "Disable" : "Enable"),
      h("button", { class: "btn danger sm", onclick: del }, "Delete")));
}
let refreshLinks = () => {};
async function loadLinks() {
  if (!me) await loadMe();
  const list = $("linkList");
  refreshLinks = safe(loadLinks);
  list.replaceChildren(empty("Loading…"));
  const rows = await api("/api/links");
  list.replaceChildren(...(rows.length ? rows.map(r => linkRow(r, "/api/links")) : [empty("No links yet. Create your first link above.")]));
}
$("linkForm").addEventListener("submit", safe(async e => {
  e.preventDefault(); hideMessage("linkMessage");
  try {
    const r = await send("POST", "/api/links", { url: $("url").value.trim(), ad_pages: Number($("adPages").value) });
    $("createdUrl").value = r.short_url; $("created").classList.remove("hidden");
    $("url").value = ""; toast("Short link created ✓");
    await loadLinks();
  } catch (err) { showMessage("linkMessage", err.message, true); }
}));
$("copyCreated").addEventListener("click", () => copyText($("createdUrl").value));
$("refresh").addEventListener("click", safe(loadLinks));

/* ---------- earnings ---------- */
async function loadEarn() {
  await loadMe();
  $("walletGrid").replaceChildren(
    stat("💳", "Available", money(me.balance), null, "g3"),
    stat("🏆", "Total earned", money(me.total_earned), null, "g1"),
    stat("🏦", "Withdrawn", money(me.total_withdrawn), null, "g2"));
  $("payMethod").value = me.payment_method || "";
  $("payDetails").value = me.payment_details || "";
  $("minNote").textContent = `Minimum withdrawal: ${cur()}${me.settings.min_withdraw}. Payments are sent manually after approval.`;
  const rows = await api("/api/withdrawals");
  const box = $("wdList"); box.replaceChildren();
  if (!rows.length) box.append(empty("No withdrawals yet."));
  for (const w of rows) box.append(h("div", { class: "row" },
    h("div", { class: "t" }, money(w.amount)),
    h("div", { class: "d" }, `${w.method} · ${dateLabel(w.created_at)}${w.note ? " · " + w.note : ""}`),
    h("div", { class: "badges" }, h("span", { class: `badge ${w.status === "paid" ? "on" : w.status === "rejected" ? "off" : "pend"}` }, w.status))));
}
$("savePay").addEventListener("click", safe(async () => {
  await send("PUT", "/api/me/payment", { method: $("payMethod").value, details: $("payDetails").value });
  toast("Payment details saved ✓");
}));
$("wdBtn").addEventListener("click", safe(async () => {
  await send("POST", "/api/withdrawals", { amount: Number($("wdAmount").value) });
  $("wdAmount").value = ""; toast("Withdrawal requested ✓"); await loadEarn();
}));

/* ---------- API ---------- */
function renderApi() {
  if (!me) return;
  const key = me.api_key || "";
  $("apiKey").value = keyShown ? key : "•".repeat(24);
  $("showKey").textContent = keyShown ? "Hide" : "Show";
  $("apiExample").value = `${location.origin}/api/v1/shorten?api=${key}&url=https://example.com&pages=2`;
  $("apiReply").textContent = `{"status":"success","shortenedUrl":"${location.origin}/aB3dE9x","pages":2}`;
}
$("showKey").addEventListener("click", () => { keyShown = !keyShown; renderApi(); });
$("copyKey").addEventListener("click", () => copyText(me.api_key));
$("copyExample").addEventListener("click", () => copyText($("apiExample").value));
$("regenKey").addEventListener("click", safe(async () => {
  if (!confirm("Old key will stop working. Continue?")) return;
  const r = await send("POST", "/api/me/api-key"); me.api_key = r.api_key; keyShown = true; renderApi(); toast("New key created ✓");
}));

/* ---------- admin ---------- */
async function loadAdmin() {
  if (!me?.is_admin) return;
  const [ov, wds, users, links] = await Promise.all([
    api("/api/admin/overview"), api("/api/admin/withdrawals"), api("/api/admin/users"), api("/api/admin/links")]);
  const s = ov.stats, st = ov.settings;
  $("adStats").replaceChildren(
    stat("👥", "Users", num(s.users), null, "g2"),
    stat("🔗", "Links", num(s.links), null, "g5"),
    stat("👀", "Views today", num(s.today_views), `${num(s.today_unique)} paid · ${num(Math.max(0, s.today_started - s.today_views))} left early`, "g1"),
    stat("📈", "Total views", num(s.total_views), null, "g6"),
    stat("🧾", "Owed to users today", money(s.today_owed), null, "g4"),
    stat("💼", "Users' balances", money(s.balances), `Earned ${money(s.total_owed)} · Paid ${money(s.total_paid)}`, "g3"),
    stat("⏳", "Pending payouts", money(s.pending_amount), `${s.pending_count} request(s)`, "g5"));
  chart($("chart14"), s.days || []);
  $("s1").value = st.rate_p1; $("s2").value = st.rate_p2; $("s3").value = st.rate_p3; $("sMin").value = st.min_withdraw; $("sCur").value = st.currency;
  $("adWait").value = st.wait_seconds || 8; $("adTop").value = st.ad_top || ""; $("adMid").value = st.ad_middle || ""; $("adBot").value = st.ad_bottom || "";

  const wbox = $("adWd"); wbox.replaceChildren();
  if (!wds.length) wbox.append(empty("No requests."));
  for (const w of wds) {
    const act = status => safe(async () => {
      let note = "";
      if (status === "paid" && !confirm("Mark as PAID? Send the money first.")) return;
      if (status === "rejected") { note = prompt("Reason (optional)") ?? ""; }
      await send("POST", `/api/admin/withdrawals/${w.id}`, { status, note });
      toast("Updated ✓"); loadAdmin();
    })();
    wbox.append(h("div", { class: "row" },
      h("div", { class: "t" }, `${money(w.amount)} — ${w.email || "user"}`),
      h("div", { class: "d" }, `${w.method}: ${w.details}`),
      h("div", { class: "badges" }, h("span", { class: `badge ${w.status === "paid" ? "on" : w.status === "rejected" ? "off" : "pend"}` }, w.status), h("span", { class: "badge" }, dateLabel(w.created_at))),
      w.status === "pending" ? h("div", { class: "actions" },
        h("button", { class: "btn ok sm", onclick: () => act("paid") }, "Mark paid"),
        h("button", { class: "btn danger sm", onclick: () => act("rejected") }, "Reject & refund")) : null));
  }

  const ubox = $("adUsers"); ubox.replaceChildren();
  for (const u of users) {
    const ban = safe(async () => { await send("PATCH", `/api/admin/users/${u.id}`, { is_banned: !u.is_banned }); toast(u.is_banned ? "Unbanned" : "Banned"); loadAdmin(); });
    ubox.append(h("div", { class: "row" },
      h("div", { class: "t" }, u.email || u.id),
      h("div", { class: "badges" },
        h("span", { class: "badge" }, `${u.links} links`), h("span", { class: "badge" }, `${num(u.views)} views`),
        h("span", { class: "badge on" }, `Balance ${money(u.balance)}`), h("span", { class: "badge" }, `Earned ${money(u.total_earned)}`),
        u.is_banned ? h("span", { class: "badge off" }, "Banned") : null),
      h("div", { class: "actions" }, h("button", { class: `btn sm ${u.is_banned ? "ok" : "danger"}`, onclick: ban }, u.is_banned ? "Unban" : "Ban user"))));
  }

  refreshLinks = safe(loadAdmin);
  const lbox = $("adLinks"); lbox.replaceChildren();
  if (!links.length) lbox.append(empty("No links."));
  for (const l of links) lbox.append(linkRow(l, "/api/admin/links"));
}
$("saveSettings").addEventListener("click", safe(async () => {
  await send("PUT", "/api/admin/settings", {
    rate_p1: $("s1").value, rate_p2: $("s2").value, rate_p3: $("s3").value, min_withdraw: $("sMin").value, currency: $("sCur").value });
  await loadMe(); toast("Settings saved ✓");
}));

$("saveAds").addEventListener("click", safe(async () => {
  await send("PUT", "/api/admin/ads", {
    wait_seconds: $("adWait").value, ad_top: $("adTop").value, ad_middle: $("adMid").value, ad_bottom: $("adBot").value });
  toast("Ads saved ✓");
}));

/* ---------- start ---------- */
if (configured) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data } = await supabase.auth.getSession(); session = data.session;
  supabase.auth.onAuthStateChange((event, s) => {
    const was = !!session; session = s;
    if (event === "TOKEN_REFRESHED" && was && s) return;
    renderAuth();
  });
  renderAuth();
} else {
  showMessage("message", "Setup needed: set SUPABASE_URL and SUPABASE_ANON_KEY in Render environment variables.", true);
}
