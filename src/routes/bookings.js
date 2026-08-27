const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../db');
const { splitAmount } = require('../utils/finance');
const { requireEnv, safeEqual } = require('../middleware/security');

const router = express.Router();

function requireAuth(req,res,next){
  const token=(req.headers.authorization||'').startsWith('Bearer ')?req.headers.authorization.slice(7):null;
  if(!token)return res.status(401).json({error:'Non authentifié'});
  try{req.user=jwt.verify(token,process.env.JWT_SECRET);next();}catch{res.status(401).json({error:'Token invalide ou expiré'});}
}
function makeReference(){ return 'TM-' + crypto.randomBytes(5).toString('hex').toUpperCase(); }

router.get('/', requireAuth, async(req,res)=>{
  try{ const {rows}=await pool.query(`SELECT b.*,l.title,l.subtitle,l.icon,l.accent_color FROM bookings b JOIN listings l ON l.id=b.listing_id WHERE b.user_id=$1 ORDER BY b.created_at DESC`,[req.user.userId]); return res.json(rows); }
  catch(err){console.error(err.message);return res.status(500).json({error:'Erreur serveur'});}
});

router.post('/', requireAuth, async(req,res)=>{
  const {listing_id,payment_method,passenger_name,passenger_document,contact_phone,contact_email,options}=req.body||{};
  if(!listing_id)return res.status(400).json({error:'listing_id requis'});
  try{
    const {rows}=await pool.query(`SELECT l.*,p.id AS partner_id FROM listings l LEFT JOIN partners p ON p.id=l.partner_id WHERE l.id=$1 AND l.is_active=TRUE AND (p.id IS NULL OR p.is_active=TRUE)`,[listing_id]);
    const listing=rows[0];
    if(!listing)return res.status(404).json({error:'Offre introuvable ou inactive'});
    if(!Number.isInteger(Number(listing.price_fcfa))||Number(listing.price_fcfa)<0)return res.status(400).json({error:'Prix invalide'});
    const {rate,commission,partnerAmount}=splitAmount(listing.price_fcfa,listing.type);
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      let inserted;
      for(let attempt=0;attempt<3;attempt++){
        const reference=makeReference();
        try{ inserted=await client.query(`INSERT INTO bookings (reference,user_id,listing_id,status,price_fcfa,payment_method,passenger_name,passenger_document,contact_phone,contact_email,options,commission_rate,commission_fcfa,partner_amount_fcfa) VALUES ($1,$2,$3,'En attente',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,[reference,req.user.userId,listing_id,listing.price_fcfa,payment_method||'manuel',passenger_name||null,passenger_document||null,contact_phone||null,contact_email||null,options&&typeof options==='object'?options:{},rate,commission,partnerAmount]);break;}catch(e){if(e.code!=='23505'||attempt===2)throw e;}
      }
      await client.query(`INSERT INTO financial_ledger (booking_id,partner_id,kind,amount_fcfa,description) VALUES ($1,$2,'booking_pending',$3,$4)`,[inserted.rows[0].id,listing.partner_id,listing.price_fcfa,`Réservation ${inserted.rows[0].reference}`]);
      await client.query('COMMIT');
      return res.status(201).json(inserted.rows[0]);
    }catch(err){await client.query('ROLLBACK');throw err;}finally{client.release();}
  }catch(err){console.error('create booking:',err.message);return res.status(500).json({error:'Erreur serveur'});}
});

router.patch('/:id/confirm', async(req,res)=>{
  if(!process.env.PAYMENT_WEBHOOK_SECRET)return res.status(503).json({error:'Webhook paiement non configuré'});
  if(!safeEqual(req.headers['x-payment-webhook-secret'],process.env.PAYMENT_WEBHOOK_SECRET))return res.status(401).json({error:'Webhook non autorisé'});
  const paymentReference=String(req.body?.payment_reference||'').trim();
  const provider=String(req.body?.provider||'orange_money').trim();
  if(!paymentReference)return res.status(400).json({error:'payment_reference requis'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const existing=await client.query('SELECT * FROM bookings WHERE payment_reference=$1 FOR UPDATE',[paymentReference]);
    if(existing.rows[0]){await client.query('COMMIT');return res.json(existing.rows[0]);}
    const {rows}=await client.query(`UPDATE bookings SET status='En attente',payment_status='payé',paid_at=now(),payment_provider=$2,payment_reference=$3 WHERE id=$1 AND payment_status<>'payé' RETURNING *`,[req.params.id,provider,paymentReference]);
    if(!rows[0]){await client.query('ROLLBACK');return res.status(409).json({error:'Réservation introuvable ou paiement déjà traité'});}
    await client.query(`INSERT INTO financial_ledger (booking_id,partner_id,kind,amount_fcfa,description) SELECT b.id,l.partner_id,'booking_paid',b.price_fcfa,'Paiement confirmé '||b.reference FROM bookings b JOIN listings l ON l.id=b.listing_id WHERE b.id=$1`,[req.params.id]);
    await client.query('COMMIT');
    return res.json(rows[0]);
  }catch(err){await client.query('ROLLBACK');console.error('confirm booking:',err.message);return res.status(500).json({error:'Erreur serveur'});}finally{client.release();}
});

module.exports=router;
