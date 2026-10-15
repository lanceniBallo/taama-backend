// Taama — retraits côté partenaire.
// Utilise la même table "withdrawals" que l'admin (Finances > Demandes de retrait),
// et le même calcul de solde que l'admin (réservations confirmées − commission Taama).
const express = require('express');
const pool = require('../db');
const requirePartner = require('../middleware/requirePartner');

const router = express.Router();

let ready = null;
function ensureTable() {
  if (!ready) {
    ready = pool.query(`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
        amount_fcfa INTEGER NOT NULL CHECK (amount_fcfa > 0),
        status VARCHAR(20) NOT NULL DEFAULT 'en_attente'
          CHECK (status IN ('en_attente','approuvé','rejeté','payé')),
        note TEXT,
        requested_at TIMESTAMPTZ DEFAULT now(),
        processed_at TIMESTAMPTZ
      )`).catch((e) => { ready = null; throw e; });
  }
  return ready;
}

async function balanceOf(db, partnerId) {
  const { rows } = await db.query(`
    WITH revenue AS (
      SELECT b.price_fcfa,
             COALESCE(NULLIF(b.commission_fcfa, 0), ROUND(b.price_fcfa * COALESCE(cr.rate_percent, 10.00) / 100.0)) AS commission_fcfa
      FROM bookings b
      JOIN listings l ON l.id = b.listing_id
      LEFT JOIN commission_rates cr ON cr.type = l.type
      WHERE b.status = 'Confirmé' AND l.partner_id = $1
    )
    SELECT
      (SELECT COALESCE(SUM(price_fcfa - commission_fcfa), 0) FROM revenue)::int AS total_reversable,
      (SELECT COALESCE(SUM(amount_fcfa), 0) FROM withdrawals
        WHERE partner_id = $1 AND status IN ('en_attente','approuvé','payé'))::int AS total_withdrawn_or_pending`,
    [partnerId]);
  const r = rows[0];
  return { ...r, available_balance: r.total_reversable - r.total_withdrawn_or_pending };
}

// Solde disponible
router.get('/balance', requirePartner, async (req, res) => {
  try { await ensureTable(); res.json(await balanceOf(pool, req.partnerId)); }
  catch (err) { console.error('partner balance:', err.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// Historique des demandes
router.get('/withdrawals', requirePartner, async (req, res) => {
  try {
    await ensureTable();
    const { rows } = await pool.query(
      `SELECT id, amount_fcfa, status, note, requested_at, processed_at
       FROM withdrawals WHERE partner_id = $1 ORDER BY requested_at DESC`, [req.partnerId]);
    res.json(rows);
  } catch (err) { console.error('partner withdrawals:', err.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// Nouvelle demande
router.post('/withdrawals', requirePartner, async (req, res) => {
  const amount = Number(req.body && req.body.amount_fcfa);
  const account = String((req.body && (req.body.account_reference || req.body.phone)) || '').trim();
  if (!Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: 'Montant invalide' });
  if (!account) return res.status(400).json({ error: 'Numéro de paiement requis' });
  let client;
  try {
    await ensureTable();
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query('SELECT id FROM partners WHERE id = $1 FOR UPDATE', [req.partnerId]); // évite deux demandes simultanées
    const bal = await balanceOf(client, req.partnerId);
    if (amount > bal.available_balance) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Solde insuffisant (disponible : ${bal.available_balance} FCFA)` });
    }
    const { rows } = await client.query(
      `INSERT INTO withdrawals (partner_id, amount_fcfa, note) VALUES ($1, $2, $3) RETURNING *`,
      [req.partnerId, amount, `Orange Money : ${account.slice(0, 40)}`]);
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('partner withdrawal:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally { if (client) client.release(); }
});

module.exports = router;
