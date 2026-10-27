const { userClient, SUPABASE_URL, SUPABASE_ANON_KEY } = require("../supabase");

module.exports = async function requireUser(req, res, next) {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return res.status(500).json({ error: "Supabase environment variables are not configured." });
    }
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Please sign in first." });

    const client = userClient(token);
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: "Session expired. Please sign in again." });

    req.user = data.user;
    req.authClient = client;
    next();
  } catch {
    res.status(500).json({ error: "Authentication check failed." });
  }
};
