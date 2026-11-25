-- Tempo effettivamente impiegato: distinto dalla durata prevista dello slot.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS actual_duration_min integer
  CHECK (actual_duration_min BETWEEN 1 AND 600);
ALTER TABLE guest_bookings ADD COLUMN IF NOT EXISTS actual_duration_min integer
  CHECK (actual_duration_min BETWEEN 1 AND 600);
CREATE INDEX IF NOT EXISTS appointments_treatment_duration_history
  ON appointments (customer_id, dog_id, start_at DESC) WHERE actual_duration_min IS NOT NULL;
CREATE INDEX IF NOT EXISTS guest_bookings_treatment_duration_history
  ON guest_bookings (guest_customer_id, guest_dog_id, start_at DESC) WHERE actual_duration_min IS NOT NULL;
