ALTER TABLE users ADD COLUMN IF NOT EXISTS push_offered_at timestamptz;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reserved_operator_id integer REFERENCES operators(id);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS coat_knots_today boolean NOT NULL DEFAULT false;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS coat_shedding_today boolean NOT NULL DEFAULT false;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS duration_needs_review boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS appointments_reserved_operator_idx
  ON appointments(reserved_operator_id, start_at, end_at) WHERE reserved_operator_id IS NOT NULL;
-- Il taglio unghie dura cinque minuti. Non vengono modificati prezzi o appuntamenti esistenti.
UPDATE services SET duration_min = 5 WHERE slug = 'taglio-unghie';
UPDATE service_variants SET duration_min = 5 WHERE service_id IN (SELECT id FROM services WHERE slug = 'taglio-unghie');
UPDATE service_pricing_rules SET duration_min = 5 WHERE service_id IN (SELECT id FROM services WHERE slug = 'taglio-unghie');
