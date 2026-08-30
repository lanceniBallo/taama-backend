const express = require("express");
const jwt = require("jsonwebtoken");
const pool = require("../db");
const adminEvents = require("../adminEvents");

const router = express.Router();

// Vérifie le token JWT du partenaire (même principe que dans partnerBookings.js).
// ⚠️ Si ton JWT partenaire utilise un nom de champ différent de "partnerId",
// ajuste la ligne req.partnerId ci-dessous en conséquence.
function requirePartnerAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Non authentifié" });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.partnerId = decoded.partnerId || decoded.id || decoded.partner_id;
    if (!req.partnerId) return res.status(401).json({ error: "Token partenaire invalide" });
    next();
  } catch {
    res.status(401).json({ error: "Token invalide" });
  }
}

// Traduit le type de partenaire (table partners) vers le type d'offre (table listings)
// Les deux tables n'utilisent pas exactement le même vocabulaire.
const PARTNER_TYPE_TO_LISTING_TYPE = {
  bus: "ticket",
  hotel: "hotel",
  airline: "airline",
  car_rental: "vehicle",
  insurance: "insurance",
  real_estate: "real_estate",
  taxi: "taxi",
};

// GET /partner/listings -> mes offres, tous statuts confondus
router.get("/listings", requirePartnerAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM listings WHERE partner_id = $1 ORDER BY created_at DESC",
      [req.partnerId]
    );
    res.json(rows);
  } catch (error) {
    console.error("Erreur GET /partner/listings :", error.message);
    res.status(500).json({ error: "Impossible de récupérer les offres" });
  }
});

// POST /partner/listings -> soumettre une nouvelle offre (part en "en_attente")
router.post("/listings", requirePartnerAuth, async (req, res) => {
  try {
    const { rows: partnerRows } = await pool.query("SELECT type FROM partners WHERE id = $1", [req.partnerId]);
    const partner = partnerRows[0];
    if (!partner) return res.status(404).json({ error: "Partenaire introuvable" });

    const listingType = PARTNER_TYPE_TO_LISTING_TYPE[partner.type] || partner.type;
    const { title, subtitle, description, price_fcfa, icon, accent_color, image_url, metadata } = req.body;

    if (!title || !price_fcfa) {
      return res.status(400).json({ error: "Le nom et le prix sont obligatoires" });
    }

    const { rows } = await pool.query(
      `INSERT INTO listings
        (partner_id, type, title, subtitle, description, price_fcfa, icon, accent_color, image_url, metadata, status, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'en_attente', FALSE)
       RETURNING *`,
      [req.partnerId, listingType, title, subtitle || null, description || null, price_fcfa, icon || null, accent_color || null, image_url || null, metadata || {}]
    );

    // Notifie le tableau de bord admin en temps réel (réutilise le flux SSE existant)
    adminEvents.emit("listing", { id: rows[0].id, title: rows[0].title });

    res.status(201).json(rows[0]);
  } catch (error) {
    console.error("Erreur POST /partner/listings :", error.message);
    res.status(500).json({ error: "Impossible de créer l'offre" });
  }
});

// PATCH /partner/listings/:id -> modifier une offre non encore validée (repasse en "en_attente")
router.patch("/listings/:id", requirePartnerAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, subtitle, description, price_fcfa, icon, accent_color, image_url, metadata } = req.body;

    const { rows: existingRows } = await pool.query(
      "SELECT * FROM listings WHERE id = $1 AND partner_id = $2",
      [id, req.partnerId]
    );
    if (!existingRows[0]) return res.status(404).json({ error: "Offre introuvable" });
    if (existingRows[0].status === "validee") {
      return res.status(400).json({ error: "Une offre déjà validée ne peut plus être modifiée directement, contacte Taama." });
    }

    const { rows } = await pool.query(
      `UPDATE listings SET
        title = COALESCE($1, title),
        subtitle = COALESCE($2, subtitle),
        description = COALESCE($3, description),
        price_fcfa = COALESCE($4, price_fcfa),
        icon = COALESCE($5, icon),
        accent_color = COALESCE($6, accent_color),
        image_url = COALESCE($7, image_url),
        metadata = COALESCE($8, metadata),
        status = 'en_attente',
        rejection_reason = NULL
      WHERE id = $9 AND partner_id = $10
      RETURNING *`,
      [title, subtitle, description, price_fcfa, icon, accent_color, image_url, metadata, id, req.partnerId]
    );

    adminEvents.emit("listing", { id: rows[0].id, title: rows[0].title });
    res.json(rows[0]);
  } catch (error) {
    console.error("Erreur PATCH /partner/listings/:id :", error.message);
    res.status(500).json({ error: "Impossible de modifier l'offre" });
  }
});

// DELETE /partner/listings/:id -> retirer une offre (uniquement si pas encore validée)
router.delete("/listings/:id", requirePartnerAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      "DELETE FROM listings WHERE id = $1 AND partner_id = $2 AND status != 'validee' RETURNING id",
      [id, req.partnerId]
    );
    if (!rows[0]) return res.status(400).json({ error: "Offre introuvable ou déjà validée (contacte Taama pour la retirer)" });
    res.json({ success: true });
  } catch (error) {
    console.error("Erreur DELETE /partner/listings/:id :", error.message);
    res.status(500).json({ error: "Impossible de retirer l'offre" });
  }
});

module.exports = router;
