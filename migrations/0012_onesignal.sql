CREATE TABLE IF NOT EXISTS onesignal_devices (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id varchar(100) NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  consent_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS onesignal_messages (
  id bigserial PRIMARY KEY,
  provider_message_id varchar(80),
  user_id integer REFERENCES users(id) ON DELETE SET NULL,
  appointment_id integer REFERENCES appointments(id) ON DELETE SET NULL,
  automation_key varchar(40) NOT NULL,
  title varchar(160) NOT NULL,
  body varchar(500) NOT NULL,
  status varchar(20) NOT NULL,
  scheduled_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS onesignal_messages_created_idx ON onesignal_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS onesignal_messages_appointment_idx ON onesignal_messages(appointment_id, automation_key, created_at DESC);
CREATE INDEX IF NOT EXISTS onesignal_devices_user_active_idx ON onesignal_devices(user_id, active);
