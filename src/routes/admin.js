const express = require("express");
const pool = require("../db");
const adminEvents = require("../adminEvents");

const router = express.Router();

function requireAdmin(req, res, next) {
  const key = req.headers["x-admin-key"];
  if (!key || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: "Non autorisé" });
  }
  next();
}

// ==========================================
// GET /admin/events
// Flux temps réel (Server-Sent Events) pour le tableau de bord admin.
// Note : EventSource ne permet pas d'envoyer de headers personnalisés,
// donc la clé admin est passée en query param pour cette route uniquement.
// ==========================================
router.get("/events", (req, res) => {
  const key = req.query.key;
  if (!key || key !== process.env.ADMIN_KEY) {
    return res.status(401).end();
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });
  res.write("retry: 5000\n\n");

  const onBooking = (payload) => {
    res.write(`event: booking\ndata: ${JSON.stringify(payload)}\n\n`);
  };
  adminEvents.on("booking", onBooking);

  // Garde la connexion ouverte à travers les proxys/timeouts
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    adminEvents.off("booking", onBooking);
  });
});

// ==========================================
// GET /admin/bookings
// Toutes les réservations, tous services confondus
// ==========================================
router.get("/bookings", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        b.id,
        b.reference,
        b.status,
        b.price_fcfa,
        b.payment_method,
        b.payment_status,
        b.created_at,

        b.passenger_name,
        b.passenger_document,
        b.contact_phone,
        b.contact_email,
        b.options,

        u.id AS user_id,
        u.full_name AS user_name,
        u.email AS user_email,

        l.id AS listing_id,
        l.type AS listing_type,
        l.title AS listing_title,
        l.subtitle AS listing_subtitle,

        p.id AS partner_id,
        p.name AS partner_name,
        p.type AS partner_type

      FROM bookings b
      LEFT JOIN users u ON b.user_id = u.id
      LEFT JOIN listings l ON b.listing_id = l.id
      LEFT JOIN partners p ON l.partner_id = p.id
      ORDER BY b.created_at DESC
    `);

    res.json({
      success: true,
      count: result.rows.length,
      bookings: result.rows,
    });
  } catch (error) {
    console.error("Erreur GET /admin/bookings :", error.message);
    res.status(500).json({ success: false, error: "Impossible de récupérer les réservations" });
  }
});

// ==========================================
// GET /admin/bookings/:id
// ==========================================
router.get("/bookings/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT
        b.*,
        u.full_name AS user_name,
        u.email AS user_email,
        l.type AS listing_type,
        l.title AS listing_title,
        l.subtitle AS listing_subtitle,
        p.name AS partner_name,
        p.type AS partner_type
      FROM bookings b
      LEFT JOIN users u ON b.user_id = u.id
      LEFT JOIN listings l ON b.listing_id = l.id
      LEFT JOIN partners p ON l.partner_id = p.id
      WHERE b.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Réservation introuvable" });
    }
    res.json({ success: true, booking: result.rows[0] });
  } catch (error) {
    console.error("Erreur GET /admin/bookings/:id :", error.message);
    res.status(500).json({ success: false, error: "Impossible de récupérer la réservation" });
  }
});

// ==========================================
// PUT /admin/bookings/:id/status
// ==========================================
router.put("/bookings/:id/status", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const allowedStatuses = ["Confirmé", "En attente", "Annulé", "Rejeté"];

    if (!status) {
      return res.status(400).json({ success: false, error: "Le statut est obligatoire" });
    }
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: "Statut invalide", allowedStatuses });
    }

    const result = await pool.query(
      "UPDATE bookings SET status = $1 WHERE id = $2 RETURNING *",
      [status, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Réservation introuvable" });
    }
    res.json({ success: true, message: "Statut de la réservation mis à jour", booking: result.rows[0] });
  } catch (error) {
    console.error("Erreur PUT /admin/bookings/:id/status :", error.message);
    res.status(500).json({ success: false, error: "Impossible de modifier le statut" });
  }
});

// ==========================================
// PUT /admin/bookings/:id/payment
// ==========================================
router.put("/bookings/:id/payment", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { payment_status } = req.body;
    const allowedPaymentStatuses = ["en_attente", "payé", "échoué"];

    if (!payment_status) {
      return res.status(400).json({ success: false, error: "payment_status est obligatoire" });
    }
    if (!allowedPaymentStatuses.includes(payment_status)) {
      return res.status(400).json({ success: false, error: "Statut de paiement invalide", allowedPaymentStatuses });
    }

    const result = await pool.query(
      "UPDATE bookings SET payment_status = $1 WHERE id = $2 RETURNING *",
      [payment_status, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Réservation introuvable" });
    }
    res.json({ success: true, message: "Statut du paiement mis à jour", booking: result.rows[0] });
  } catch (error) {
    console.error("Erreur PUT /admin/bookings/:id/payment :", error.message);
    res.status(500).json({ success: false, error: "Impossible de modifier le paiement" });
  }
});

module.exports = router;
