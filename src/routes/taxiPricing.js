const express = require('express');
const pool = require('../db');
const requireAdmin = require('../middleware/requireAdmin');

const router = express.Router();
const VEHICLE_TYPES = new Set(['moto', 'voiture']);
const DISTANCE_TIERS = new Set(['courte', 'moyenne', 'longue']);

// Calcule le prix d'une course à partir des tarifs enregistrés en base.
// Réutilisée à la fois par /taxi/estimate (affichage indicatif) et par la création
// de réservation (calcul faisant foi) — jamais un prix envoyé par le client.
async function computeTaxiPrice(vehicle_type, distance_tier) {
  if (!VEHICLE_TYPES.has(vehicle_type)) throw Object.assign(new Error('Type de véhicule invalide'), { status: 400 });
  if (!DISTANCE_TIERS.has(distance_tier)) throw Object.assign(new Error('Distance invalide'), { status: 400 });
  const { rows } = await pool.query(
    'SELECT price_fcfa FROM taxi_rates WHERE vehicle_type = $1 AND distance_tier = $2',
    [vehicle_type, distance_tier]
  );
  if (!rows[0]) throw Object.assign(new Error('Tarif non configuré pour cette combinaison'), { status: 404 });
  return rows[0].price_fcfa;
}

// POST /taxi/estimate — utilisé par l'app client pour afficher un prix indicatif
// avant de réserver. Ne crée rien, ne fait pas foi pour la réservation elle-même.
router.post('/estimate', async (req, res) => {
  try {
    const { vehicle_type, distance_tier } = req.body || {};
    const price_fcfa = await computeTaxiPrice(vehicle_type, distance_tier);
    return res.json({ vehicle_type, distance_tier, price_fcfa });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.status ? err.message : 'Erreur serveur' });
  }
});

// GET /taxi/rates — grille actuelle (admin, ou affichage informatif)
router.get('/rates', requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM taxi_rates ORDER BY vehicle_type, distance_tier');
    return res.json(rows);
  } catch (err) { console.error(err.message); return res.status(500).json({ error: 'Erreur serveur' }); }
});

// PATCH /taxi/rates — modification d'un tarif par l'admin
router.patch('/rates', requireAdmin, async (req, res) => {
  try {
    const { vehicle_type, distance_tier, price_fcfa } = req.body || {};
    if (!VEHICLE_TYPES.has(vehicle_type)) return res.status(400).json({ error: 'Type de véhicule invalide' });
    if (!DISTANCE_TIERS.has(distance_tier)) return res.status(400).json({ error: 'Distance invalide' });
    if (!Number.isInteger(Number(price_fcfa)) || Number(price_fcfa) < 0) return res.status(400).json({ error: 'Prix invalide' });
    const { rows } = await pool.query(
      `INSERT INTO taxi_rates (vehicle_type, distance_tier, price_fcfa, updated_at)
       VALUES ($1,$2,$3, now())
       ON CONFLICT (vehicle_type, distance_tier) DO UPDATE SET price_fcfa = $3, updated_at = now()
       RETURNING *`,
      [vehicle_type, distance_tier, Number(price_fcfa)]
    );
    return res.json(rows[0]);
  } catch (err) { console.error(err.message); return res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;
module.exports.computeTaxiPrice = computeTaxiPrice;
