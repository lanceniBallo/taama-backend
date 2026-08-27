const express=require('express');
const pool=require('../db');
const {COMMISSION_RATES}=require('../utils/finance');
const requireAdmin=require('../middleware/requireAdmin');
const router=express.Router();
router.use(requireAdmin);

router.get('/summary',async(req,res)=>{try{
 const {rows}=await pool.query(`SELECT COALESCE(SUM(CASE WHEN payment_status='payé' AND status NOT IN ('Annulé','Rejeté') THEN price_fcfa ELSE 0 END),0)::int gross_fcfa, COALESCE(SUM(CASE WHEN payment_status='payé' AND status NOT IN ('Annulé','Rejeté') THEN commission_fcfa ELSE 0 END),0)::int commission_fcfa, COALESCE(SUM(CASE WHEN payment_status='payé' AND status NOT IN ('Annulé','Rejeté') THEN partner_amount_fcfa ELSE 0 END),0)::int partner_fcfa, COUNT(*)::int booking_count FROM bookings`);
 const withdrawals=await pool.query(`SELECT COALESCE(SUM(CASE WHEN status='En attente' THEN amount_fcfa ELSE 0 END),0)::int pending_fcfa,COALESCE(SUM(CASE WHEN status='Payé' THEN amount_fcfa ELSE 0 END),0)::int paid_fcfa FROM partner_withdrawals`);
 return res.json({...rows[0],...withdrawals.rows[0],commission_rates:COMMISSION_RATES});
}catch(err){console.error(err.message);return res.status(500).json({error:'Erreur serveur'});}});

router.get('/withdrawals',async(req,res)=>{try{return res.json((await pool.query(`SELECT w.*,p.name partner_name FROM partner_withdrawals w JOIN partners p ON p.id=w.partner_id ORDER BY w.created_at DESC`)).rows);}catch(err){console.error(err.message);return res.status(500).json({error:'Erreur serveur'});}});

router.patch('/withdrawals/:id/pay',async(req,res)=>{const client=await pool.connect();try{await client.query('BEGIN');const {rows}=await client.query(`UPDATE partner_withdrawals SET status='Payé',processed_at=now() WHERE id=$1 AND status='En attente' RETURNING *`,[req.params.id]);if(!rows[0]){await client.query('ROLLBACK');return res.status(404).json({error:'Retrait introuvable ou déjà traité'});}await client.query(`INSERT INTO financial_ledger(partner_id,kind,amount_fcfa,description) VALUES($1,'withdrawal',-$2,$3)`,[rows[0].partner_id,rows[0].amount_fcfa,`Retrait ${rows[0].id}`]);await client.query('COMMIT');return res.json(rows[0]);}catch(err){await client.query('ROLLBACK');console.error(err.message);return res.status(500).json({error:'Erreur serveur'});}finally{client.release();}});

router.post('/withdrawals/:id/reject',async(req,res)=>{try{const {rows}=await pool.query(`UPDATE partner_withdrawals SET status='Rejeté',processed_at=now(),note=$2 WHERE id=$1 AND status='En attente' RETURNING *`,[req.params.id,req.body?.note||null]);if(!rows[0])return res.status(404).json({error:'Retrait introuvable ou déjà traité'});return res.json(rows[0]);}catch(err){console.error(err.message);return res.status(500).json({error:'Erreur serveur'});}});

router.get('/partners/:id',async(req,res)=>{try{const {rows}=await pool.query(`SELECT p.id,p.name,p.type,p.is_active,COALESCE(SUM(CASE WHEN b.payment_status='payé' AND b.status NOT IN ('Annulé','Rejeté') THEN b.price_fcfa ELSE 0 END),0)::int gross_fcfa,COALESCE(SUM(CASE WHEN b.payment_status='payé' AND b.status NOT IN ('Annulé','Rejeté') THEN b.commission_fcfa ELSE 0 END),0)::int commission_fcfa,COALESCE(SUM(CASE WHEN b.payment_status='payé' AND b.status NOT IN ('Annulé','Rejeté') THEN b.partner_amount_fcfa ELSE 0 END),0)::int-COALESCE((SELECT SUM(amount_fcfa) FROM partner_withdrawals w WHERE w.partner_id=p.id AND w.status IN ('Payé','En attente')),0)::int available_fcfa FROM partners p LEFT JOIN listings l ON l.partner_id=p.id LEFT JOIN bookings b ON b.listing_id=l.id WHERE p.id=$1 GROUP BY p.id`,[req.params.id]);if(!rows[0])return res.status(404).json({error:'Partenaire introuvable'});return res.json(rows[0]);}catch(err){console.error(err.message);return res.status(500).json({error:'Erreur serveur'});}});
module.exports=router;
