const express = require("express");
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");

const router = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

/**
 * Authentification partenaire
 *
 * Le frontend envoie :
 * Authorization: Bearer <token>
 */
function partnerAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Token partenaire manquant",
      });
    }

    const token = authHeader.split(" ")[1];

    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET n'est pas configuré");
      return res.status(500).json({
        error: "Configuration serveur incomplète",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    /*
     * On accepte plusieurs noms possibles pour l'identifiant
     * afin de rester compatible avec ton partnerAuth actuel.
     */
    const partnerId =
      decoded.partnerId ||
      decoded.partner_id ||
      decoded.id ||
      decoded.sub;

    if (!partnerId) {
      return res.status(401).json({
        error: "Token partenaire invalide",
      });
    }

    req.partnerId = partnerId;
    req.partner = decoded;

    next();
  } catch (error) {
    console.error("Erreur authentification partenaire:", error.message);

    return res.status(401).json({
      error: "Session partenaire invalide ou expirée",
    });
  }
}

/**
 * GET /partner/bookings
 *
 * Retourne uniquement les réservations concernant
 * les listings appartenant au partenaire connecté.
 */
router.get("/bookings", partnerAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `
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
        l.description AS listing_description,
        l.icon AS listing_icon,
        l.accent_color AS listing_accent_color,
        l.image_url AS listing_image_url,
        l.metadata AS listing_metadata,

        p.id AS partner_id,
        p.name AS partner_name,
        p.type AS partner_type,
        p.phone AS partner_phone,
        p.city AS partner_city

      FROM bookings b

      INNER JOIN listings l
        ON l.id = b.listing_id

      INNER JOIN partners p
        ON p.id = l.partner_id

      WHERE p.id = $1
        AND p.is_active = true

      ORDER BY b.created_at DESC
      `,
      [req.partnerId]
    );

    return res.json(result.rows);
  } catch (error) {
    console.error("Erreur GET /partner/bookings:", error);

    return res.status(500).json({
      error: "Impossible de récupérer les réservations",
    });
  }
});

/**
 * PATCH /partner/bookings/:id/confirm
 *
 * Confirme une réservation appartenant au partenaire connecté.
 */
router.patch("/bookings/:id/confirm", partnerAuth, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const bookingResult = await client.query(
      `
      SELECT
        b.id,
        b.status,
        b.payment_status,
        l.partner_id
      FROM bookings b
      INNER JOIN listings l
        ON l.id = b.listing_id
      WHERE b.id = $1
        AND l.partner_id = $2
      FOR UPDATE
      `,
      [req.params.id, req.partnerId]
    );

    if (bookingResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error: "Réservation introuvable",
      });
    }

    const booking = bookingResult.rows[0];

    if (
      booking.status === "Rejeté" ||
      booking.status === "rejected" ||
      booking.status === "Annulé" ||
      booking.status === "cancelled"
    ) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error: "Cette réservation ne peut plus être confirmée",
      });
    }

    const updated = await client.query(
      `
      UPDATE bookings
      SET
        status = 'Confirmé'
      WHERE id = $1
        AND listing_id IN (
          SELECT id
          FROM listings
          WHERE partner_id = $2
        )
      RETURNING
        id,
        reference,
        status,
        price_fcfa,
        payment_method,
        payment_status,
        created_at,
        passenger_name,
        passenger_document,
        contact_phone,
        contact_email,
        options
      `,
      [req.params.id, req.partnerId]
    );

    await client.query("COMMIT");

    return res.json({
      success: true,
      message: "Réservation confirmée",
      booking: updated.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Erreur confirmation réservation:", error);

    return res.status(500).json({
      error: "Impossible de confirmer la réservation",
    });
  } finally {
    client.release();
  }
});

/**
 * PATCH /partner/bookings/:id/reject
 *
 * Refuse une réservation appartenant au partenaire connecté.
 */
router.patch("/bookings/:id/reject", partnerAuth, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const bookingResult = await client.query(
      `
      SELECT
        b.id,
        b.status,
        b.payment_status,
        l.partner_id
      FROM bookings b
      INNER JOIN listings l
        ON l.id = b.listing_id
      WHERE b.id = $1
        AND l.partner_id = $2
      FOR UPDATE
      `,
      [req.params.id, req.partnerId]
    );

    if (bookingResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error: "Réservation introuvable",
      });
    }

    const booking = bookingResult.rows[0];

    if (
      booking.status === "Confirmé" ||
      booking.status === "confirmed" ||
      booking.status === "Annulé" ||
      booking.status === "cancelled"
    ) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error: "Cette réservation ne peut plus être refusée",
      });
    }

    const updated = await client.query(
      `
      UPDATE bookings
      SET
        status = 'Rejeté'
      WHERE id = $1
        AND listing_id IN (
          SELECT id
          FROM listings
          WHERE partner_id = $2
        )
      RETURNING
        id,
        reference,
        status,
        price_fcfa,
        payment_method,
        payment_status,
        created_at,
        passenger_name,
        passenger_document,
        contact_phone,
        contact_email,
        options
      `,
      [req.params.id, req.partnerId]
    );

    await client.query("COMMIT");

    return res.json({
      success: true,
      message: "Réservation refusée",
      booking: updated.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Erreur refus réservation:", error);

    return res.status(500).json({
      error: "Impossible de refuser la réservation",
    });
  } finally {
    client.release();
  }
});

module.exports = router;
