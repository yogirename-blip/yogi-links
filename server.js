const path = require("path");
const express = require("express");
const helmet = require("helmet");
const { SUPABASE_URL, SUPABASE_ANON_KEY } = require("./src/supabase");
const linksRouter = require("./src/routes/links");
const meRouter = require("./src/routes/me");
const adminRouter = require("./src/routes/admin");
const v1Router = require("./src/routes/v1");
const redirectRouter = require("./src/routes/redirect");

const app = express();
const PORT = process.env.PORT || 3000;

// Render runs behind a proxy: needed for correct https URLs and client IPs.
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "100kb" }));

// Public browser config (anon key is public by design) comes from Render env vars,
// so you never have to edit index.html.
app.get("/config.js", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.type("application/javascript").send(
    `window.APP_CONFIG=${JSON.stringify({ SUPABASE_URL: SUPABASE_URL || "", SUPABASE_ANON_KEY: SUPABASE_ANON_KEY || "" })};`
  );
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use(express.static(path.join(__dirname, "public")));
app.use("/api/links", linksRouter);
app.use("/api/admin", adminRouter);
app.use("/api/v1", v1Router);
app.use("/api", meRouter);
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));
app.use(redirectRouter);

app.get("/{*splat}", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// Final error handler
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err.message);
  res.status(err.status || 500).json({ error: "Server error." });
});

app.listen(PORT, () => console.log(`YoGi Links server listening on ${PORT}`));
