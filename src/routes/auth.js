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

// PATCH /admin/partners/:id/toggle-active
// Active ou désactive un partenaire (ne le supprime pas)
router.patch("/partners/:id/toggle-active", requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE partners SET is_active = NOT is_active
       WHERE id = $1
       RETURNING id, name, type, is_active, created_at`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Partenaire introuvable" });
    }
    res.json({ partner: result.rows[0] });
  } catch (err) {
    console.error("Erreur toggle-active partenaire:", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// DELETE /admin/partners/:id
// Supprime définitivement un partenaire
router.delete("/partners/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      "DELETE FROM partners WHERE id = $1 RETURNING id",
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Partenaire introuvable" });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Erreur suppression partenaire:", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
