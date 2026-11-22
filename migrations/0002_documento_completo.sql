-- Dog's Planet – migrazione 0002: funzioni dei punti 14-35 del documento di progetto

-- ---------- utenti, ruoli, sicurezza ----------
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
UPDATE users SET role = 'manager' WHERE role = 'staff';
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','manager','operator','customer'));
ALTER TABLE users
  ADD COLUMN username varchar(60),
  ADD COLUMN must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN failed_logins integer NOT NULL DEFAULT 0,
  ADD COLUMN locked_until timestamptz,
  ADD COLUMN session_version integer NOT NULL DEFAULT 1,
  ADD COLUMN email_verified_at timestamptz,
  ADD COLUMN email_verify_token varchar(128),
  ADD COLUMN comm_recall boolean NOT NULL DEFAULT true,
  ADD COLUMN unsubscribe_token varchar(64);
CREATE UNIQUE INDEX users_username_uq ON users (lower(username)) WHERE username IS NOT NULL;
UPDATE users SET unsubscribe_token = md5(random()::text || id::text) WHERE unsubscribe_token IS NULL;
CREATE UNIQUE INDEX users_unsub_uq ON users (unsubscribe_token) WHERE unsubscribe_token IS NOT NULL;
CREATE INDEX users_phone_idx ON users (regexp_replace(coalesce(phone, ''), '\D', '', 'g'));

-- vecchie chiavi permesso -> nuove (punto 29)
UPDATE users SET permissions = (
  SELECT coalesce(jsonb_agg(DISTINCT np), '[]'::jsonb) FROM jsonb_array_elements_text(permissions) op,
  LATERAL unnest(CASE op
    WHEN 'agenda' THEN ARRAY['agenda_view','agenda_edit'] WHEN 'richieste' THEN ARRAY['richieste']
    WHEN 'clienti' THEN ARRAY['clienti','clienti_edit','cani_edit'] WHEN 'servizi' THEN ARRAY['servizi']
    WHEN 'operatori' THEN ARRAY['personale'] WHEN 'ore' THEN ARRAY['personale']
    WHEN 'pagamenti' THEN ARRAY['pagamenti','incassi'] WHEN 'selfservice' THEN ARRAY['pagamenti','incassi']
    ELSE ARRAY[op] END) np);

