const { admin, userClient, SUPABASE_URL, SUPABASE_ANON_KEY } = require("../supabase");

const adminEmails = () => String(process.env.ADMIN_EMAILS || "")
  .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

async function getProfile(id) {
  if (!admin) return null;
  let { data } = await admin.from("profiles").select("*").eq("id", id).maybeSingle();
  if (!data) {
    await admin.from("profiles").insert({ id });
    ({ data } = await admin.from("profiles").select("*").eq("id", id).maybeSingle());
  }
  return data || null;
}

// allowPending = true -> unapproved users may pass (only used for GET /api/me)
function makeAuth(allowPending) {
  return async function requireUser(req, res, next) {
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

      const profile = await getProfile(data.user.id);
      if (profile?.is_banned) return res.status(403).json({ error: "Your account is suspended." });

      const email = String(data.user.email || "").toLowerCase();
      const isAdmin = !!data.user.email_confirmed_at && adminEmails().includes(email);

      // the admin is always approved
      if (isAdmin && profile && !profile.is_approved) {
        await admin.from("profiles").update({ is_approved: true }).eq("id", data.user.id);
        profile.is_approved = true;
      }

      req.user = data.user;
      req.authClient = client;
      req.profile = profile;
      req.isAdmin = isAdmin;
      req.isApproved = !!profile?.is_approved;

      if (!req.isApproved && !allowPending) {
        return res.status(403).json({ error: "Your account is waiting for admin approval.", pending: true });
      }
      next();
    } catch (e) {
      console.error("Auth check failed:", e.message);
      res.status(500).json({ error: "Authentication check failed." });
    }
  };
}

function requireAdmin(req, res, next) {
  if (!req.isAdmin) return res.status(403).json({ error: "Admin only." });
  next();
}

module.exports = makeAuth(false);
module.exports.allowPending = makeAuth(true);
module.exports.requireAdmin = requireAdmin;
