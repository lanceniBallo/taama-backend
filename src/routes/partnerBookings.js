const express = require("express");
const pool = require("../db"); // ⚠️ adapte ce chemin si besoin
const requirePartner = require("../middleware/requirePartner");

const router = express.Router();

// GET /partner/bookings — réservations liées aux offres de ce partenaire
router.get("/bookings", requirePartner, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.*
       FROM bookings b
       JOIN listings l ON l.id = b.listing_id
       WHERE l.partner_id = $1
       ORDER BY b.created_at DESC`,
      [req.partnerId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Erreur GET /partner/bookings:", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// PATCH /partner/bookings/:id/confirm
router.patch("/bookings/:id/confirm", requirePartner, (req, res) =>
  updateBookingStatus(req, res, "confirmed")
);

// PATCH /partner/bookings/:id/reject
router.patch("/bookings/:id/reject", requirePartner, (req, res) =>
  updateBookingStatus(req, res, "rejected")
);

async function updateBookingStatus(req, res, status) {
  try {
    // Vérifie que la réservation appartient bien à une offre de ce partenaire
    const check = await pool.query(
      `SELECT b.id FROM bookings b
       JOIN listings l ON l.id = b.listing_id
       WHERE b.id = $1 AND l.partner_id = $2`,
      [req.params.id, req.partnerId]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ error: "Réservation introuvable pour ce partenaire" });
    }

    const result = await pool.query(
      "UPDATE bookings SET status = $1 WHERE id = $2 RETURNING *",
      [status, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Erreur update booking:", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
}

module.exports = router;
