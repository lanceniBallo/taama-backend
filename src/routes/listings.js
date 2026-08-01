const express = require("express");
const pool = require("../db");

const router = express.Router();

// GET /listings?type=hotel  -> liste des offres actives, filtrables par type
router.get("/", async (req, res) => {
  const { type } = req.query;
  const query = type
    ? { text: "SELECT * FROM listings WHERE is_active = TRUE AND type = $1 ORDER BY created_at DESC", values: [type] }
    : { text: "SELECT * FROM listings WHERE is_active = TRUE ORDER BY created_at DESC" };

  const { rows } = await pool.query(query);
  res.json(rows);
});

// GET /listings/:id -> détail d'une offre
router.get("/:id", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM listings WHERE id = $1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Offre introuvable" });
  res.json(rows[0]);
});

// POST /listings -> créer une offre (usage admin/partenaire, à protéger par auth admin)
router.post("/", async (req, res) => {
  const { partner_id, type, title, subtitle, description, price_fcfa, icon, accent_color, image_url, metadata } = req.body;

  const { rows } = await pool.query(
    `INSERT INTO listings (partner_id, type, title, subtitle, description, price_fcfa, icon, accent_color, image_url, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [partner_id, type, title, subtitle, description, price_fcfa, icon, accent_color, image_url, metadata || {}]
  );

  res.status(201).json(rows[0]);
});

module.exports = router;
