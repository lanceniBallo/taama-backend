require("dotenv").config();
const express = require("express");
const cors = require("cors");
const authRoutes = require("./routes/auth");
const listingsRoutes = require("./routes/listings");
const bookingsRoutes = require("./routes/bookings");
const reservationLockRoutes = require("./routes/reservationLock").router;
const releaseExpiredLocks = require("./routes/reservationLock").releaseExpiredLocks;
const cron = require("node-cron");
const partnerAuthRoutes = require("./routes/partnerAuth");
const partnerBookingsRoutes = require("./routes/partnerBookings");
const partnerWithdrawalsRoutes = require("./routes/partnerWithdrawals");
const partnerListingsRoutes = require("./routes/partnerListings");
const adminPartnersRoutes = require("./routes/adminPartners");
const adminBookingsRoutes = require("./routes/adminBookings");
const adminSettingsRoutes = require("./routes/adminSettings");
const adminFinancesRoutes = require("./routes/adminFinances");
const adminListingsRoutes = require("./routes/adminListings");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes publiques
app.use("/auth", authRoutes);
app.use("/listings", listingsRoutes);
app.use("/bookings", bookingsRoutes);
app.use("/reservations", reservationLockRoutes);

// Routes partenaires
app.use("/auth", partnerAuthRoutes);
app.use("/partner", partnerBookingsRoutes);
app.use("/partner", partnerWithdrawalsRoutes);
app.use("/partner", partnerListingsRoutes);

// Routes administration
app.use("/admin", adminPartnersRoutes);
app.use("/admin", adminBookingsRoutes);
app.use("/admin", adminSettingsRoutes);
app.use("/admin", adminFinancesRoutes);
app.use("/admin", adminListingsRoutes);

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "taama-backend",
  });
});

// Purge des verrous de réservation expirés, toutes les 2 minutes
cron.schedule("*/2 * * * *", releaseExpiredLocks);
console.log("Purge des verrous expirés planifiée (toutes les 2 min)");

// Serveur
const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Taama API démarrée sur le port ${port}`);
});
