-- Reuse the existing CRM contacts and Fidelity ledger; no account for walk-in customers.
ALTER TABLE loyalty_cards ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE loyalty_cards ADD COLUMN IF NOT EXISTS contact_id integer REFERENCES privacy_contacts(id);
ALTER TABLE loyalty_cards ADD COLUMN IF NOT EXISTS expiry_months integer CHECK (expiry_months BETWEEN 0 AND 120);
ALTER TABLE loyalty_cards ADD COLUMN IF NOT EXISTS merged_into_card_id integer REFERENCES loyalty_cards(id);
ALTER TABLE loyalty_cards ADD COLUMN IF NOT EXISTS claim_requested_by integer REFERENCES users(id);
ALTER TABLE loyalty_cards ADD COLUMN IF NOT EXISTS claim_requested_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_cards_contact_unique ON loyalty_cards(contact_id) WHERE contact_id IS NOT NULL;
-- New accruals default to twelve months. Existing lots keep their original expiry.
-- Keep date-specific/custom-period policies and all other settings.
UPDATE settings SET value = jsonb_set(value, '{expiryMode}', '"annuale"'), updated_at = now()
WHERE key = 'loyalty' AND value->>'expiryMode' = 'nessuna';
