// Petit bus d'événements interne au serveur.
// Sert à notifier le tableau de bord admin en temps réel
// (nouvelle réservation, etc.) sans base de données ni dépendance externe.
const { EventEmitter } = require("events");

const adminEvents = new EventEmitter();
adminEvents.setMaxListeners(50); // plusieurs onglets admin ouverts en même temps possible

module.exports = adminEvents;
