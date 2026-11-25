-- Catalogo listino amministrabile: estensione additiva per conservare lo storico.
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS pricing_type varchar(20) NOT NULL DEFAULT 'da',
  ADD COLUMN IF NOT EXISTS price_max_cents integer,
  ADD COLUMN IF NOT EXISTS species varchar(12) NOT NULL DEFAULT 'cane',
  ADD COLUMN IF NOT EXISTS image_url text;
UPDATE services SET pricing_type = CASE WHEN price_from THEN 'da' ELSE 'fisso' END
WHERE pricing_type = 'da';
ALTER TABLE dogs ADD COLUMN IF NOT EXISTS species varchar(12) NOT NULL DEFAULT 'cane';
ALTER TABLE guest_dogs ADD COLUMN IF NOT EXISTS species varchar(12) NOT NULL DEFAULT 'cane';

ALTER TABLE service_supplements
  ADD COLUMN IF NOT EXISTS pricing_type varchar(20) NOT NULL DEFAULT 'fisso',
  ADD COLUMN IF NOT EXISTS percentage_basis_points integer,
  ADD COLUMN IF NOT EXISTS condition_label varchar(80),
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS requires_confirmation boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS service_categories (
  id serial PRIMARY KEY,
  name varchar(80) NOT NULL UNIQUE,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  visible boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS service_pricing_rules (
  id serial PRIMARY KEY,
  service_id integer NOT NULL REFERENCES services(id),
  size varchar(10),
  coat_type varchar(40),
  coat_length varchar(20),
  pricing_type varchar(20) NOT NULL DEFAULT 'fisso',
  price_cents integer,
  price_max_cents integer,
  percentage_basis_points integer,
  duration_min integer,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  CHECK (price_cents IS NULL OR price_cents >= 0),
  CHECK (price_max_cents IS NULL OR price_max_cents >= 0),
  CHECK (duration_min IS NULL OR duration_min > 0)
);
CREATE INDEX IF NOT EXISTS service_pricing_rules_service_idx ON service_pricing_rules(service_id, active, sort_order);
CREATE INDEX IF NOT EXISTS service_categories_order_idx ON service_categories(active, sort_order);

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS service_price_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE guest_bookings
  ADD COLUMN IF NOT EXISTS service_price_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS estimated_price_cents integer,
  ADD COLUMN IF NOT EXISTS final_price_cents integer;
