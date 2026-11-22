-- Registro minimale delle scelte cookie: nessun IP, user agent o collegamento account.
CREATE TABLE IF NOT EXISTS cookie_choices (
  id bigserial PRIMARY KEY,
  receipt_id uuid NOT NULL,
  version varchar(80) NOT NULL,
  analytics boolean NOT NULL DEFAULT false,
  marketing boolean NOT NULL DEFAULT false,
  external_content boolean NOT NULL DEFAULT false,
  action varchar(20) NOT NULL CHECK(action IN ('accept','reject','customize')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cookie_choices_created ON cookie_choices(created_at);
