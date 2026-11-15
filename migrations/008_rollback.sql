-- Rollback for 008_email_flows.sql.
-- Note: email_verified values backfilled by 008 are left in place.

BEGIN;

DROP TABLE IF EXISTS email_verification_tokens;
DROP TABLE IF EXISTS password_reset_tokens;
ALTER TABLE users DROP COLUMN IF EXISTS password_changed_at;

COMMIT;
