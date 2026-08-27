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
// GET /admin/listings?status=en_attente
// Toutes les offres, filtrables par statut (en_attente / validee / rejetee)
// ==========================================
router.get("/listings", requireAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    const query = status
      ? {
          text: `SELECT l.*, p.name AS partner_name, p.type AS partner_type
                 FROM listings l LEFT JOIN partners p ON l.partner_id = p.id
                 WHERE l.status = $1 ORDER BY l.created_at DESC`,
          values: [status],
        }
      : {
          text: `SELECT l.*, p.name AS partner_name, p.type AS partner_type
                 FROM listings l LEFT JOIN partners p ON l.partner_id = p.id
                 ORDER BY l.created_at DESC`,
        };
    const { rows } = await pool.query(query);
    res.json({ success: true, count: rows.length, listings: rows });
  } catch (error) {
    console.error("Erreur GET /admin/listings :", error.message);
    res.status(500).json({ success: false, error: "Impossible de récupérer les offres" });
  }
});

// ==========================================
// PATCH /admin/listings/:id/approve
// Valide l'offre -> elle devient visible dans l'app client
// ==========================================
router.patch("/listings/:id/approve", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "UPDATE listings SET status = 'validee', is_active = TRUE, rejection_reason = NULL WHERE id = $1 RETURNING *",
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: "Offre introuvable" });
    adminEvents.emit("listing", { id: rows[0].id, title: rows[0].title, status: "validee" });
    res.json({ success: true, listing: rows[0] });
  } catch (error) {
    console.error("Erreur PATCH /admin/listings/:id/approve :", error.message);
    res.status(500).json({ success: false, error: "Impossible de valider l'offre" });
  }
});

// ==========================================
// PATCH /admin/listings/:id/reject
// Rejette l'offre avec un motif optionnel -> reste invisible côté client
// ==========================================
router.patch("/listings/:id/reject", requireAdmin, async (req, res) => {
  try {
    const { reason } = req.body;
    const { rows } = await pool.query(
      "UPDATE listings SET status = 'rejetee', is_active = FALSE, rejection_reason = $1 WHERE id = $2 RETURNING *",
      [reason || null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: "Offre introuvable" });
    adminEvents.emit("listing", { id: rows[0].id, title: rows[0].title, status: "rejetee" });
    res.json({ success: true, listing: rows[0] });
  } catch (error) {
    console.error("Erreur PATCH /admin/listings/:id/reject :", error.message);
    res.status(500).json({ success: false, error: "Impossible de rejeter l'offre" });
  }
});

module.exports = router;
