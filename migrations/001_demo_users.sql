CREATE TABLE IF NOT EXISTS demo_users (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  persona_id TEXT,
  intent_id TEXT,
  customer_id TEXT,
  name TEXT,
  mobile_last_4 TEXT,
  date_of_birth DATE,
  kyc_status TEXT,
  kyc_rejection_reason TEXT,
  kyc_eta TEXT,
  kyc_next_step TEXT,
  payments JSONB,
  payment_references JSONB,
  source_bank TEXT,
  payment_amount NUMERIC,
  payment_status TEXT,
  payment_eta TEXT,
  refund_status TEXT,
  refund_eta TEXT,
  fixed_deposits JSONB,
  fd_id TEXT,
  fd_booking_date DATE,
  fd_bank TEXT,
  fd_amount NUMERIC,
  fd_tenure TEXT,
  fd_status TEXT,
  fd_maturity_date DATE,
  fd_expected_confirmation_window TEXT,
  payout_status TEXT,
  payout_eta TEXT,
  payout_expected_date DATE,
  payout_delay_stage TEXT,
  premature_withdrawal_estimate NUMERIC,
  premature_withdrawal_penalty NUMERIC,
  premature_withdrawal_payout_window TEXT,
  open_tickets JSONB,
  secure_links JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE demo_users
  ADD COLUMN IF NOT EXISTS intent_id TEXT,
  ADD COLUMN IF NOT EXISTS kyc_eta TEXT,
  ADD COLUMN IF NOT EXISTS kyc_next_step TEXT,
  ADD COLUMN IF NOT EXISTS payments JSONB,
  ADD COLUMN IF NOT EXISTS refund_status TEXT,
  ADD COLUMN IF NOT EXISTS refund_eta TEXT,
  ADD COLUMN IF NOT EXISTS fixed_deposits JSONB,
  ADD COLUMN IF NOT EXISTS fd_expected_confirmation_window TEXT,
  ADD COLUMN IF NOT EXISTS payout_status TEXT,
  ADD COLUMN IF NOT EXISTS payout_eta TEXT,
  ADD COLUMN IF NOT EXISTS payout_expected_date DATE,
  ADD COLUMN IF NOT EXISTS payout_delay_stage TEXT,
  ADD COLUMN IF NOT EXISTS premature_withdrawal_payout_window TEXT,
  ADD COLUMN IF NOT EXISTS open_tickets JSONB,
  ADD COLUMN IF NOT EXISTS secure_links JSONB;

CREATE INDEX IF NOT EXISTS demo_users_email_idx ON demo_users (email);

CREATE TABLE IF NOT EXISTS demo_call_verifications (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES demo_users(session_id) ON DELETE CASCADE,
  call_id TEXT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, call_id)
);

CREATE INDEX IF NOT EXISTS demo_call_verifications_session_idx
  ON demo_call_verifications (session_id);

CREATE TABLE IF NOT EXISTS demo_call_mobile_verifications (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES demo_users(session_id) ON DELETE CASCADE,
  call_id TEXT NOT NULL,
  mobile_last_4 TEXT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, call_id)
);

CREATE INDEX IF NOT EXISTS demo_call_mobile_verifications_session_idx
  ON demo_call_mobile_verifications (session_id);
