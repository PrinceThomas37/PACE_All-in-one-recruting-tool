-- 042_phone_numbers.sql
-- Layer-3 Step 3 scaffolding: one business phone number per recruiter/BD
-- user — the schema half of the phone/WhatsApp channel scoped in the
-- Layer-3 architecture plan (Twilio pricing researched, not yet purchased).
--
-- DARK UNTIL A REAL TWILIO ACCOUNT EXISTS. Purely additive, and nothing
-- writes to this table yet — twilio-provider.js (the code half) is inert
-- with no TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN set. Applying this migration
-- commits to no cost by itself: no number is provisioned and nothing calls
-- Twilio until real credentials exist and someone actually buys a number.

CREATE TABLE IF NOT EXISTS phone_numbers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid REFERENCES organizations(id),
  user_id       uuid REFERENCES users(id),
  provider      text NOT NULL DEFAULT 'twilio',
  phone_number  text NOT NULL,              -- E.164, e.g. +14155551234
  provider_sid  text,                       -- Twilio's PhoneNumberSid
  capabilities  jsonb DEFAULT '{}'::jsonb,  -- {"voice":true,"sms":true,"whatsapp":false}
  status        text NOT NULL DEFAULT 'active',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS phone_numbers_number_uidx ON phone_numbers (phone_number);
CREATE INDEX IF NOT EXISTS phone_numbers_user_idx ON phone_numbers (user_id);
CREATE INDEX IF NOT EXISTS phone_numbers_org_idx ON phone_numbers (org_id);

DO $$
DECLARE default_org uuid;
BEGIN
  SELECT id INTO default_org FROM organizations ORDER BY created_at ASC LIMIT 1;
  IF default_org IS NOT NULL THEN
    EXECUTE format('ALTER TABLE phone_numbers ALTER COLUMN org_id SET DEFAULT %L', default_org);
  END IF;
END $$;
