require("dotenv").config();

const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const listingsRoutes = require("./routes/listings");
const bookingsRoutes = require("./routes/bookings");
const partnerAuthRoutes = require("./routes/partnerAuth");
const partnerBookingsRoutes = require("./routes/partnerBookings");
const adminPartnersRoutes = require("./routes/adminPartners");
const adminBookingsRoutes = require("./routes/adminBookings");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/auth", authRoutes);
app.use("/listings", listingsRoutes);
app.use("/bookings", bookingsRoutes);
app.use("/auth", partnerAuthRoutes);
app.use("/partner", partnerBookingsRoutes);

app.use("/admin", adminPartnersRoutes);
app.use("/admin", adminBookingsRoutes);

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

const port = process.env.PORT || 4000;

app.listen(port, () => {
  console.log(`Taama API démarrée sur le port ${port}`);
});
