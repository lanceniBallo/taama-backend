const express = require("express");
const pool = require("../db");
const requireAdmin = require("../middleware/requireAdmin");
const { getCommissionRate, canonicalType, clearRateCache } = require("../utils/finance");

const router = express.Router();

// Un réglage par service proposé dans Taama (ordre d'affichage dans l'admin)
const SERVICES = ["ticket", "airline", "hotel", "apartment", "vehicle", "taxi", "insurance", "real_estate"];

let ready = null;
function ensureCommissionRatesTable() {
  if (!ready) {
    ready = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS commission_rates (
          type VARCHAR(20) PRIMARY KEY,
          rate_percent NUMERIC(5,2) NOT NULL DEFAULT 10.00,
          updated_at TIMESTAMPTZ DEFAULT now()
        )`);
      for (const type of SERVICES) {
        await pool.query(
          `INSERT INTO commission_rates (type, rate_percent) VALUES ($1, $2) ON CONFLICT (type) DO NOTHING`,
          [type, getCommissionRate(type)]
        );
      }
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}
ensureCommissionRatesTable().catch((e) => console.error("commission_rates:", e.message)); // dès le démarrage

// GET /admin/settings/commissions — taux par service
router.get("/settings/commissions", requireAdmin, async (req, res) => {
  try {
    await ensureCommissionRatesTable();
    const { rows } = await pool.query(
      "SELECT type, rate_percent, updated_at FROM commission_rates WHERE type = ANY($1)", [SERVICES]);
    rows.sort((a, b) => SERVICES.indexOf(a.type) - SERVICES.indexOf(b.type));
    res.json(rows);
  } catch (err) {
    console.error("Erreur GET /admin/settings/commissions:", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// PUT /admin/settings/commissions/:type — body: { rate_percent: 12.5 }
// S'applique aux NOUVELLES réservations (les anciennes gardent leur commission).
router.put("/settings/commissions/:type", requireAdmin, async (req, res) => {
  const type = canonicalType(req.params.type);
  const rate = Number(req.body && req.body.rate_percent);
  if (!SERVICES.includes(type)) return res.status(404).json({ error: "Type de service introuvable" });
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return res.status(400).json({ error: "Le taux doit être un nombre entre 0 et 100" });
  try {
    await ensureCommissionRatesTable();
    const { rows } = await pool.query(
      `UPDATE commission_rates SET rate_percent = $1, updated_at = now() WHERE type = $2 RETURNING type, rate_percent, updated_at`,
      [rate, type]);
    clearRateCache();
    res.json({ commission: rows[0] });
  } catch (err) {
    console.error("Erreur PUT /admin/settings/commissions:", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
