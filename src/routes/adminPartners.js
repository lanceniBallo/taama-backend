const express = require("express");
const pool = require("../db");
const { generateAccessCode, hashAccessCode } = require("../utils/partnerCode");

const router = express.Router();

function requireAdmin(req, res, next) {
  const key = req.headers["x-admin-key"];
  if (!key || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: "Non autorisé" });
  }
  next();
}

// POST /admin/partners
// body: { name: "Bani Transport", type: "ticket" }
router.post("/partners", requireAdmin, async (req, res) => {
  const { name, type } = req.body;
  if (!name || !type) {
    return res.status(400).json({ error: "name et type sont requis" });
  }

  const code = generateAccessCode();
  const hash = hashAccessCode(code);

  try {
    const result = await pool.query(
      `INSERT INTO partners (name, type, access_code_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, type, created_at`,
      [name, type, hash]
    );
    res.status(201).json({
      partner: result.rows[0],
      access_code: code,
    });
  } catch (err) {
    console.error("Erreur création partenaire:", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /admin/partners
router.get("/partners", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, type, is_active, created_at FROM partners ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Erreur GET /admin/partners:", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
