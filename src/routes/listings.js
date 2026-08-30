const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const requireAdmin = require('../middleware/requireAdmin');
const requirePartner = require('../middleware/requirePartner');

const router = express.Router();
const TYPES = new Set(['hotel','ticket','bus','flight','vehicle','car_rental','insurance','apartment','real_estate','taxi']);

function optionalPartner(req, res, next) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return next();
  try {
    const payload = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
    if (payload.role === 'partner') { req.partnerId = payload.partner_id; req.partnerType = payload.partner_type; }
  } catch (_) {}
  next();
}

router.get('/', async (req, res) => {
  try {
    const type = req.query.type ? String(req.query.type) : null;
    if (type && !TYPES.has(type)) return res.status(400).json({ error: 'Type d’offre invalide' });
    const q = type
      ? { text: 'SELECT * FROM listings WHERE is_active=TRUE AND type=$1 ORDER BY created_at DESC', values: [type] }
      : { text: 'SELECT * FROM listings WHERE is_active=TRUE ORDER BY created_at DESC', values: [] };
    return res.json((await pool.query(q)).rows);
  } catch (err) { console.error(err.message); return res.status(500).json({ error: 'Erreur serveur' }); }
});

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM listings WHERE id=$1 AND is_active=TRUE', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Offre introuvable' });
    return res.json(rows[0]);
  } catch (err) { console.error(err.message); return res.status(500).json({ error: 'Erreur serveur' }); }
});

async function createListing(req, res) {
  let { partner_id, type, title, subtitle, description, price_fcfa, icon, accent_color, image_url, metadata } = req.body || {};
  if (!TYPES.has(type)) return res.status(400).json({ error: 'Type d’offre invalide' });
  if (!title || !Number.isInteger(Number(price_fcfa)) || Number(price_fcfa) < 0) return res.status(400).json({ error: 'Titre et prix valide requis' });

  if (req.partnerId) {
    partner_id = req.partnerId;
  } else if (!partner_id) {
    return res.status(400).json({ error: 'partner_id requis' });
  }

  try {
    const partner = await pool.query('SELECT id,type,is_active FROM partners WHERE id=$1', [partner_id]);
    if (!partner.rows[0] || !partner.rows[0].is_active) return res.status(400).json({ error: 'Partenaire invalide ou inactif' });
    const result = await pool.query(`INSERT INTO listings (partner_id,type,title,subtitle,description,price_fcfa,icon,accent_color,image_url,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [partner_id,type,String(title).trim(),subtitle||null,description||null,Number(price_fcfa),icon||null,accent_color||null,image_url||null,metadata && typeof metadata === 'object' ? metadata : {}]);
    return res.status(201).json(result.rows[0]);
  } catch (err) { console.error('create listing:', err.message); return res.status(500).json({ error: 'Erreur serveur' }); }
}

router.post('/', optionalPartner, async (req, res, next) => {
  if (req.partnerId) return createListing(req, res);
  return requireAdmin(req, res, () => createListing(req, res));
});

module.exports = router;
