const express = require("express");
const { Pool } = require("pg");

const router = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// Vérification admin
function adminAuth(req, res, next) {
  const key = req.headers["x-admin-key"];

  if (!process.env.ADMIN_KEY) {
    return res.status(500).json({
      error: "ADMIN_KEY non configurée",
    });
  }

  if (!key || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({
      error: "Accès administrateur refusé",
    });
  }

  next();
}

// GET /admin/bookings
// Retourne toutes les réservations Taama
router.get("/", adminAuth, async (req, res) => {
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

        l.id AS listing_id,
        l.type AS listing_type,
        l.title AS listing_title,
        l.subtitle AS listing_subtitle,

        p.id AS partner_id,
        p.name AS partner_name,
        p.type AS partner_type,
        p.city AS partner_city

      FROM bookings b

      LEFT JOIN listings l
        ON l.id = b.listing_id

      LEFT JOIN partners p
        ON p.id = l.partner_id

      ORDER BY b.created_at DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Erreur admin bookings:", error);

    res.status(500).json({
      error: "Impossible de récupérer les réservations",
    });
  }
});

module.exports = router;
