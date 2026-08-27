const express = require("express");
const pool = require("../db");
const requirePartner = require("../middleware/requirePartner");

const router = express.Router();

// Crée la table withdrawals si elle n'existe pas encore (idempotent).
async function ensureWithdrawalsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS withdrawals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
      amount_fcfa INTEGER NOT NULL CHECK (amount_fcfa > 0),
      status VARCHAR(20) NOT NULL DEFAULT 'en_attente'
        CHECK (status IN ('en_attente','approuvé','rejeté','payé')),
      note TEXT,
      requested_at TIMESTAMPTZ DEFAULT now(),
      processed_at TIMESTAMPTZ
    )
  `);
}

async function getAvailableBalance(partnerId) {
  const revenueResult = await pool.query(`
    SELECT COALESCE(SUM(
      b.price_fcfa - ROUND(b.price_fcfa * COALESCE(cr.rate_percent, 10.00) / 100.0)
    ), 0)::int AS total_reversable
    FROM bookings b
    JOIN listings l ON l.id = b.listing_id
    LEFT JOIN commission_rates cr ON cr.type = l.type
    WHERE l.partner_id = $1 AND b.status = 'Confirmé'
  `, [partnerId]);

  const withdrawnResult = await pool.query(`
    SELECT COALESCE(SUM(amount_fcfa), 0)::int AS total
    FROM withdrawals
    WHERE partner_id = $1 AND status IN ('en_attente','approuvé','payé')
  `, [partnerId]);

  return revenueResult.rows[0].total_reversable - withdrawnResult.rows[0].total;
}

// GET /partner/balance
router.get("/balance", requirePartner, async (req, res) => {
  try {
    await ensureWithdrawalsTable();
    const available = await getAvailableBalance(req.partnerId);
    res.json({ available_balance: available });
  } catch (err) {
    console.error("Erreur GET /partner/balance:", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /partner/withdrawals — historique des demandes du partenaire connecté
router.get("/withdrawals", requirePartner, async (req, res) => {
  try {
    await ensureWithdrawalsTable();
    const result = await pool.query(
      `SELECT id, amount_fcfa, status, note, requested_at, processed_at
       FROM withdrawals WHERE partner_id = $1 ORDER BY requested_at DESC`,
      [req.partnerId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Erreur GET /partner/withdrawals:", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /partner/withdrawals — body: { amount_fcfa }
router.post("/withdrawals", requirePartner, async (req, res) => {
  const amount = Number(req.body.amount_fcfa);
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: "Montant invalide" });
  }
  try {
    await ensureWithdrawalsTable();
    const available = await getAvailableBalance(req.partnerId);
    if (amount > available) {
      return res.status(400).json({ error: `Solde insuffisant. Disponible : ${available} FCFA` });
    }
    const result = await pool.query(
      `INSERT INTO withdrawals (partner_id, amount_fcfa) VALUES ($1, $2) RETURNING *`,
      [req.partnerId, amount]
    );
    res.status(201).json({ withdrawal: result.rows[0] });
  } catch (err) {
    console.error("Erreur POST /partner/withdrawals:", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
