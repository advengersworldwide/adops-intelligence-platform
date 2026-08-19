-- Auth hardening: username login, TOTP 2FA, password lifecycle, session revocation.

BEGIN;

-- Guard: the backfill lowercases and trims emails, but Postgres unique
-- constraints are case-sensitive, so two emails differing only in case or
-- surrounding whitespace collapse to the same username and would break the
-- unique index below. Fail before changing anything.
DO $$
DECLARE colliding int;
BEGIN
  SELECT count(*) INTO colliding FROM (
    SELECT lower(trim(email)) FROM users GROUP BY 1 HAVING count(*) > 1
  ) dupes;
  IF colliding > 0 THEN
    RAISE EXCEPTION
      'Cannot backfill username: % email group(s) collide when lowercased and trimmed. Resolve these before applying this migration.', colliding;
  END IF;
END $$;

-- 1. Username. Added nullable, backfilled from email, then constrained.
--    Email uniqueness is enforced only case-sensitively in Postgres, so the
--    guard above ensures the backfill of lower(trim(email)) is safe.
ALTER TABLE users ADD COLUMN username text;
UPDATE users SET username = lower(trim(email)) WHERE username IS NULL;
ALTER TABLE users ALTER COLUMN username SET NOT NULL;
CREATE UNIQUE INDEX users_username_unique ON users (username);

-- 2. Password lifecycle. Existing users keep their passwords (decision 9):
--    must_change_password defaults false so nobody is locked out on deploy.
ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN password_changed_at timestamptz;

-- 3. Session revocation.
ALTER TABLE users ADD COLUMN token_version integer NOT NULL DEFAULT 0;

-- 4. TOTP. Secret is AES-256-GCM ciphertext, never plaintext.
ALTER TABLE users ADD COLUMN two_factor_secret text;
ALTER TABLE users ADD COLUMN two_factor_enabled_at timestamptz;
ALTER TABLE users ADD COLUMN two_factor_failed_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN two_factor_locked_until timestamptz;
ALTER TABLE users ADD COLUMN last_totp_step bigint;

-- 5. Backup codes, stored hashed and single-use.
CREATE TABLE user_backup_codes (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_backup_codes_user_id_idx ON user_backup_codes (user_id);

COMMIT;
