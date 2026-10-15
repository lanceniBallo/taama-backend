const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const requireAdmin = require('../middleware/requireAdmin');
const requirePartner = require('../middleware/requirePartner');

const router = express.Router();
const TYPES = new Set(['hotel','ticket','bus','airline','vehicle','car_rental','insurance','apartment','real_estate','taxi']);

function optionalPartner(req, res, next) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return next();
  try {
    const payload = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
    if (payload.role === 'partner') { req.partnerId = payload.partner_id; req.partnerType = payload.partner_type; }
  } catch (_) {}
  next();
}

// Les vols existent sous deux noms selon les versions ('airline' et 'flight') :
// on accepte les deux et on renvoie les deux.
// Même service, plusieurs noms selon l'app qui a créé l'offre : on les regroupe.
const GROUPS = [['airline', 'flight'], ['ticket', 'bus'], ['vehicle', 'car_rental'], ['real_estate', 'apartment']];
const TYPE_ALIASES = Object.fromEntries(GROUPS.flatMap((g) => g.map((t) => [t, g])));

// Seules les offres actives d'un partenaire actif sont montrées aux clients
// (sinon le client voit une offre qu'il ne peut pas réserver).
const VISIBLE = `l.is_active = TRUE AND (p.id IS NULL OR p.is_active = TRUE)`;
// Liste publique : uniquement les offres d'un vrai partenaire actif, validées par l'admin
// (les offres en attente de validation ou refusées ne sont pas montrées aux clients).
const LISTED = `l.is_active = TRUE AND p.is_active = TRUE AND COALESCE(l.status, 'validee') = 'validee'`;

router.get('/', async (req, res) => {
  try {
    const type = req.query.type ? String(req.query.type) : null;
    if (type && !TYPES.has(type) && !TYPE_ALIASES[type]) return res.status(400).json({ error: 'Type d’offre invalide' });
    const types = type ? (TYPE_ALIASES[type] || [type]) : null;
    const q = types
      ? { text: `SELECT l.*, p.name AS partner_name FROM listings l JOIN partners p ON p.id = l.partner_id WHERE ${LISTED} AND l.type = ANY($1) ORDER BY l.created_at DESC`, values: [types] }
      : { text: `SELECT l.*, p.name AS partner_name FROM listings l JOIN partners p ON p.id = l.partner_id WHERE ${LISTED} ORDER BY l.created_at DESC`, values: [] };
    return res.json((await pool.query(q)).rows);
  } catch (err) { console.error(err.message); return res.status(500).json({ error: 'Erreur serveur' }); }
});

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT l.* FROM listings l LEFT JOIN partners p ON p.id = l.partner_id WHERE l.id = $1 AND ${VISIBLE}`, [req.params.id]);
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
    // L'offre prend toujours le secteur du partenaire (évite un vol rangé dans les bus, etc.)
    const EXPECTED = { airline: 'airline', flight: 'airline', bus: 'ticket', ticket: 'ticket', hotel: 'hotel', car_rental: 'vehicle', vehicle: 'vehicle', real_estate: 'real_estate', apartment: 'real_estate', insurance: 'insurance', taxi: 'taxi' };
    const expected = EXPECTED[partner.rows[0].type];
    if (expected && !(TYPE_ALIASES[expected] || [expected]).includes(type)) type = expected;
    const result = await pool.query(`INSERT INTO listings (partner_id,type,title,subtitle,description,price_fcfa,icon,accent_color,image_url,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [partner_id,type,String(title).trim(),subtitle||null,description||null,Number(price_fcfa),icon||null,accent_color||null,image_url||null,metadata && typeof metadata === 'object' ? metadata : {}]);
    return res.status(201).json(result.rows[0]);
  } catch (err) { console.error('create listing:', err.message); return res.status(500).json({ error: 'Erreur serveur' }); }
}

router.post('/', optionalPartner, async (req, res, next) => {
  if (req.partnerId) return createListing(req, res);
  return requireAdmin(req, res, () => createListing(req, res));
});

module.exports = router;
