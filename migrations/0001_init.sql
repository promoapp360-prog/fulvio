-- Dog's Planet – migrazione iniziale
-- Tutti gli importi sono in centesimi di euro (integer). Tutte le date/ore in timestamptz (UTC), visualizzate in Europe/Rome.

CREATE TABLE users (
  id            serial PRIMARY KEY,
  email         varchar(255) NOT NULL,
  password_hash text NOT NULL,
  role          varchar(20) NOT NULL DEFAULT 'customer' CHECK (role IN ('admin','staff','operator','customer')),
  permissions   jsonb NOT NULL DEFAULT '[]'::jsonb,
  first_name    varchar(100) NOT NULL,
  last_name     varchar(100) NOT NULL,
  phone         varchar(40),
  address       varchar(255),
  city          varchar(120),
  province      varchar(10),
  cap           varchar(10),
  country       varchar(80) DEFAULT 'Italia',
  birth_date    date,
  notes         text,
  comm_email    boolean NOT NULL DEFAULT true,
  comm_push     boolean NOT NULL DEFAULT true,
  comm_whatsapp boolean NOT NULL DEFAULT false,
  consent_privacy   boolean NOT NULL DEFAULT false,
  consent_marketing boolean NOT NULL DEFAULT false,
  consent_date  timestamptz,
  active        boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  reset_token   varchar(128),
  reset_expires timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));
CREATE INDEX users_role_idx ON users (role);
CREATE INDEX users_name_idx ON users (last_name, first_name);

CREATE TABLE dog_custom_fields (
  id         serial PRIMARY KEY,
  field_key  varchar(60) NOT NULL UNIQUE,
  label      varchar(120) NOT NULL,
  field_type varchar(20) NOT NULL CHECK (field_type IN ('text','number','date','select','checkbox')),
  options    jsonb NOT NULL DEFAULT '[]'::jsonb,
  required   boolean NOT NULL DEFAULT false,
  section    varchar(40) NOT NULL DEFAULT 'altro',
  sort_order integer NOT NULL DEFAULT 0,
  active     boolean NOT NULL DEFAULT true
);

