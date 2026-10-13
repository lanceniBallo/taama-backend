const jwt = require("jsonwebtoken");
const pool = require("../db");

// Le partenaire reste connecté longtemps (jeton d'un an) : on vérifie donc à
// chaque demande que l'admin ne l'a pas désactivé entre-temps.
const cache = new Map(); // partner_id -> { active, at }
const TTL = 60 * 1000;

async function isActive(partnerId) {
  const hit = cache.get(partnerId);
  if (hit && Date.now() - hit.at < TTL) return hit.active;
  const { rows } = await pool.query("SELECT is_active FROM partners WHERE id = $1", [partnerId]);
  const active = Boolean(rows[0] && rows[0].is_active);
  cache.set(partnerId, { active, at: Date.now() });
  return active;
}

async function requirePartner(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Token manquant" });

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: "Token invalide ou expiré" });
  }
  if (payload.role !== "partner") {
    return res.status(403).json({ error: "Ce token n'est pas un token partenaire" });
  }
  try {
    if (!(await isActive(payload.partner_id))) {
      return res.status(401).json({ error: "Compte partenaire désactivé" });
    }
  } catch (err) {
    console.error("requirePartner:", err.message);
    return res.status(503).json({ error: "Service momentanément indisponible" });
  }
  req.partnerId = payload.partner_id;
  req.partnerType = payload.partner_type;
  next();
}

module.exports = requirePartner;
