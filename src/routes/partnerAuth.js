const express = require("express");
const jwt = require("jsonwebtoken");
const pool = require("../db");
const { hashAccessCode } = require("../utils/partnerCode");
const { rateLimit } = require("../middleware/security");

const router = express.Router();

// POST /auth/partner-login
// body: { code: "AB12CD34" }
router.post("/partner-login", rateLimit({ windowMs: 10 * 60 * 1000, max: 10, keyFn: (req) => `${req.ip}:${req.body?.code || ""}` }), async (req, res) => {
  const { code } = req.body;
  if (!process.env.JWT_SECRET) return res.status(503).json({ error: "Authentification non configurée" });
  if (!code || !/^[A-Z2-9]{8}$/i.test(code)) {
    return res.status(400).json({ error: "Code d'accès invalide (8 caractères attendus)" });
  }

  const hash = hashAccessCode(code);

  try {
    const result = await pool.query(
      "SELECT id, name, type, is_active FROM partners WHERE access_code_hash = $1",
      [hash]
    );
    const partner = result.rows[0];

    if (!partner || !partner.is_active) {
      return res.status(401).json({ error: "Code invalide" });
    }

    const token = jwt.sign(
      { role: "partner", partner_id: partner.id, partner_type: partner.type },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.json({
      token,
      partner: { id: partner.id, name: partner.name, type: partner.type },
    });
  } catch (err) {
    console.error("Erreur partner-login:", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
