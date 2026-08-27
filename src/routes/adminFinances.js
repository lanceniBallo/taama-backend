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

// Sous-requête réutilisable : commission Taama appliquée à chaque réservation
// confirmée, à partir du taux configuré par type de service (10% par défaut
// si aucun taux n'est encore configuré pour ce type).
const REVENUE_CTE = `
  WITH revenue AS (
    SELECT
      l.partner_id,
      b.price_fcfa,
      COALESCE(cr.rate_percent, 10.00) AS rate_percent,
      ROUND(b.price_fcfa * COALESCE(cr.rate_percent, 10.00) / 100.0) AS commission_fcfa
    FROM bookings b
    JOIN listings l ON l.id = b.listing_id
    LEFT JOIN commission_rates cr ON cr.type = l.type
    WHERE b.status = 'Confirmé'
  )
`;

// ==========================================
// GET /admin/finances/summary
// Chiffre d'affaires, commission Taama, à reverser, retraits en attente
// ==========================================
router.get("/finances/summary", requireAdmin, async (req, res) => {
  try {
    await ensureWithdrawalsTable();

    const revenueResult = await pool.query(`
      ${REVENUE_CTE}
      SELECT
        COALESCE(SUM(price_fcfa), 0)::int AS total_revenue,
        COALESCE(SUM(commission_fcfa), 0)::int AS total_commission,
        COALESCE(SUM(price_fcfa - commission_fcfa), 0)::int AS total_reversable
      FROM revenue
    `);

    const pendingResult = await pool.query(`
      SELECT COALESCE(SUM(amount_fcfa), 0)::int AS total_pending
      FROM withdrawals WHERE status = 'en_attente'
    `);

    res.json({
      ...revenueResult.rows[0],
      pending_withdrawals: pendingResult.rows[0].total_pending,
    });
  } catch (err) {
    console.error("Erreur GET /admin/finances/summary:", err.message);
    res.status(500).json({ error: "Erreur serveur : " + err.message });
  }
});

// ==========================================
// GET /admin/finances/by-partner
// Solde par partenaire : revenu, commission, à reverser, déjà retiré, disponible
// ==========================================
router.get("/finances/by-partner", requireAdmin, async (req, res) => {
  try {
    await ensureWithdrawalsTable();

    const result = await pool.query(`
      ${REVENUE_CTE}
      SELECT
        p.id AS partner_id,
        p.name AS partner_name,
        p.type AS partner_type,
        COALESCE(SUM(r.price_fcfa), 0)::int AS total_revenue,
        COALESCE(SUM(r.commission_fcfa), 0)::int AS total_commission,
        COALESCE(SUM(r.price_fcfa - r.commission_fcfa), 0)::int AS total_reversable,
        COALESCE((
          SELECT SUM(amount_fcfa) FROM withdrawals w
          WHERE w.partner_id = p.id AND w.status IN ('en_attente','approuvé','payé')
        ), 0)::int AS total_withdrawn_or_pending
      FROM partners p
      LEFT JOIN revenue r ON r.partner_id = p.id
      GROUP BY p.id, p.name, p.type
      ORDER BY total_reversable DESC
    `);

    const rows = result.rows.map(r => ({
      ...r,
      available_balance: r.total_reversable - r.total_withdrawn_or_pending,
    }));

    res.json(rows);
  } catch (err) {
    console.error("Erreur GET /admin/finances/by-partner:", err.message);
    res.status(500).json({ error: "Erreur serveur : " + err.message });
  }
});

// ==========================================
// GET /admin/withdrawals
// Toutes les demandes de retrait, avec nom du partenaire
// ==========================================
router.get("/withdrawals", requireAdmin, async (req, res) => {
  try {
    await ensureWithdrawalsTable();
    const result = await pool.query(`
      SELECT w.id, w.amount_fcfa, w.status, w.note, w.requested_at, w.processed_at,
             p.id AS partner_id, p.name AS partner_name, p.type AS partner_type
      FROM withdrawals w
      JOIN partners p ON p.id = w.partner_id
      ORDER BY w.requested_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("Erreur GET /admin/withdrawals:", err.message);
    res.status(500).json({ error: "Erreur serveur : " + err.message });
  }
});

// ==========================================
// PATCH /admin/withdrawals/:id/approve
// ==========================================
router.patch("/withdrawals/:id/approve", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE withdrawals SET status = 'approuvé', processed_at = now()
       WHERE id = $1 AND status = 'en_attente' RETURNING *`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Demande introuvable ou déjà traitée" });
    }
    res.json({ withdrawal: result.rows[0] });
  } catch (err) {
    console.error("Erreur approve withdrawal:", err.message);
    res.status(500).json({ error: "Erreur serveur : " + err.message });
  }
});

// ==========================================
// PATCH /admin/withdrawals/:id/reject
// body: { note?: string }
// ==========================================
router.patch("/withdrawals/:id/reject", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE withdrawals SET status = 'rejeté', processed_at = now(), note = $2
       WHERE id = $1 AND status = 'en_attente' RETURNING *`,
      [req.params.id, req.body.note || null]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Demande introuvable ou déjà traitée" });
    }
    res.json({ withdrawal: result.rows[0] });
  } catch (err) {
    console.error("Erreur reject withdrawal:", err.message);
    res.status(500).json({ error: "Erreur serveur : " + err.message });
  }
});

// ==========================================
// PATCH /admin/withdrawals/:id/mark-paid
// À utiliser une fois le virement/mobile money réellement effectué
// ==========================================
router.patch("/withdrawals/:id/mark-paid", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE withdrawals SET status = 'payé', processed_at = now()
       WHERE id = $1 AND status = 'approuvé' RETURNING *`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Demande introuvable ou pas encore approuvée" });
    }
    res.json({ withdrawal: result.rows[0] });
  } catch (err) {
    console.error("Erreur mark-paid withdrawal:", err.message);
    res.status(500).json({ error: "Erreur serveur : " + err.message });
  }
});

module.exports = router;
