-- Additive follow-up fields for catalog conditions and confirmed guest-request price.
ALTER TABLE service_supplements
  ADD COLUMN IF NOT EXISTS condition_label varchar(80),
  ADD COLUMN IF NOT EXISTS description text;

ALTER TABLE guest_bookings
  ADD COLUMN IF NOT EXISTS final_price_cents integer;
