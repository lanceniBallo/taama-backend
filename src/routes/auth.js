const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../db');
const { rateLimit } = require('../middleware/security');

const router = express.Router();
const otpLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 5, keyFn: (req) => `${req.ip}:${req.body?.phone || ''}` });

function signUserToken(user) {
  // Le client reste connecté jusqu'à ce qu'il se déconnecte (jeton d'un an)
  return jwt.sign({ userId: user.id, phone: user.phone, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '365d' });
}

router.post('/request-otp', otpLimit, async (req, res) => {
  const phone = String(req.body?.phone || '').trim();
  if (!/^\+?[0-9]{8,15}$/.test(phone)) return res.status(400).json({ error: 'Numéro de téléphone invalide' });
  if (!process.env.JWT_SECRET) return res.status(503).json({ error: 'Authentification non configurée' });

  const otp = String(crypto.randomInt(100000, 1000000));
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  try {
    await pool.query(`
      INSERT INTO users (phone, otp_code, otp_expires_at)
      VALUES ($1, $2, $3)
      ON CONFLICT (phone) DO UPDATE SET otp_code = EXCLUDED.otp_code, otp_expires_at = EXCLUDED.otp_expires_at
    `, [phone, otp, expiresAt]);

    // En production, brancher ici le fournisseur SMS.
    console.log(`[OTP] code généré pour ${phone}`);
    const payload = { message: 'Code envoyé' };
    if (process.env.NODE_ENV !== 'production') payload.dev_otp = otp;
    return res.json(payload);
  } catch (err) {
    console.error('request-otp:', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/verify-otp', otpLimit, async (req, res) => {
  const phone = String(req.body?.phone || '').trim();
  const code = String(req.body?.code || '').trim();
  if (!phone || !/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Numéro et code requis' });
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    const user = rows[0];
    if (!user || user.otp_code !== code || !user.otp_expires_at || new Date(user.otp_expires_at) < new Date()) {
      return res.status(401).json({ error: 'Code invalide ou expiré' });
    }
    await pool.query('UPDATE users SET phone_verified = TRUE, otp_code = NULL, otp_expires_at = NULL WHERE id = $1', [user.id]);
    const token = signUserToken(user);
    return res.json({ token, user: { id: user.id, phone: user.phone, full_name: user.full_name } });
  } catch (err) {
    console.error('verify-otp:', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Connexion simple (nom + prénom + téléphone), utilisée par l'app client tant
// qu'aucun fournisseur SMS n'est branché pour les codes OTP.
// En production, elle n'est active que si la variable ALLOW_SIMPLE_LOGIN=true existe sur Railway.
// Dès que l'envoi de SMS fonctionne, supprimer cette variable pour passer à la connexion par code.
router.post('/simple-login', async (req, res) => {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SIMPLE_LOGIN !== 'true') {
    return res.status(404).json({ error: 'Route indisponible en production' });
  }
  const { nom, prenoms, phone } = req.body || {};
  if (!nom || !prenoms || !phone) return res.status(400).json({ error: 'Nom, prénom(s) et numéro de téléphone requis' });
  const fullName = `${String(prenoms).trim()} ${String(nom).trim()}`;
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    let user = rows[0];
    if (!user) {
      user = (await pool.query(`INSERT INTO users (phone, full_name, phone_verified) VALUES ($1,$2,FALSE) RETURNING *`, [phone, fullName])).rows[0];
    } else if (!user.full_name) {
      user = (await pool.query('UPDATE users SET full_name = $1 WHERE id = $2 RETURNING *', [fullName, user.id])).rows[0];
    } else {
      // Protection minimale : un numéro déjà enregistré ne peut être utilisé qu'avec le même nom.
      const norm = (v) => String(v).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (norm(user.full_name) !== norm(fullName)) {
        return res.status(401).json({ error: 'Ce numéro est déjà associé à un autre nom. Vérifiez votre nom et vos prénoms.' });
      }
    }
    return res.json({ token: signUserToken(user), user: { id: user.id, phone: user.phone, full_name: user.full_name } });
  } catch (err) {
    console.error('simple-login:', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
