-- Preserve cancelled settlements instead of deleting their accounting history.
-- No existing payment or worked-hour record is modified.
ALTER TABLE staff_settlements DROP CONSTRAINT IF EXISTS staff_settlements_status_check;
ALTER TABLE staff_settlements ADD CONSTRAINT staff_settlements_status_check
  CHECK (status IN ('da_pagare', 'pagato', 'annullata'));
CREATE UNIQUE INDEX IF NOT EXISTS staff_settlements_active_week_key
  ON staff_settlements (operator_id, week_start) WHERE status <> 'annullata';
ALTER TABLE staff_settlements
  DROP CONSTRAINT IF EXISTS staff_settlements_operator_id_week_start_key;
