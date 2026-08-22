-- Migration : ajout du système partenaire
-- À exécuter sur ta base PostgreSQL Railway (via `psql` ou l'onglet Query de Railway)

-- Table des partenaires (agences de bus, hôtels, loueurs de véhicules, assurances...)
CREATE TABLE IF NOT EXISTS partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sector TEXT NOT NULL,              -- 'ticket', 'hotel', 'vehicle', 'insurance'
  access_code_hash TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Relie chaque offre (listing) à son partenaire (la colonne existe déjà dans listings)
ALTER TABLE listings
  DROP CONSTRAINT IF EXISTS fk_listings_partner;

ALTER TABLE listings
  ADD CONSTRAINT fk_listings_partner
  FOREIGN KEY (partner_id) REFERENCES partners(id)
  ON DELETE SET NULL;

-- S'assure que bookings a bien une colonne status (probablement déjà présente)
-- Décommente si besoin :
-- ALTER TABLE bookings ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
