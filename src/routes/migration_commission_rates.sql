-- Migration : taux de commission Taama par type de service
-- À exécuter une seule fois sur la base de données (via l'onglet Query de Railway,
-- ou psql connecté à DATABASE_URL)

CREATE TABLE IF NOT EXISTS commission_rates (
  type VARCHAR(20) PRIMARY KEY,
  rate_percent NUMERIC(5,2) NOT NULL DEFAULT 10.00,
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO commission_rates (type, rate_percent) VALUES
  ('hotel', 10.00),
  ('ticket', 10.00),
  ('vehicle', 10.00),
  ('insurance', 10.00)
ON CONFLICT (type) DO NOTHING;