CREATE TABLE dogs (
  id              serial PRIMARY KEY,
  owner_id        integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            varchar(80) NOT NULL,
  breed           varchar(120),
  size            varchar(10) NOT NULL DEFAULT 'media' CHECK (size IN ('piccola','media','grande','gigante')),
  weight_kg       numeric(5,2),
  birth_date      date,
  notes           text,
  coat_knots      boolean NOT NULL DEFAULT false,
  coat_shedding   boolean NOT NULL DEFAULT false,
  last_bath       date,
  coat_type       varchar(80),
  coat_notes      text,
  joint_issues    text,
  dermatitis      text,
  intolerances    text,
  sensitivities   text,
  aggressive      boolean NOT NULL DEFAULT false,
  aggressive_notes text,
  other_needs     text,
  other_pets      text,
  food            jsonb NOT NULL DEFAULT '{}'::jsonb,
  custom_fields   jsonb NOT NULL DEFAULT '{}'::jsonb,
  photo_url       text,
  archived        boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dogs_owner_idx ON dogs (owner_id);

CREATE TABLE services (
  id            serial PRIMARY KEY,
  name          varchar(120) NOT NULL,
  slug          varchar(140) NOT NULL UNIQUE,
  category      varchar(80) NOT NULL DEFAULT 'Toelettatura',
  description   text,
  price_cents   integer CHECK (price_cents IS NULL OR price_cents >= 0),
  price_from    boolean NOT NULL DEFAULT true,
  duration_min  integer NOT NULL DEFAULT 60 CHECK (duration_min > 0),
  bookable      boolean NOT NULL DEFAULT true,
  active        boolean NOT NULL DEFAULT true,
  visible       boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE service_variants (
  id           serial PRIMARY KEY,
  service_id   integer NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  size         varchar(10) NOT NULL CHECK (size IN ('piccola','media','grande','gigante')),
  price_cents  integer CHECK (price_cents IS NULL OR price_cents >= 0),
  duration_min integer CHECK (duration_min IS NULL OR duration_min > 0),
  UNIQUE (service_id, size)
);

CREATE TABLE service_supplements (
  id          serial PRIMARY KEY,
  service_id  integer REFERENCES services(id) ON DELETE CASCADE,
  name        varchar(120) NOT NULL,
  condition   varchar(20) NOT NULL DEFAULT 'manuale' CHECK (condition IN ('manuale','nodi','muta','aggressivo','esigenze')),
  price_cents integer NOT NULL DEFAULT 0,
  extra_min   integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true
);

CREATE TABLE operators (
  id                serial PRIMARY KEY,
  user_id           integer REFERENCES users(id) ON DELETE SET NULL,
  name              varchar(80) NOT NULL,
  color             varchar(9) NOT NULL DEFAULT '#2E8DE6',
  bio               text,
  hourly_rate_cents integer NOT NULL DEFAULT 1000 CHECK (hourly_rate_cents >= 0),
  vat_number        varchar(20),
  bookable_online   boolean NOT NULL DEFAULT true,
  active            boolean NOT NULL DEFAULT true,
  sort_order        integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE operator_services (
  operator_id integer NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  service_id  integer NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (operator_id, service_id)
);

CREATE TABLE operator_shifts (
  id          serial PRIMARY KEY,
  operator_id integer NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  weekday     smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0 = domenica
  start_time  varchar(5) NOT NULL,
  end_time    varchar(5) NOT NULL,
  break_start varchar(5),
  break_end   varchar(5)
);
CREATE INDEX operator_shifts_op_idx ON operator_shifts (operator_id, weekday);

-- operator_id NULL = chiusura del salone per tutti
CREATE TABLE operator_absences (
  id          serial PRIMARY KEY,
  operator_id integer REFERENCES operators(id) ON DELETE CASCADE,
  kind        varchar(20) NOT NULL DEFAULT 'ferie' CHECK (kind IN ('ferie','assenza','chiusura','malattia','altro')),
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  start_time  varchar(5),
  end_time    varchar(5),
  note        text,
  CHECK (end_date >= start_date)
);
CREATE INDEX operator_absences_dates_idx ON operator_absences (start_date, end_date);

CREATE TABLE resources (
  id     serial PRIMARY KEY,
  name   varchar(80) NOT NULL,
  kind   varchar(30) NOT NULL DEFAULT 'postazione',
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE appointments (
  id                   serial PRIMARY KEY,
  customer_id          integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  dog_id               integer NOT NULL REFERENCES dogs(id) ON DELETE RESTRICT,
  service_id           integer NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  operator_id          integer REFERENCES operators(id) ON DELETE SET NULL,
  resource_id          integer REFERENCES resources(id) ON DELETE SET NULL,
  start_at             timestamptz NOT NULL,
  end_at               timestamptz NOT NULL,
  duration_min         integer NOT NULL,
  status               varchar(20) NOT NULL DEFAULT 'richiesta' CHECK (status IN
                        ('richiesta','in_valutazione','proposta','confermata','attesa_pagamento','completata','annullata','rifiutata','assente')),
  customer_notes       text,
  admin_notes          text,
  estimated_price_cents integer,
  final_price_cents    integer,
  payment_mode         varchar(20) NOT NULL DEFAULT 'nessuno' CHECK (payment_mode IN ('nessuno','acconto','saldo','negozio')),
  deposit_cents        integer,
  proposed_start_at    timestamptz,
  proposed_operator_id integer REFERENCES operators(id) ON DELETE SET NULL,
  allow_overlap        boolean NOT NULL DEFAULT false,
  change_request       text,
  source               varchar(20) NOT NULL DEFAULT 'online',
  reminder_sent_at     timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at)
);
CREATE INDEX appointments_start_idx ON appointments (start_at);
CREATE INDEX appointments_operator_idx ON appointments (operator_id, start_at);
CREATE INDEX appointments_customer_idx ON appointments (customer_id);
CREATE INDEX appointments_status_idx ON appointments (status);

CREATE TABLE appointment_events (
  id             serial PRIMARY KEY,
  appointment_id integer NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  actor_id       integer REFERENCES users(id) ON DELETE SET NULL,
  action         varchar(40) NOT NULL,
  from_status    varchar(20),
  to_status      varchar(20),
  data           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX appointment_events_app_idx ON appointment_events (appointment_id);

CREATE TABLE suppliers (
  id         serial PRIMARY KEY,
  name       varchar(160) NOT NULL,
  contact    varchar(120),
  email      varchar(255),
  phone      varchar(40),
  vat_number varchar(20),
  address    varchar(255),
  notes      text,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id               serial PRIMARY KEY,
  name             varchar(160) NOT NULL,
  slug             varchar(180) NOT NULL UNIQUE,
  category         varchar(80) NOT NULL DEFAULT 'Accessori',
  description      text,
  price_cents      integer NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  sale_price_cents integer CHECK (sale_price_cents IS NULL OR sale_price_cents >= 0),
  cost_cents       integer,
  vat_rate         numeric(4,2) NOT NULL DEFAULT 22,
  sku              varchar(60),
  barcode          varchar(60),
  stock            integer NOT NULL DEFAULT 0,
  min_stock        integer NOT NULL DEFAULT 0,
  supplier_id      integer REFERENCES suppliers(id) ON DELETE SET NULL,
  image_url        text,
  is_food          boolean NOT NULL DEFAULT false,
  visible_online   boolean NOT NULL DEFAULT true,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_category_idx ON products (category);
CREATE UNIQUE INDEX products_sku_uq ON products (sku) WHERE sku IS NOT NULL;

CREATE TABLE stock_movements (
  id         serial PRIMARY KEY,
  product_id integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty        integer NOT NULL,
  kind       varchar(20) NOT NULL CHECK (kind IN ('carico','scarico','vendita','reso','rettifica')),
  reference  varchar(120),
  note       text,
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_movements_product_idx ON stock_movements (product_id, created_at);

CREATE TABLE orders (
  id              serial PRIMARY KEY,
  customer_id     integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status          varchar(20) NOT NULL DEFAULT 'in_attesa' CHECK (status IN ('in_attesa','pagato','in_preparazione','pronto','spedito','completato','annullato')),
  total_cents     integer NOT NULL DEFAULT 0,
  discount_cents  integer NOT NULL DEFAULT 0,
  promo_code      varchar(40),
  delivery        varchar(20) NOT NULL DEFAULT 'ritiro' CHECK (delivery IN ('ritiro','consegna')),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_customer_idx ON orders (customer_id);

CREATE TABLE order_items (
  id               serial PRIMARY KEY,
  order_id         integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id       integer REFERENCES products(id) ON DELETE SET NULL,
  name             varchar(160) NOT NULL,
  qty              integer NOT NULL CHECK (qty > 0),
  unit_price_cents integer NOT NULL
);

CREATE TABLE payments (
  id             serial PRIMARY KEY,
  appointment_id integer REFERENCES appointments(id) ON DELETE SET NULL,
  order_id       integer REFERENCES orders(id) ON DELETE SET NULL,
  boarding_id    integer,
  customer_id    integer REFERENCES users(id) ON DELETE SET NULL,
  kind           varchar(20) NOT NULL CHECK (kind IN ('acconto','saldo','totale','parziale','rimborso')),
  method         varchar(30) NOT NULL CHECK (method IN ('contanti','pos','satispay','bonifico_istantaneo','bonifico','online','altro')),
  method_label   varchar(60),
  amount_cents   integer NOT NULL CHECK (amount_cents > 0),
  status         varchar(20) NOT NULL DEFAULT 'pagato' CHECK (status IN ('in_attesa','pagato','fallito','annullato')),
  provider       varchar(30),
  provider_ref   varchar(255),
  checkout_url   text,
  paid_at        timestamptz,
  note           text,
  created_by     integer REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
-- evita il doppio conteggio dello stesso pagamento del provider
CREATE UNIQUE INDEX payments_provider_ref_uq ON payments (provider, provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX payments_paid_idx ON payments (paid_at);
CREATE INDEX payments_appointment_idx ON payments (appointment_id);

CREATE TABLE work_logs (
  id                serial PRIMARY KEY,
  operator_id       integer NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  work_date         date NOT NULL,
  clock_in          varchar(5) NOT NULL,
  clock_out         varchar(5),
  break_min         integer NOT NULL DEFAULT 0 CHECK (break_min >= 0),
  effective_min     integer NOT NULL DEFAULT 0,
  hourly_rate_cents integer NOT NULL,
  amount_cents      integer NOT NULL DEFAULT 0,
  note              text,
  corrected         boolean NOT NULL DEFAULT false,
  correction_note   text,
  corrected_by      integer REFERENCES users(id) ON DELETE SET NULL,
  paid              boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX work_logs_op_date_idx ON work_logs (operator_id, work_date);

CREATE TABLE selfservice_incomes (
  id           serial PRIMARY KEY,
  income_date  date NOT NULL,
  station      varchar(60) NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  method       varchar(30) NOT NULL DEFAULT 'contanti',
  category     varchar(60),
  note         text,
  created_by   integer REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX selfservice_incomes_date_idx ON selfservice_incomes (income_date);

CREATE TABLE loyalty_cards (
  id          serial PRIMARY KEY,
  customer_id integer NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  code        varchar(20) NOT NULL UNIQUE,
  points      integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE loyalty_transactions (
  id             serial PRIMARY KEY,
  card_id        integer NOT NULL REFERENCES loyalty_cards(id) ON DELETE CASCADE,
  points         integer NOT NULL,
  reason         varchar(160) NOT NULL,
  appointment_id integer REFERENCES appointments(id) ON DELETE SET NULL,
  order_id       integer REFERENCES orders(id) ON DELETE SET NULL,
  created_by     integer REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX loyalty_tx_card_idx ON loyalty_transactions (card_id);
-- un solo accredito automatico per appuntamento / ordine
CREATE UNIQUE INDEX loyalty_tx_app_uq ON loyalty_transactions (appointment_id) WHERE appointment_id IS NOT NULL AND points > 0;
CREATE UNIQUE INDEX loyalty_tx_order_uq ON loyalty_transactions (order_id) WHERE order_id IS NOT NULL AND points > 0;

CREATE TABLE loyalty_rewards (
  id          serial PRIMARY KEY,
  name        varchar(120) NOT NULL,
  description text,
  points_cost integer NOT NULL CHECK (points_cost > 0),
  active      boolean NOT NULL DEFAULT true
);

CREATE TABLE boarding_requests (
  id           serial PRIMARY KEY,
  customer_id  integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dog_id       integer NOT NULL REFERENCES dogs(id) ON DELETE CASCADE,
  start_date   date NOT NULL,
  end_date     date NOT NULL,
  status       varchar(20) NOT NULL DEFAULT 'richiesta' CHECK (status IN ('richiesta','confermata','rifiutata','in_corso','completata','annullata')),
  customer_notes text,
  admin_notes  text,
  price_cents  integer,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX boarding_dates_idx ON boarding_requests (start_date, end_date);

CREATE TABLE pages (
  id              serial PRIMARY KEY,
  slug            varchar(80) NOT NULL UNIQUE,
  title           varchar(160) NOT NULL,
  subtitle        varchar(255),
  body            text NOT NULL DEFAULT '',
  seo_title       varchar(160),
  seo_description varchar(320),
  image_url       text,
  video_url       text,
  published       boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE faqs (
  id         serial PRIMARY KEY,
  section    varchar(40) NOT NULL DEFAULT 'generale',
  question   varchar(255) NOT NULL,
  answer     text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active     boolean NOT NULL DEFAULT true
);

CREATE TABLE media (
  id         serial PRIMARY KEY,
  storage_key varchar(255) NOT NULL UNIQUE,
  url        text NOT NULL,
  mime       varchar(80) NOT NULL,
  size_bytes integer NOT NULL,
  width      integer,
  height     integer,
  alt        varchar(255),
  uploaded_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE promotions (
  id             serial PRIMARY KEY,
  title          varchar(160) NOT NULL,
  description    text,
  code           varchar(40) UNIQUE,
  discount_type  varchar(10) NOT NULL DEFAULT 'percent' CHECK (discount_type IN ('percent','amount','points')),
  discount_value integer NOT NULL DEFAULT 0,
  applies_to     varchar(20) NOT NULL DEFAULT 'tutto' CHECK (applies_to IN ('tutto','servizi','shop')),
  audience       varchar(20) NOT NULL DEFAULT 'tutti' CHECK (audience IN ('tutti','compleanno','inattivi','fidelity')),
  starts_at      date,
  ends_at        date,
  show_on_site   boolean NOT NULL DEFAULT false,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE campaigns (
  id          serial PRIMARY KEY,
  title       varchar(160) NOT NULL,
  subject     varchar(200) NOT NULL,
  body        text NOT NULL,
  channel     varchar(10) NOT NULL DEFAULT 'email' CHECK (channel IN ('email','push','entrambi')),
  audience    varchar(20) NOT NULL DEFAULT 'marketing' CHECK (audience IN ('marketing','tutti','compleanno','inattivi','fidelity')),
  promotion_id integer REFERENCES promotions(id) ON DELETE SET NULL,
  status      varchar(10) NOT NULL DEFAULT 'bozza' CHECK (status IN ('bozza','inviata')),
  sent_count  integer NOT NULL DEFAULT 0,
  sent_at     timestamptz,
  created_by  integer REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE email_log (
  id         serial PRIMARY KEY,
  to_email   varchar(255) NOT NULL,
  subject    varchar(255) NOT NULL,
  template   varchar(60),
  status     varchar(10) NOT NULL CHECK (status IN ('inviata','errore','simulata')),
  error      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_log_created_idx ON email_log (created_at);

CREATE TABLE push_subscriptions (
  id         serial PRIMARY KEY,
  user_id    integer REFERENCES users(id) ON DELETE CASCADE,
  endpoint   text NOT NULL UNIQUE,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id         serial PRIMARY KEY,
  user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      varchar(160) NOT NULL,
  body       text,
  url        varchar(255),
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, read_at);

CREATE TABLE privacy_contacts (
  id                serial PRIMARY KEY,
  first_name        varchar(100),
  last_name         varchar(100),
  email             varchar(255),
  phone             varchar(40),
  consent_privacy   boolean NOT NULL DEFAULT false,
  consent_marketing boolean NOT NULL DEFAULT false,
  consent_date      timestamptz,
  source            varchar(80),
  linked_user_id    integer REFERENCES users(id) ON DELETE SET NULL,
  imported_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX privacy_contacts_email_uq ON privacy_contacts (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE settings (
  key        varchar(80) PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  actor_id   integer REFERENCES users(id) ON DELETE SET NULL,
  action     varchar(60) NOT NULL,
  entity     varchar(40) NOT NULL,
  entity_id  varchar(40),
  data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip         varchar(64),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON audit_log (created_at);
CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id);

-- sessioni (connect-pg-simple)
CREATE TABLE "session" (
  "sid"    varchar NOT NULL PRIMARY KEY,
  "sess"   json NOT NULL,
  "expire" timestamp(6) NOT NULL
);
CREATE INDEX "IDX_session_expire" ON "session" ("expire");
