const express = require('express');
const requirePartner = require('../middleware/requirePartner');
const push = require('../utils/push');

const router = express.Router();

// Clé publique utilisée par l'app partenaire pour s'abonner aux notifications
router.get('/push/key', (req, res) => {
  if (!push.isConfigured()) return res.status(503).json({ error: 'Notifications pas encore configurées' });
  res.json({ key: process.env.VAPID_PUBLIC_KEY });
});

// Enregistre un appareil (téléphone / ordinateur) du partenaire connecté
router.post('/push/subscribe', requirePartner, async (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  if (!endpoint || !/^https:\/\//.test(endpoint)) return res.status(400).json({ error: 'Abonnement invalide' });
  try { await push.saveSubscription(req.partnerId, endpoint); res.json({ success: true }); }
  catch (e) { console.error('push subscribe:', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

// Désactive les notifications sur cet appareil
router.post('/push/unsubscribe', requirePartner, async (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  if (!endpoint) return res.status(400).json({ error: 'Abonnement invalide' });
  try { await push.removeSubscription(endpoint); res.json({ success: true }); }
  catch (e) { console.error('push unsubscribe:', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;
