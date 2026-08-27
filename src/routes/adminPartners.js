cd ~/Downloads/taama-backend

cat > src/routes/adminPartners.js << 'ENDOFFILE'
const express = require('express');
const pool = require('../db');
const { generateAccessCode, hashAccessCode } = require('../utils/partnerCode');
const requireAdmin = require('../middleware/requireAdmin');
const { rateLimit } = require('../middleware/security');

const router = express.Router();
const adminLimit = rateLimit({ windowMs: 60_000, max: 60, keyFn: (req) => `admin:${req.ip || 'unknown'}` });
router.use(adminLimit);
router.use(requireAdmin);

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
    const result = await pool.query('SELECT id,name,type,sector,is_active,created_at FROM partners ORDER BY created_at DESC');
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

// Régénère le code d'accès du partenaire — l'ancien code cesse de fonctionner immédiatement.
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

// Suppression protégée : à utiliser seulement si aucun historique financier ne dépend du partenaire.
router.delete('/partners/:id', async (req, res) => {
  try {
    const result = await pool.query('UPDATE partners SET is_active = FALSE WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Partenaire introuvable' });
    return res.json({ success: true, archived: true });
  } catch (err) { console.error(err.message); return res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;
ENDOFFILE

cat src/routes/adminPartners.js
git add src/routes/adminPartners.js
git commit -m "feat: ajouter la route de réinitialisation du code d'accès partenaire"
git push origin main
