-- Taama — migration de préparation production
-- À exécuter après schema.sql + schema_partners.sql + migration_revenus_taama.sql.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Harmonisation des secteurs/types supportés par le frontend et le moteur de commissions.
ALTER TABLE partners DROP CONSTRAINT IF EXISTS partners_type_check;
ALTER TABLE partners DROP CONSTRAINT IF EXISTS partners_sector_check;
ALTER TABLE partners ADD CONSTRAINT partners_type_check CHECK (type IN ('hotel','ticket','bus','flight','vehicle','car_rental','insurance','apartment','real_estate'));

ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_type_check;
ALTER TABLE listings ADD CONSTRAINT listings_type_check CHECK (type IN ('hotel','ticket','bus','flight','vehicle','car_rental','insurance','apartment','real_estate'));

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check CHECK (status IN ('Confirmé','En attente','Rejeté','Annulé'));

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_payment_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_payment_status_check CHECK (payment_status IN ('en_attente','payé','échoué','remboursé'));

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_provider VARCHAR(40);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(150);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS refund_status VARCHAR(30) DEFAULT 'aucun';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS ux_bookings_payment_reference ON bookings(payment_reference) WHERE payment_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_payment_status ON bookings(payment_status);
CREATE INDEX IF NOT EXISTS idx_bookings_partner_listing ON listings(partner_id);

-- OTP : expiration explicite et nettoyage des codes existants.
UPDATE users SET otp_code=NULL, otp_expires_at=NULL WHERE otp_expires_at IS NOT NULL AND otp_expires_at < now();

-- Empêche les montants financiers négatifs sur les réservations.
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_price_nonnegative;
ALTER TABLE bookings ADD CONSTRAINT bookings_price_nonnegative CHECK (price_fcfa >= 0);
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_commission_nonnegative;
ALTER TABLE bookings ADD CONSTRAINT bookings_commission_nonnegative CHECK (commission_fcfa >= 0);
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_partner_amount_nonnegative;
ALTER TABLE bookings ADD CONSTRAINT bookings_partner_amount_nonnegative CHECK (partner_amount_fcfa >= 0);
