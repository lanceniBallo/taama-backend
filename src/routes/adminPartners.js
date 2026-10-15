const express = require('express');
const pool = require('../db');
const { generateAccessCode, hashAccessCode } = require('../utils/partnerCode');
const requireAdmin = require('../middleware/requireAdmin');
const { rateLimit } = require('../middleware/security');

const router = express.Router();
const adminLimit = rateLimit({ windowMs: 60_000, max: 60, keyFn: (req) => `admin:${req.ip || 'unknown'}` });
router.use(adminLimit);
router.use(requireAdmin);

// Colonne de « corbeille » : un partenaire supprimé disparaît de l'admin sans effacer la comptabilité
let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) schemaReady = pool.query('ALTER TABLE partners ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ').catch((e) => { schemaReady = null; throw e; });
  return schemaReady;
}

router.post('/partners', async (req, res) => {
  const { name, type } = req.body || {};
  if (!name || !type) return res.status(400).json({ error: 'name et type sont requis' });
  const code = generateAccessCode();
  try {
    const hash = hashAccessCode(code);
    const result = await pool.query(`INSERT INTO partners (name, type, sector, access_code_hash) VALUES ($1,$2,$2,$3) RETURNING id,name,type,sector,is_active,created_at`, [String(name).trim(), type, hash]);
    return res.status(201).json({ partner: result.rows[0], access_code: code });
  } catch (err) {
    console.error('création partenaire:', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/partners', async (req, res) => {
  try {
    await ensureSchema();
    const result = await pool.query('SELECT id,name,type,sector,is_active,created_at FROM partners WHERE deleted_at IS NULL ORDER BY created_at DESC');
    return res.json(result.rows);
  } catch (err) { console.error(err.message); return res.status(500).json({ error: 'Erreur serveur' }); }
});

router.patch('/partners/:id/toggle-active', async (req, res) => {
  try {
    const result = await pool.query('UPDATE partners SET is_active = NOT is_active WHERE id = $1 RETURNING id,name,type,sector,is_active,created_at', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Partenaire introuvable' });
    return res.json({ partner: result.rows[0] });
  } catch (err) { console.error(err.message); return res.status(500).json({ error: 'Erreur serveur' }); }
});

router.patch('/partners/:id/reset-code', async (req, res) => {
  const code = generateAccessCode();
  try {
    const hash = hashAccessCode(code);
    const result = await pool.query(
      'UPDATE partners SET access_code_hash = $1 WHERE id = $2 RETURNING id,name,type,sector,is_active,created_at',
      [hash, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Partenaire introuvable' });
    return res.json({ partner: result.rows[0], access_code: code });
  } catch (err) {
    console.error('reset code partenaire:', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Supprimer un partenaire :
// - sans aucune réservation : il est effacé complètement (avec ses offres) ;
// - avec des réservations : il est retiré de l'admin, son code ne marche plus et ses offres
//   sont masquées, mais l'historique des réservations et des paiements est gardé (comptabilité).
router.delete('/partners/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await ensureSchema();
    await client.query('BEGIN');
    const p = await client.query('SELECT id, name FROM partners WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [req.params.id]);
    if (!p.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Partenaire introuvable' }); }
    const used = await client.query('SELECT COUNT(*)::int AS n FROM bookings b JOIN listings l ON l.id = b.listing_id WHERE l.partner_id = $1', [req.params.id]);
    const nBookings = used.rows[0].n;

    if (nBookings === 0) {
      await client.query('SAVEPOINT full_delete');
      try {
        for (const sql of [
          'DELETE FROM partner_push_subscriptions WHERE partner_id = $1',
          'DELETE FROM withdrawals WHERE partner_id = $1',
          'DELETE FROM partner_withdrawals WHERE partner_id = $1',
          'UPDATE financial_ledger SET partner_id = NULL WHERE partner_id = $1',
          'DELETE FROM listings WHERE partner_id = $1',
          'DELETE FROM partners WHERE id = $1',
        ]) {
          await client.query('SAVEPOINT step');
          try { await client.query(sql, [req.params.id]); await client.query('RELEASE SAVEPOINT step'); }
          catch (e) {
            await client.query('ROLLBACK TO SAVEPOINT step');
            if (e.code !== '42P01') throw e; // 42P01 = table pas encore créée : rien à effacer
          }
        }
        await client.query('COMMIT');
        return res.json({ success: true, deleted: true });
      } catch (e) {
        console.error('suppression complète impossible, archivage :', e.message);
        await client.query('ROLLBACK TO SAVEPOINT full_delete');
      }
    }

    await client.query(`UPDATE partners SET deleted_at = now(), is_active = FALSE, access_code_hash = NULL WHERE id = $1`, [req.params.id]);
    await client.query('UPDATE listings SET is_active = FALSE WHERE partner_id = $1', [req.params.id]);
    await client.query('COMMIT');
    return res.json({ success: true, deleted: true, archived: true, bookings: nBookings });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('suppression partenaire:', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  } finally { client.release(); }
});

module.exports = router;
