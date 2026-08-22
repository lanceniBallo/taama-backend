const jwt = require("jsonwebtoken");

function requirePartner(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Token manquant" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== "partner") {
      return res.status(403).json({ error: "Ce token n'est pas un token partenaire" });
    }
    req.partnerId = payload.partner_id;
    req.partnerType = payload.partner_type;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token invalide ou expiré" });
  }
}

module.exports = requirePartner;