CREATE TABLE login_log (
  id         bigserial PRIMARY KEY,
  user_id    integer REFERENCES users(id) ON DELETE SET NULL,
  login      varchar(255) NOT NULL,
  success    boolean NOT NULL,
  reason     varchar(60),
  ip         varchar(64),
  user_agent varchar(255),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_log_created_idx ON login_log (created_at);
CREATE INDEX login_log_user_idx ON login_log (user_id);

-- ---------- consensi e informative (punti 25, 34) ----------
CREATE TABLE consent_policies (
  id           serial PRIMARY KEY,
  kind         varchar(20) NOT NULL CHECK (kind IN ('privacy','marketing','cookie','condizioni')),
  version      varchar(20) NOT NULL,
  summary      text,
  published_at timestamptz NOT NULL DEFAULT now(),
  active       boolean NOT NULL DEFAULT true,
  UNIQUE (kind, version)
);

CREATE TABLE contact_imports (
  id          serial PRIMARY KEY,
  filename    varchar(255) NOT NULL,
  source      varchar(80) NOT NULL,
  rows_total  integer NOT NULL DEFAULT 0,
  imported    integer NOT NULL DEFAULT 0,
  updated     integer NOT NULL DEFAULT 0,
  skipped     integer NOT NULL DEFAULT 0,
  linked      integer NOT NULL DEFAULT 0,
  duplicates  integer NOT NULL DEFAULT 0,
  errors      jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by  integer REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE privacy_contacts
  ADD COLUMN external_id        varchar(120),
  ADD COLUMN import_id          integer REFERENCES contact_imports(id) ON DELETE SET NULL,
  ADD COLUMN privacy_status     varchar(20) NOT NULL DEFAULT 'non_inviata' CHECK (privacy_status IN ('non_inviata','inviata','presa_visione','accettata','rifiutata')),
  ADD COLUMN privacy_version    varchar(20),
  ADD COLUMN privacy_seen_at    timestamptz,
  ADD COLUMN marketing_status   varchar(20) NOT NULL DEFAULT 'non_richiesto' CHECK (marketing_status IN ('non_richiesto','da_verificare','concesso','negato','revocato')),
  ADD COLUMN marketing_consent_at timestamptz,
  ADD COLUMN consent_proof      text,
  ADD COLUMN revoked_at         timestamptz,
  ADD COLUMN updated_at         timestamptz NOT NULL DEFAULT now();
-- i contatti importati non sono mai autorizzati al marketing in automatico
UPDATE privacy_contacts SET marketing_status = CASE WHEN consent_marketing THEN 'da_verificare' ELSE 'non_richiesto' END;
CREATE UNIQUE INDEX privacy_contacts_ext_uq ON privacy_contacts (source, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX privacy_contacts_phone_idx ON privacy_contacts (regexp_replace(coalesce(phone, ''), '\D', '', 'g'));

CREATE TABLE privacy_contact_history (
  id          bigserial PRIMARY KEY,
  contact_id  integer NOT NULL REFERENCES privacy_contacts(id) ON DELETE CASCADE,
  actor_id    integer REFERENCES users(id) ON DELETE SET NULL,
  import_id   integer REFERENCES contact_imports(id) ON DELETE SET NULL,
  changes     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- storico autorizzazioni (concessioni e revoche), per clienti registrati e contatti importati
CREATE TABLE customer_consents (
  id                 bigserial PRIMARY KEY,
  user_id            integer REFERENCES users(id) ON DELETE CASCADE,
  privacy_contact_id integer REFERENCES privacy_contacts(id) ON DELETE CASCADE,
  kind               varchar(20) NOT NULL CHECK (kind IN ('privacy','marketing','cookie','condizioni','richiami')),
  granted            boolean NOT NULL,
  policy_version     varchar(20),
  source             varchar(60) NOT NULL,
  proof              text,
  ip                 varchar(64),
  user_agent         varchar(255),
  created_by         integer REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR privacy_contact_id IS NOT NULL)
);
CREATE INDEX customer_consents_user_idx ON customer_consents (user_id, kind, created_at);

-- ---------- cani: richiami periodici ----------
ALTER TABLE dogs
  ADD COLUMN recall_days integer CHECK (recall_days IS NULL OR recall_days BETWEEN 1 AND 365),
  ADD COLUMN last_recall_at timestamptz;

-- ---------- appuntamenti: storico trattamento e cancellazioni ----------
ALTER TABLE appointments
  ADD COLUMN treatment_notes text,
  ADD COLUMN cancel_reason   varchar(255),
  ADD COLUMN cancelled_at    timestamptz,
  ADD COLUMN cancelled_by    varchar(20) CHECK (cancelled_by IS NULL OR cancelled_by IN ('cliente','salone')),
  ADD COLUMN late_cancel     boolean NOT NULL DEFAULT false;
CREATE INDEX appointments_dog_idx ON appointments (dog_id, start_at);

ALTER TABLE services ADD COLUMN earns_points boolean NOT NULL DEFAULT true;

-- ---------- personale: liquidazioni settimanali ----------
CREATE TABLE staff_settlements (
  id                serial PRIMARY KEY,
  operator_id       integer NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
  week_start        date NOT NULL,
  week_end          date NOT NULL,
  minutes           integer NOT NULL,
  gross_cents       integer NOT NULL,
  adjustments_cents integer NOT NULL DEFAULT 0,
  adjustment_note   text,
  total_cents       integer NOT NULL,
  status            varchar(12) NOT NULL DEFAULT 'da_pagare' CHECK (status IN ('da_pagare','pagato')),
  paid_at           date,
  paid_method       varchar(30),
  note              text,
  created_by        integer REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operator_id, week_start),
  CHECK (week_end >= week_start)
);
ALTER TABLE work_logs
  ADD COLUMN raw_min integer NOT NULL DEFAULT 0,
  ADD COLUMN settlement_id integer REFERENCES staff_settlements(id) ON DELETE SET NULL;
UPDATE work_logs SET raw_min = effective_min;

-- ---------- fidelity completa ----------
ALTER TABLE loyalty_transactions
  ADD COLUMN kind varchar(12) NOT NULL DEFAULT 'accumulo' CHECK (kind IN ('accumulo','utilizzo','scadenza','proroga','rettifica','storno')),
  ADD COLUMN expires_at timestamptz,
  ADD COLUMN remaining integer NOT NULL DEFAULT 0,
  ADD COLUMN value_cents integer,
  ADD COLUMN related_tx_id integer REFERENCES loyalty_transactions(id) ON DELETE SET NULL,
  ADD COLUMN payment_id integer REFERENCES payments(id) ON DELETE SET NULL;
UPDATE loyalty_transactions SET kind = CASE WHEN points >= 0 THEN 'accumulo' ELSE 'rettifica' END, remaining = GREATEST(points, 0);
DROP INDEX IF EXISTS loyalty_tx_app_uq;
DROP INDEX IF EXISTS loyalty_tx_order_uq;
CREATE UNIQUE INDEX loyalty_tx_app_uq ON loyalty_transactions (appointment_id) WHERE appointment_id IS NOT NULL AND kind = 'accumulo';
CREATE UNIQUE INDEX loyalty_tx_order_uq ON loyalty_transactions (order_id) WHERE order_id IS NOT NULL AND kind = 'accumulo';
CREATE INDEX loyalty_tx_expiry_idx ON loyalty_transactions (expires_at) WHERE remaining > 0;

ALTER TABLE loyalty_rewards
  ADD COLUMN reward_type varchar(20) NOT NULL DEFAULT 'premio' CHECK (reward_type IN ('premio','sconto_servizi','sconto_prodotti','credito_shop')),
  ADD COLUMN value_cents integer;

-- ---------- shop: categorie, varianti, consegne, vendite al banco ----------
CREATE TABLE product_categories (
  id         serial PRIMARY KEY,
  name       varchar(80) NOT NULL UNIQUE,
  slug       varchar(100) NOT NULL UNIQUE,
  sort_order integer NOT NULL DEFAULT 0,
  active     boolean NOT NULL DEFAULT true
);
INSERT INTO product_categories (name, slug) SELECT DISTINCT category, lower(regexp_replace(category, '[^a-zA-Z0-9]+', '-', 'g')) FROM products ON CONFLICT DO NOTHING;

ALTER TABLE products ADD COLUMN earns_points boolean NOT NULL DEFAULT true, ADD COLUMN private_label boolean NOT NULL DEFAULT false;

CREATE TABLE product_variants (
  id          serial PRIMARY KEY,
  product_id  integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name        varchar(120) NOT NULL,
  sku         varchar(60),
  price_cents integer CHECK (price_cents IS NULL OR price_cents >= 0),
  stock       integer NOT NULL DEFAULT 0,
  min_stock   integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0
);
CREATE INDEX product_variants_product_idx ON product_variants (product_id);

ALTER TABLE stock_movements ADD COLUMN variant_id integer REFERENCES product_variants(id) ON DELETE SET NULL;
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_kind_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_kind_check CHECK (kind IN ('carico','scarico','vendita','vendita_negozio','reso','rettifica','inventario'));

ALTER TABLE orders ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE orders
  ADD COLUMN channel            varchar(10) NOT NULL DEFAULT 'online' CHECK (channel IN ('online','negozio')),
  ADD COLUMN subtotal_cents     integer NOT NULL DEFAULT 0,
  ADD COLUMN delivery_cents     integer NOT NULL DEFAULT 0,
  ADD COLUMN delivery_zone      varchar(80),
  ADD COLUMN delivery_address   varchar(255),
  ADD COLUMN delivery_city      varchar(120),
  ADD COLUMN delivery_cap       varchar(10),
  ADD COLUMN delivery_eta       varchar(80),
  ADD COLUMN points_used        integer NOT NULL DEFAULT 0,
  ADD COLUMN points_discount_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN stock_committed    boolean NOT NULL DEFAULT false,
  ADD COLUMN cancelled_at       timestamptz;
UPDATE orders SET subtotal_cents = total_cents + discount_cents;
ALTER TABLE order_items ADD COLUMN variant_id integer REFERENCES product_variants(id) ON DELETE SET NULL;

-- ---------- pensione: informazioni e proposte ----------
ALTER TABLE boarding_requests DROP CONSTRAINT IF EXISTS boarding_requests_status_check;
ALTER TABLE boarding_requests ADD CONSTRAINT boarding_requests_status_check CHECK (status IN ('richiesta','info_richieste','proposta','confermata','rifiutata','in_corso','completata','annullata'));
ALTER TABLE boarding_requests
  ADD COLUMN needs text,
  ADD COLUMN proposed_start date,
  ADD COLUMN proposed_end date,
  ADD COLUMN last_message text;
CREATE TABLE boarding_events (
  id          bigserial PRIMARY KEY,
  boarding_id integer NOT NULL REFERENCES boarding_requests(id) ON DELETE CASCADE,
  actor_id    integer REFERENCES users(id) ON DELETE SET NULL,
  action      varchar(40) NOT NULL,
  message     text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX boarding_events_idx ON boarding_events (boarding_id);

-- ---------- pagamenti: causale e metodo punti ----------
ALTER TABLE payments ADD COLUMN reason varchar(160);

-- ---------- email: template personalizzabili e coda di invio ----------
CREATE TABLE email_templates (
  key        varchar(60) PRIMARY KEY,
  name       varchar(120) NOT NULL,
  subject    varchar(200) NOT NULL,
  body       text NOT NULL,
  active     boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE email_queue (
  id              bigserial PRIMARY KEY,
  to_email        varchar(255) NOT NULL,
  subject         varchar(255) NOT NULL,
  html            text NOT NULL,
  template        varchar(60),
  user_id         integer REFERENCES users(id) ON DELETE SET NULL,
  status          varchar(12) NOT NULL DEFAULT 'in_coda' CHECK (status IN ('in_coda','in_invio','inviata','errore','fallita','simulata')),
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  provider_id     varchar(255),
  dedupe_key      varchar(160),
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz
);
CREATE INDEX email_queue_pending_idx ON email_queue (next_attempt_at) WHERE status IN ('in_coda','errore');
CREATE UNIQUE INDEX email_queue_dedupe_uq ON email_queue (dedupe_key) WHERE dedupe_key IS NOT NULL;

-- ---------- push: log invii ----------
CREATE TABLE push_log (
  id         bigserial PRIMARY KEY,
  user_id    integer REFERENCES users(id) ON DELETE SET NULL,
  title      varchar(160) NOT NULL,
  status     varchar(12) NOT NULL CHECK (status IN ('inviata','errore','rimossa')),
  error      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_log_created_idx ON push_log (created_at);

-- ---------- campagne: segmentazione ----------
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_audience_check;
ALTER TABLE campaigns ADD COLUMN filters jsonb NOT NULL DEFAULT '{}'::jsonb;
