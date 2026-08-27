-- =====================================================================
-- Taama — Système de disponibilité et de verrouillage temporaire
-- PostgreSQL (compatible Railway)
-- =====================================================================
-- À adapter : remplacez les références à `partners(id)` et `bookings(id)`
-- par vos tables existantes si les noms diffèrent dans taama-backend.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- pour gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "btree_gist"; -- pour l'exclusion sur plages de dates

-- ---------------------------------------------------------------------
-- 1. INVENTORY — l'unité vendable (chambre, siège, véhicule, créneau)
-- ---------------------------------------------------------------------
CREATE TABLE inventory (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id  UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN (
                'hotel_room', 'apartment', 'bus_seat',
                'flight_seat', 'vehicle', 'service_slot'
              )),
  label       TEXT NOT NULL,            -- ex: "Chambre 101", "Siège 12A"
  capacity    INTEGER NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_inventory_partner_type ON inventory (partner_id, type);

-- ---------------------------------------------------------------------
-- 2a. AVAILABILITY_RANGE — pour les unités réservées par plage de dates
--     (hôtel, appartement)
-- ---------------------------------------------------------------------
CREATE TABLE availability_range (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id  UUID NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
  period        DATERANGE NOT NULL,     -- ex: '[2026-09-10, 2026-09-15)'
  status        TEXT NOT NULL DEFAULT 'available'
                CHECK (status IN ('available', 'locked', 'booked', 'blocked')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Empêche deux plages qui se chevauchent d'être verrouillées/réservées
  -- en même temps sur la même unité — géré par la base, pas l'application.
  EXCLUDE USING GIST (inventory_id WITH =, period WITH &&)
    WHERE (status IN ('locked', 'booked'))
);

CREATE INDEX idx_availrange_inventory ON availability_range (inventory_id, status);

-- ---------------------------------------------------------------------
-- 2b. AVAILABILITY_SLOT — pour les unités réservées par créneau atomique
--     (bus, avion, véhicule, service)
-- ---------------------------------------------------------------------
CREATE TABLE availability_slot (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id   UUID NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
  slot_datetime  TIMESTAMPTZ NOT NULL,   -- ex: départ du bus, date du service
  status         TEXT NOT NULL DEFAULT 'available'
                 CHECK (status IN ('available', 'locked', 'booked', 'blocked')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (inventory_id, slot_datetime)
);

CREATE INDEX idx_availslot_inventory ON availability_slot (inventory_id, status);

-- ---------------------------------------------------------------------
-- 3. RESERVATION_LOCK — le verrou temporaire pendant le paiement
-- ---------------------------------------------------------------------
CREATE TABLE reservation_lock (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL,
  inventory_id           UUID NOT NULL REFERENCES inventory(id),
  availability_range_id  UUID REFERENCES availability_range(id),
  availability_slot_id   UUID REFERENCES availability_slot(id),
  status                 TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'converted', 'expired', 'released')),
  expires_at             TIMESTAMPTZ NOT NULL,   -- ex: now() + interval '12 minutes'
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Un verrou porte soit sur une plage, soit sur un créneau — jamais les deux
  CHECK (
    (availability_range_id IS NOT NULL AND availability_slot_id IS NULL) OR
    (availability_range_id IS NULL AND availability_slot_id IS NOT NULL)
  )
);

-- Index utilisé par le job de purge des verrous expirés
CREATE INDEX idx_reslock_expiring ON reservation_lock (expires_at)
  WHERE status = 'active';

-- ---------------------------------------------------------------------
-- 4. Lien vers la table bookings existante
-- ---------------------------------------------------------------------
ALTER TABLE bookings
  ADD COLUMN reservation_lock_id UUID REFERENCES reservation_lock(id);

-- =====================================================================
-- FLUX D'UTILISATION
-- =====================================================================

-- --- A. Poser un verrou (le client entre en paiement) ------------------
-- Tout se fait dans UNE transaction, avec verrouillage de ligne pour
-- empêcher deux requêtes concurrentes de verrouiller la même unité.

-- Cas hôtel/appartement (plage de dates) :
--
-- BEGIN;
--   SELECT id FROM availability_range
--     WHERE inventory_id = :inventory_id
--       AND period && :requested_period
--       AND status = 'available'
--     FOR UPDATE;
--   -- si trouvé :
--   UPDATE availability_range SET status = 'locked' WHERE id = :range_id;
--   INSERT INTO reservation_lock
--     (user_id, inventory_id, availability_range_id, expires_at)
--     VALUES (:user_id, :inventory_id, :range_id, now() + interval '12 minutes');
-- COMMIT;

-- Cas bus/avion/véhicule/créneau (unité atomique) :
--
-- BEGIN;
--   SELECT id FROM availability_slot
--     WHERE inventory_id = :inventory_id
--       AND slot_datetime = :slot_datetime
--       AND status = 'available'
--     FOR UPDATE;
--   UPDATE availability_slot SET status = 'locked' WHERE id = :slot_id;
--   INSERT INTO reservation_lock
--     (user_id, inventory_id, availability_slot_id, expires_at)
--     VALUES (:user_id, :inventory_id, :slot_id, now() + interval '12 minutes');
-- COMMIT;

-- --- B. Le paiement réussit (webhook) -----------------------------------
--
-- BEGIN;
--   UPDATE reservation_lock SET status = 'converted' WHERE id = :lock_id;
--   UPDATE availability_range SET status = 'booked'
--     WHERE id = (SELECT availability_range_id FROM reservation_lock WHERE id = :lock_id);
--   -- (ou availability_slot selon le cas)
--   UPDATE bookings SET reservation_lock_id = :lock_id WHERE id = :booking_id;
-- COMMIT;

-- --- C. Le paiement échoue ou le verrou expire (job planifié) ----------
-- À exécuter toutes les 1-2 minutes (cron Railway ou job planifié) :
--
-- BEGIN;
--   UPDATE reservation_lock SET status = 'expired'
--     WHERE status = 'active' AND expires_at < now();
--
--   UPDATE availability_range SET status = 'available'
--     WHERE id IN (
--       SELECT availability_range_id FROM reservation_lock
--       WHERE status = 'expired' AND availability_range_id IS NOT NULL
--     );
--
--   UPDATE availability_slot SET status = 'available'
--     WHERE id IN (
--       SELECT availability_slot_id FROM reservation_lock
--       WHERE status = 'expired' AND availability_slot_id IS NOT NULL
--     );
-- COMMIT;
