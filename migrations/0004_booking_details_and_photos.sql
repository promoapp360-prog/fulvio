-- Richieste dati cane: migrazione additiva. Nessun account né dato cliente viene unito o riscritto.
ALTER TABLE dogs
  ADD COLUMN coat_length varchar(20),
  ADD COLUMN coat_conditions jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN age_years smallint,
  ADD COLUMN age_months smallint;
ALTER TABLE appointments
  ADD COLUMN requested_service_ids jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN alternative_availability varchar(500),
  ADD COLUMN privacy_acknowledged_at timestamptz,
  ADD COLUMN privacy_version varchar(120),
  ADD COLUMN privacy_acknowledgement_proof varchar(120),
  ADD COLUMN privacy_request_ip varchar(64),
  ADD COLUMN privacy_user_agent varchar(255),
  ADD COLUMN marketing_consent boolean NOT NULL DEFAULT false,
  ADD COLUMN marketing_consent_at timestamptz,
  ADD COLUMN marketing_consent_proof varchar(120),
  ADD COLUMN request_key varchar(64) UNIQUE;

CREATE TABLE guest_customers (
 id serial PRIMARY KEY,
 first_name varchar(100) NOT NULL, last_name varchar(100) NOT NULL,
 email varchar(255) NOT NULL, email_normalized varchar(255) NOT NULL,
 phone varchar(40) NOT NULL, phone_normalized varchar(24) NOT NULL,
 source varchar(80) NOT NULL DEFAULT 'Richiesta prenotazione ospite',
 privacy_acknowledged_at timestamptz NOT NULL, privacy_version varchar(120),
 privacy_proof varchar(120) NOT NULL, privacy_ip varchar(64), privacy_user_agent varchar(255),
 marketing_consent boolean NOT NULL DEFAULT false, marketing_consent_at timestamptz, marketing_proof varchar(120),
 email_verified_at timestamptz, linked_at timestamptz,
 linked_user_id integer REFERENCES users(id),
 needs_manual_review boolean NOT NULL DEFAULT false, review_reason varchar(255),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX guest_customers_email_idx ON guest_customers(email_normalized);
CREATE INDEX guest_customers_phone_idx ON guest_customers(phone_normalized);
CREATE UNIQUE INDEX guest_customers_exact_identity ON guest_customers(email_normalized,phone_normalized,lower(first_name),lower(last_name));

CREATE TABLE guest_dogs (
 id serial PRIMARY KEY, guest_customer_id integer NOT NULL REFERENCES guest_customers(id),
 name varchar(80) NOT NULL, breed varchar(120) NOT NULL,
 size varchar(10) NOT NULL DEFAULT 'media',
 weight_kg numeric(5,2), age_years smallint, age_months smallint, birth_date date,
 coat_type varchar(40) NOT NULL, coat_length varchar(20) NOT NULL,
 coat_conditions jsonb NOT NULL DEFAULT '[]', coat_notes text, photo_key varchar(255),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(weight_kg IS NULL OR weight_kg BETWEEN 0.2 AND 150),
 CHECK(age_years IS NULL OR age_years BETWEEN 0 AND 30),
 CHECK(age_months IS NULL OR age_months BETWEEN 0 AND 11)
);
CREATE INDEX guest_dogs_owner_idx ON guest_dogs(guest_customer_id);

ALTER TABLE guest_bookings
  ADD COLUMN guest_customer_id integer REFERENCES guest_customers(id),
  ADD COLUMN guest_dog_id integer REFERENCES guest_dogs(id),
  ADD COLUMN requested_service_ids jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN alternative_availability varchar(500),
  ADD COLUMN privacy_proof varchar(120),
  ADD COLUMN privacy_ip varchar(64),
  ADD COLUMN privacy_user_agent varchar(255),
  ADD COLUMN marketing_consent_at timestamptz,
  ADD COLUMN marketing_proof varchar(120);

CREATE TABLE dog_photos (
 id serial PRIMARY KEY,
 dog_id integer UNIQUE REFERENCES dogs(id) ON DELETE CASCADE,
 guest_dog_id integer UNIQUE REFERENCES guest_dogs(id) ON DELETE CASCADE,
 storage_key varchar(255) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((dog_id IS NULL) <> (guest_dog_id IS NULL))
);
CREATE TABLE appointment_photos (
 id serial PRIMARY KEY,
 appointment_id integer UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
 guest_booking_id integer UNIQUE REFERENCES guest_bookings(id) ON DELETE CASCADE,
 storage_key varchar(255) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((appointment_id IS NULL) <> (guest_booking_id IS NULL))
);
