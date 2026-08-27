const express=require('express');
const pool=require('../db');
const requirePartner=require('../middleware/requirePartner');
const router=express.Router();

router.get('/summary',requirePartner,async(req,res)=>{
 try{
  const {rows}=await pool.query(`
   SELECT p.id,p.name,p.type,
    COALESCE(SUM(CASE WHEN b.payment_status='payé' AND b.status NOT IN ('Annulé','Rejeté') THEN b.partner_amount_fcfa ELSE 0 END),0)::int AS earned_fcfa,
    COALESCE((SELECT SUM(amount_fcfa) FROM partner_withdrawals w WHERE w.partner_id=p.id AND w.status='Payé'),0)::int AS paid_fcfa,
    COALESCE((SELECT SUM(amount_fcfa) FROM partner_withdrawals w WHERE w.partner_id=p.id AND w.status='En attente'),0)::int AS pending_fcfa
   FROM partners p LEFT JOIN listings l ON l.partner_id=p.id LEFT JOIN bookings b ON b.listing_id=l.id
   WHERE p.id=$1 GROUP BY p.id`,[req.partnerId]);
  if(!rows[0]) return res.status(404).json({error:'Partenaire introuvable'});
  const r=rows[0]; r.available_fcfa=Number(r.earned_fcfa)-Number(r.paid_fcfa)-Number(r.pending_fcfa); res.json(r);
 }catch(err){console.error(err.message);res.status(500).json({error:'Erreur serveur'});}
});

router.post('/withdrawals',requirePartner,async(req,res)=>{
 const {amount_fcfa,method,account_reference}=req.body;
 const amount=Number(amount_fcfa);
 if(!Number.isInteger(amount)||amount<=0||!method||!account_reference) return res.status(400).json({error:'Montant, méthode et compte sont requis'});
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query(`SELECT id FROM partners WHERE id=$1 FOR UPDATE`,[req.partnerId]);
  const earned=(await client.query(`SELECT COALESCE(SUM(CASE WHEN b.payment_status='payé' AND b.status NOT IN ('Annulé','Rejeté') THEN b.partner_amount_fcfa ELSE 0 END),0)::int AS v FROM listings l LEFT JOIN bookings b ON b.listing_id=l.id WHERE l.partner_id=$1`,[req.partnerId])).rows[0].v;
  const paid=(await client.query(`SELECT COALESCE(SUM(amount_fcfa),0)::int AS v FROM partner_withdrawals WHERE partner_id=$1 AND status IN ('Payé','En attente')`,[req.partnerId])).rows[0].v;
  const available=Number(earned)-Number(paid);
  if(amount>available){await client.query('ROLLBACK');return res.status(400).json({error:'Solde disponible insuffisant',available_fcfa:available});}
  const {rows}=await client.query(`INSERT INTO partner_withdrawals(partner_id,amount_fcfa,method,account_reference) VALUES($1,$2,$3,$4) RETURNING *`,[req.partnerId,amount,method,account_reference]);
  await client.query('COMMIT');res.status(201).json(rows[0]);
 }catch(err){await client.query('ROLLBACK');console.error(err.message);res.status(500).json({error:'Erreur serveur'});}finally{client.release();}
});
module.exports=router;
