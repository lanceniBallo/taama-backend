-- Taama — migration revenus, commissions et retraits
-- À exécuter UNE FOIS sur PostgreSQL Railway après le schéma actuel.

ALTER TABLE partners ADD COLUMN IF NOT EXISTS access_code_hash TEXT UNIQUE;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS sector VARCHAR(30);
UPDATE partners SET sector = COALESCE(sector, type);

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS commission_fcfa INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS partner_amount_fcfa INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS refund_fcfa INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS partner_withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  amount_fcfa INTEGER NOT NULL CHECK (amount_fcfa > 0),
  method VARCHAR(40) NOT NULL,
  account_reference VARCHAR(150) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'En attente' CHECK (status IN ('En attente','Payé','Rejeté')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS financial_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  partner_id UUID REFERENCES partners(id) ON DELETE SET NULL,
  kind VARCHAR(30) NOT NULL,
  amount_fcfa INTEGER NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_partner ON partner_withdrawals(partner_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON partner_withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_ledger_partner ON financial_ledger(partner_id);
CREATE INDEX IF NOT EXISTS idx_ledger_kind ON financial_ledger(kind);

-- Barèmes par défaut :
-- hotel 12%, ticket/bus 8%, flight 5%, vehicle 10%, insurance 15%, apartment/real_estate 10%.
