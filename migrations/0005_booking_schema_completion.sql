-- Completa campi richiesti dalle richieste ospite e registrate.
-- Alcuni ambienti avevano già applicato una prima versione ridotta della 0004.
ALTER TABLE dogs
  ADD COLUMN IF NOT EXISTS age_years smallint,
  ADD COLUMN IF NOT EXISTS age_months smallint;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS marketing_consent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS marketing_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS marketing_consent_proof varchar(120),
  ADD COLUMN IF NOT EXISTS request_key varchar(64);
CREATE UNIQUE INDEX IF NOT EXISTS appointments_request_key_unique
  ON appointments(request_key) WHERE request_key IS NOT NULL;

ALTER TABLE guest_bookings
  ADD COLUMN IF NOT EXISTS marketing_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS marketing_proof varchar(120);

ALTER TABLE guest_customers
  ADD COLUMN IF NOT EXISTS marketing_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS marketing_proof varchar(120),
  ADD COLUMN IF NOT EXISTS linked_at timestamptz;
