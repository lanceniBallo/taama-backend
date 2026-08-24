const express = require("express");
const jwt = require("jsonwebtoken");
const pool = require("../db");
const router = express.Router();

// Génère et "envoie" un code OTP à un numéro de téléphone
router.post("/request-otp", async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: "Numéro de téléphone requis" });
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
  await pool.query(
    `INSERT INTO users (phone, otp_code, otp_expires_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (phone) DO UPDATE SET otp_code = $2, otp_expires_at = $3`,
    [phone, otp, expiresAt]
  );
  // TODO: brancher un vrai service SMS (Twilio, ou un fournisseur local) ici.
  // Pour le moment, on renvoie le code dans la réponse pour faciliter les tests.
  console.log(`[DEV] Code OTP pour ${phone} : ${otp}`);
  res.json({ message: "Code envoyé", dev_otp: otp });
});

// Vérifie le code OTP et renvoie un token de session
router.post("/verify-otp", async (req, res) => {
  const { phone, code } = req.body;
  if (!phone || !code) return res.status(400).json({ error: "Numéro et code requis" });
  const { rows } = await pool.query("SELECT * FROM users WHERE phone = $1", [phone]);
  const user = rows[0];
  if (!user || user.otp_code !== code || new Date(user.otp_expires_at) < new Date()) {
    return res.status(401).json({ error: "Code invalide ou expiré" });
  }
  await pool.query(
    "UPDATE users SET phone_verified = TRUE, otp_code = NULL WHERE id = $1",
    [user.id]
  );
  const token = jwt.sign({ userId: user.id, phone: user.phone }, process.env.JWT_SECRET, {
    expiresIn: "30d",
  });
  res.json({ token, user: { id: user.id, phone: user.phone, full_name: user.full_name } });
});

// Connexion en une étape : nom + prénom(s) + téléphone, sans code de vérification.
// Si le numéro existe déjà en base, on reconnecte le même compte (et on complète le nom
// s'il manquait). Sinon, on crée le compte directement.
router.post("/simple-login", async (req, res) => {
  const { nom, prenoms, phone } = req.body;
  if (!nom || !prenoms || !phone) {
    return res.status(400).json({ error: "Nom, prénom(s) et numéro de téléphone requis" });
  }

  const fullName = `${prenoms.trim()} ${nom.trim()}`;

  const { rows } = await pool.query("SELECT * FROM users WHERE phone = $1", [phone]);
  let user = rows[0];

  if (!user) {
    const insert = await pool.query(
      `INSERT INTO users (phone, full_name, phone_verified)
       VALUES ($1, $2, TRUE)
       RETURNING *`,
      [phone, fullName]
    );
    user = insert.rows[0];
  } else if (!user.full_name) {
    await pool.query("UPDATE users SET full_name = $1 WHERE id = $2", [fullName, user.id]);
    user.full_name = fullName;
  }

  const token = jwt.sign({ userId: user.id, phone: user.phone }, process.env.JWT_SECRET, {
    expiresIn: "365d",
  });
  res.json({ token, user: { id: user.id, phone: user.phone, full_name: user.full_name } });
});

module.exports = router;
