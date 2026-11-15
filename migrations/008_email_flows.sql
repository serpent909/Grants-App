-- 008: Transactional email flows — password reset, email verification, and
-- signing out other sessions when a password changes.
--
-- REQUIRED before deploying the code that uses it (lib/auth.ts reads
-- users.password_changed_at; sign-up writes email_verification_tokens).
-- Idempotent — safe to run more than once.

BEGIN;

-- ─── users ──────────────────────────────────────────────────────────────────
-- password_changed_at: session tokens issued before this moment are rejected
-- (see the jwt callback in lib/auth.ts). NULL = never changed.
--
-- Accounts that exist before this migration are treated as verified, so nobody
-- is nagged (or, later, locked out) retroactively. The backfill runs only on
-- the first run — guarded by the column this migration adds — so re-running it
-- never marks newer, genuinely unverified accounts as verified.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'users'
      AND column_name = 'password_changed_at'
  ) THEN
    UPDATE users SET email_verified = created_at WHERE email_verified IS NULL;
    ALTER TABLE users ADD COLUMN password_changed_at TIMESTAMPTZ;
  END IF;
END $$;

-- ─── Password reset tokens ──────────────────────────────────────────────────
-- Bearer credentials: only the SHA-256 digest is stored (lib/auth-tokens.ts).
-- Single use (used_at), short lived (expires_at, ~1 hour).

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lookups by token use the UNIQUE index; this one serves "all tokens for a
-- user" (invalidate on reset, housekeeping) and the cascade on user delete.
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user
  ON password_reset_tokens (user_id);

-- ─── Email verification tokens ──────────────────────────────────────────────
-- Same scheme; valid for 24 hours.

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user
  ON email_verification_tokens (user_id);

COMMIT;
