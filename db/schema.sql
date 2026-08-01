-- Schéma de base de données Taama
-- À exécuter sur une base PostgreSQL vide : psql -d taama -f schema.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- pour gen_random_uuid()

-- Utilisateurs
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(20) UNIQUE NOT NULL,
  full_name VARCHAR(150),
  email VARCHAR(150),
  otp_code VARCHAR(6),          -- code OTP temporaire (à effacer après usage)
  otp_expires_at TIMESTAMPTZ,
  phone_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Partenaires (hôtels, compagnies de bus, loueurs, assureurs)
CREATE TABLE partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(150) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('hotel', 'ticket', 'vehicle', 'insurance')),
  phone VARCHAR(20),
  city VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Offres (chambres, trajets, véhicules, formules d'assurance)
CREATE TABLE listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID REFERENCES partners(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('hotel', 'ticket', 'vehicle', 'insurance')),
  title VARCHAR(200) NOT NULL,
  subtitle VARCHAR(200),
  description TEXT,
  price_fcfa INTEGER NOT NULL,
  icon VARCHAR(10),
  accent_color VARCHAR(10),
  image_url TEXT,
  -- champs spécifiques selon le type (dates, trajet, nb de places, etc.)
  metadata JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Réservations
CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference VARCHAR(20) UNIQUE NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  listing_id UUID REFERENCES listings(id),
  status VARCHAR(20) NOT NULL DEFAULT 'En attente' CHECK (status IN ('Confirmé', 'En attente', 'Annulé')),
  price_fcfa INTEGER NOT NULL,
  payment_method VARCHAR(20), -- 'orange_money', 'moov_money', 'manuel'
  payment_status VARCHAR(20) DEFAULT 'en_attente' CHECK (payment_status IN ('en_attente', 'payé', 'échoué')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_listings_type ON listings(type) WHERE is_active = TRUE;
CREATE INDEX idx_bookings_user ON bookings(user_id);
