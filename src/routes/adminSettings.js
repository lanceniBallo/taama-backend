const express = require("express");
const pool = require("../db");

const router = express.Router();

function requireAdmin(req, res, next) {
  const key = req.headers["x-admin-key"];
  if (!key || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: "Non autorisé" });
  }
  next();
}

const DEFAULT_RATES = [
  ["hotel", 10.0],
  ["ticket", 10.0],
  ["vehicle", 10.0],
  ["insurance", 10.0],
];

// Crée la table commission_rates si elle n'existe pas encore, et insère
// les taux par défaut. Idempotent : peut être appelé à chaque requête sans risque.
async function ensureCommissionRatesTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS commission_rates (
      type VARCHAR(20) PRIMARY KEY,
      rate_percent NUMERIC(5,2) NOT NULL DEFAULT 10.00,
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `);
  for (const [type, rate] of DEFAULT_RATES) {
    await pool.query(
      `INSERT INTO commission_rates (type, rate_percent)
       VALUES ($1, $2)
       ON CONFLICT (type) DO NOTHING`,
      [type, rate]
    );
  }
}

// GET /admin/settings/commissions
// Liste les taux de commission par type de service
router.get("/settings/commissions", requireAdmin, async (req, res) => {
  try {
    await ensureCommissionRatesTable();
    const result = await pool.query(
      "SELECT type, rate_percent, updated_at FROM commission_rates ORDER BY type"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Erreur GET /admin/settings/commissions:", err.message);
    res.status(500).json({ error: "Erreur serveur : " + err.message });
  }
});

// PUT /admin/settings/commissions/:type
// body: { rate_percent: 12.5 }
router.put("/settings/commissions/:type", requireAdmin, async (req, res) => {
  const { type } = req.params;
  const { rate_percent } = req.body;

  const rate = Number(rate_percent);
  if (Number.isNaN(rate) || rate < 0 || rate > 100) {
    return res.status(400).json({ error: "rate_percent doit être un nombre entre 0 et 100" });
  }

  try {
    await ensureCommissionRatesTable();
    const result = await pool.query(
      `UPDATE commission_rates
       SET rate_percent = $1, updated_at = now()
       WHERE type = $2
       RETURNING type, rate_percent, updated_at`,
      [rate, type]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Type de service introuvable" });
    }
    res.json({ commission: result.rows[0] });
  } catch (err) {
    console.error("Erreur PUT /admin/settings/commissions/:type:", err.message);
    res.status(500).json({ error: "Erreur serveur : " + err.message });
  }
});

module.exports = router;
