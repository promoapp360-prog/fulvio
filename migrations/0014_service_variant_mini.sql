-- Align the existing variant constraint with the five sizes already used by
-- the catalog, animal profiles and booking UI. No prices or records are changed.
ALTER TABLE service_variants
  DROP CONSTRAINT IF EXISTS service_variants_size_check;
ALTER TABLE service_variants
  ADD CONSTRAINT service_variants_size_check
  CHECK (size IN ('mini', 'piccola', 'media', 'grande', 'gigante'));
