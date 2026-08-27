const express = require("express");
const jwt = require("jsonwebtoken");
const pool = require("../db");
const adminEvents = require("../adminEvents");

const router = express.Router();

// Middleware simple : vérifie le token JWT et attache l'utilisateur à la requête
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Non authentifié" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Token invalide" });
  }
}

// GET /bookings -> mes réservations (utilisateur connecté)
router.get("/", requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT b.*, l.title, l.subtitle, l.icon, l.accent_color
     FROM bookings b JOIN listings l ON l.id = b.listing_id
     WHERE b.user_id = $1 ORDER BY b.created_at DESC`,
    [req.user.userId]
  );
  res.json(rows);
});

// POST /bookings -> créer une réservation pour une offre
router.post("/", requireAuth, async (req, res) => {
  const {
    listing_id, payment_method,
    passenger_name, passenger_document,
    contact_phone, contact_email, options,
  } = req.body;
  const { rows: listingRows } = await pool.query("SELECT * FROM listings WHERE id = $1", [listing_id]);
  const listing = listingRows[0];
  if (!listing) return res.status(404).json({ error: "Offre introuvable" });
  const reference = "TM-" + Math.random().toString(36).slice(2, 8).toUpperCase();
  // Pour le MVP : statut "En attente" tant que le paiement Mobile Money
  // n'est pas confirmé par le fournisseur (webhook à brancher plus tard).
  const { rows } = await pool.query(
    `INSERT INTO bookings (reference, user_id, listing_id, status, price_fcfa, payment_method, passenger_name, passenger_document, contact_phone, contact_email, options)
     VALUES ($1,$2,$3,'En attente',$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [reference, req.user.userId, listing_id, listing.price_fcfa, payment_method || "manuel", passenger_name || null, passenger_document || null, contact_phone || null, contact_email || null, options || {}]
  );

  // Notifie le tableau de bord admin en temps réel (aucun impact sur la réponse envoyée au client)
  adminEvents.emit("booking", { id: rows[0].id, reference: rows[0].reference });

  res.status(201).json(rows[0]);
});

// PATCH /bookings/:id/confirm -> à appeler depuis le webhook du fournisseur de paiement
router.patch("/:id/confirm", async (req, res) => {
  const { rows } = await pool.query(
    "UPDATE bookings SET status = 'Confirmé', payment_status = 'payé' WHERE id = $1 RETURNING *",
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Réservation introuvable" });

  // Le statut a changé -> l'admin doit aussi être notifié
  adminEvents.emit("booking", { id: rows[0].id, reference: rows[0].reference });

  res.json(rows[0]);
});

module.exports = router;
