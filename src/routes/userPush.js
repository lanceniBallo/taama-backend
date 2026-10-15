const express = require('express');
const jwt = require('jsonwebtoken');
const push = require('../utils/userPush');

const router = express.Router();

function requireUser(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Non authentifié' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); if (req.user.role !== 'user') throw new Error(); next(); }
  catch { return res.status(401).json({ error: 'Token invalide ou expiré' }); }
}

// Clé publique pour que l'app client s'abonne aux notifications
router.get('/push/key', (req, res) => {
  if (!push.isConfigured()) return res.status(503).json({ error: 'Notifications pas encore configurées' });
  res.json({ key: process.env.VAPID_PUBLIC_KEY });
});

router.post('/push/subscribe', requireUser, async (req, res) => {
  const sub = req.body || {};
  if (!/^https:\/\//.test(sub.endpoint || '') || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return res.status(400).json({ error: 'Abonnement invalide' });
  try { await push.saveSubscription(req.user.userId, sub); res.json({ success: true }); }
  catch (e) { console.error('push subscribe client:', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

router.post('/push/unsubscribe', requireUser, async (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  if (!endpoint) return res.status(400).json({ error: 'Abonnement invalide' });
  try { await push.removeSubscription(endpoint); res.json({ success: true }); }
  catch (e) { console.error('push unsubscribe client:', e.message); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;
