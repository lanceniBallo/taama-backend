const express = require('express');
const pool = require('../db');
const requirePartner = require('../middleware/requirePartner');

const router = express.Router();
router.use(requirePartner);

router.get('/bookings', async (req, res) => {
  try {
    const result = await pool.query(`SELECT b.*, l.title,l.subtitle,l.type FROM bookings b JOIN listings l ON l.id=b.listing_id WHERE l.partner_id=$1 ORDER BY b.created_at DESC`, [req.partnerId]);
    return res.json(result.rows);
  } catch (err) { console.error(err.message); return res.status(500).json({ error: 'Erreur serveur' }); }
});

router.patch('/bookings/:id/confirm', (req,res) => updateBookingStatus(req,res,'Confirmé'));
router.patch('/bookings/:id/reject', (req,res) => updateBookingStatus(req,res,'Rejeté'));

async function updateBookingStatus(req,res,status) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const check = await client.query(`SELECT b.* FROM bookings b JOIN listings l ON l.id=b.listing_id WHERE b.id=$1 AND l.partner_id=$2 FOR UPDATE`, [req.params.id, req.partnerId]);
    const booking = check.rows[0];
    if (!booking) { await client.query('ROLLBACK'); return res.status(404).json({ error:'Réservation introuvable pour ce partenaire' }); }
    if (status === 'Confirmé' && booking.payment_status !== 'payé') { await client.query('ROLLBACK'); return res.status(409).json({ error:'Le paiement doit être confirmé avant la validation partenaire' }); }
    if (['Confirmé','Rejeté'].includes(booking.status)) { await client.query('ROLLBACK'); return res.status(409).json({ error:'Réservation déjà traitée' }); }
    const result = await client.query(`UPDATE bookings SET status=$1, cancelled_at=CASE WHEN $1='Rejeté' THEN now() ELSE cancelled_at END WHERE id=$2 RETURNING *`, [status, req.params.id]);
    if (status === 'Rejeté') {
      await client.query(`INSERT INTO financial_ledger (booking_id,partner_id,kind,amount_fcfa,description) VALUES ($1,$2,'booking_rejected',0,$3)`, [booking.id, req.partnerId, `Réservation ${booking.reference} rejetée par le partenaire`]);
    }
    await client.query('COMMIT');
    return res.json(result.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); console.error(err.message); return res.status(500).json({ error:'Erreur serveur' }); }
  finally { client.release(); }
}

module.exports = router;
