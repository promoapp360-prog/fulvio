-- Ripristino additivo: il registro può indicare 0007 come applicata anche
-- quando queste colonne non sono più presenti nello schema effettivo.
-- Non rieseguire 0007: contiene anche aggiornamenti al listino.
ALTER TABLE dogs
  ADD COLUMN IF NOT EXISTS species varchar(12) NOT NULL DEFAULT 'cane';

ALTER TABLE guest_dogs
  ADD COLUMN IF NOT EXISTS species varchar(12) NOT NULL DEFAULT 'cane';

ALTER TABLE guest_bookings
  ADD COLUMN IF NOT EXISTS estimated_price_cents integer;
