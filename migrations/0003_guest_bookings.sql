-- Additiva: nessun account fittizio, nessuna modifica a cani/appuntamenti esistenti.
CREATE TABLE guest_bookings (
 id serial PRIMARY KEY,
 first_name varchar(100) NOT NULL, last_name varchar(100) NOT NULL,
 email varchar(255) NOT NULL, phone varchar(40) NOT NULL,
 dog_name varchar(100), breed varchar(120) NOT NULL,
 service_id integer NOT NULL REFERENCES services(id),
 operator_id integer NOT NULL REFERENCES operators(id),
 start_at timestamptz NOT NULL, end_at timestamptz NOT NULL,
 duration_min integer NOT NULL CHECK(duration_min BETWEEN 5 AND 600),
 status varchar(20) NOT NULL DEFAULT 'richiesta'
   CHECK(status IN ('richiesta','in_valutazione','proposta','confermata','rifiutata','annullata','completata','assente')),
 notes text, admin_message text,
 proposed_start_at timestamptz, proposed_operator_id integer REFERENCES operators(id),
 privacy_acknowledged_at timestamptz NOT NULL DEFAULT now(), privacy_version varchar(120),
 marketing_consent boolean NOT NULL DEFAULT false,
 token_seed varchar(64) NOT NULL,
 request_key varchar(64) NOT NULL UNIQUE, payload_hash varchar(64) NOT NULL,
 dedupe_key varchar(64) NOT NULL,
 claimed_by_id integer REFERENCES users(id), claimed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(end_at > start_at),
 CHECK((status = 'proposta') = (proposed_start_at IS NOT NULL AND proposed_operator_id IS NOT NULL))
);
CREATE UNIQUE INDEX guest_bookings_live_dedupe ON guest_bookings(dedupe_key)
 WHERE status IN ('richiesta','in_valutazione','proposta','confermata');
CREATE INDEX guest_bookings_agenda ON guest_bookings(operator_id,start_at,end_at);
CREATE INDEX guest_bookings_email ON guest_bookings(email);
CREATE TABLE guest_booking_events (
 id serial PRIMARY KEY, booking_id integer NOT NULL REFERENCES guest_bookings(id) ON DELETE CASCADE,
 actor_id integer REFERENCES users(id), action varchar(50) NOT NULL,
 data jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
