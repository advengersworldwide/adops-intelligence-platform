# Auth Hardening — Username Login, TOTP 2FA, Password Lifecycle — Design

**Date:** 2026-08-18
**Status:** Approved (design); pending implementation plan
**Scope:** Replace email-based login with a unique username identifier; add TOTP two-factor authentication (mandatory for privileged roles, optional for everyone else) with single-use backup codes and admin reset; add a NIST-aligned password policy with breach screening; add temporary passwords with a forced first-login change; add self-service password change and admin-initiated resets; make sessions revocable via a token version counter. Does **not** add email infrastructure, does **not** migrate to a third-party auth library, and does **not** retroactively invalidate existing passwords.

---

## Context — current state

**Auth stack today** (all custom, no auth library):

- `POST /api/users/login` (`app/app/api/users/login/route.ts`) takes `{ email, password }`, compares with `bcryptjs` (cost 12), and on success signs an HS256 JWT via `jose` containing `sub, name, email, role, isSystem` with a 24h expiry, set as the `adops-session` httpOnly cookie (`app/lib/auth/cookies.ts`).
- `middleware.ts:17` guards all page routes by verifying that JWT **on the edge with zero database calls**. API routes use `getSession()` → `requireAuth()` / `requirePermission()` (`app/lib/auth/require.ts`), which already hits the database to resolve role permissions.
- RBAC is mature: `roles` table with a `permissions` string array, a permission catalog at `app/lib/rbac/catalog.ts`, and per-route enforcement. Relevant slug: `settings.users:manage` (`catalog.ts:84`).
- `users` table (`lib/db/src/schema/auth.ts:18`) is `id, name, email, password, role, isSystem, createdAt, updatedAt`. Nothing else.
- User management is admin-only via `POST /api/users` (`app/app/api/users/route.ts`), which upserts by email and hashes any supplied password.
- Auth/user endpoints are **not** in `lib/api-spec/openapi.yaml` — the Settings page calls them with hand-rolled `fetch`. No orval regeneration is required for this work.

**Gaps this design closes** (all verified by inspection, not assumed):

| Gap | Evidence |
|---|---|
| No password change flow for anyone, admin or otherwise | No route, no UI. The only path is an admin re-POSTing `/api/users` (`route.ts:34`) |
| No password validation of any kind | Zero matches for length/strength checks across the codebase. `password: "a"` is accepted and hashed today |
| No 2FA | No TOTP library installed |
| No email infrastructure | No Resend / nodemailer / SES / SendGrid in any `package.json` — this is why email OTP was rejected |
| Sessions cannot be revoked | JWT is stateless with a fixed 24h expiry; nothing invalidates it early |
| Username enumeration via timing | `login/route.ts:40` skips bcrypt entirely when no user matches, so "no such user" returns measurably faster than "wrong password" |
| Rate limiter fails **open** | `app/lib/rate-limit.ts:43` returns success when Upstash env vars are absent — by design for local dev, but it means a misconfigured production deploy has no limiter at all |

---

## Decisions (locked with user)

1. **Second factor: TOTP only** (Google Authenticator / Authy / 1Password). Email OTP rejected — it would require standing up an email provider, domain verification, and deliverability handling, and makes login failable by a third party.
2. **2FA is mandatory for privileged users, optional for everyone else.** Privileged = holds `settings.users:manage`, or `isSystem`, or role `System Admin`.
3. **Login identifier is a unique `username`** — free-form text, not required to be email-shaped. Uniqueness enforced at creation and on edit. **Case-insensitive:** normalized to lowercase on write and on lookup, so `Bilal` and `bilal` are the same account and cannot both exist. This mirrors how email is already normalized at `login/route.ts:37` and avoids a class of impersonation where a lookalike username differs only by capitalization.
4. **New users receive a system-generated temporary password** and are forced to set their own at first login.
5. **Password policy is NIST SP 800-63B aligned:** 12 character minimum, all characters permitted, screened against known-breached passwords. **No composition rules** — mandatory uppercase/lowercase/symbol requirements were explicitly rejected because they produce predictable passwords (`Password1!`) while rejecting strong passphrases.
6. **Recovery: backup codes *and* admin reset.** Ten single-use codes issued at enrolment; holders of `settings.users:manage` can additionally clear another user's 2FA.
7. **Sessions become revocable via a `token_version` column** on the user, embedded in the JWT. Full server-side session table rejected as disproportionate; shortening expiry rejected as trading security for convenience.
8. **Admins can edit an existing user's username** after creation, so the email-shaped usernames produced by the migration can be cleaned up over time.
9. **Existing passwords are not retroactively validated.** A user with a weak current password keeps it until their next change. Accepted knowingly to avoid a forced org-wide reset on deploy day.

---

## Architecture

### 1. Data model

**`users` — new columns** (`lib/db/src/schema/auth.ts`):

| Column | Type | Purpose |
|---|---|---|
| `username` | `text NOT NULL UNIQUE` | Login identifier, stored lowercase |
| `must_change_password` | `boolean NOT NULL DEFAULT false` | Forces the change-password step |
| `password_changed_at` | `timestamptz NULL` | Audit trail |
| `token_version` | `integer NOT NULL DEFAULT 0` | Bumped to invalidate all live sessions |
| `two_factor_secret` | `text NULL` | TOTP secret, **encrypted at rest** |
| `two_factor_enabled_at` | `timestamptz NULL` | `NULL` = not enrolled |
| `two_factor_failed_attempts` | `integer NOT NULL DEFAULT 0` | Brute-force counter |
| `two_factor_locked_until` | `timestamptz NULL` | Lockout expiry |
| `last_totp_step` | `bigint NULL` | Replay prevention — last consumed time step |

**New table `user_backup_codes`:**

| Column | Type |
|---|---|
| `id` | `serial PK` |
| `user_id` | `integer NOT NULL REFERENCES users(id) ON DELETE CASCADE` |
| `code_hash` | `text NOT NULL` |
| `used_at` | `timestamptz NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

Codes are stored hashed for the same reason passwords are: a database leak must not yield usable credentials. `ON DELETE CASCADE` because a deleted user's codes have no meaning.

**Why the TOTP secret is encrypted, not merely stored:** the secret is a bearer credential — anyone who reads it can generate valid codes for that account indefinitely. Password hashes are one-way and useless to a reader; a plaintext TOTP secret is not. Encrypt with AES-256-GCM using a new `TOTP_ENCRYPTION_KEY` env var (32 bytes, base64). Store `iv:authTag:ciphertext`. The app must refuse to start if 2FA is in use and the key is missing.

**Migration `lib/db/migrations/0008_auth_hardening.sql`:**

1. Add columns nullable, backfill `username = email` for every existing row, then apply `NOT NULL` + `UNIQUE`. Safe because `email` is already unique, so no collision is possible.
2. Create `user_backup_codes`.
3. Existing users get `must_change_password = false` (per decision 9) and `token_version = 0`.

Privileged existing users are *not* migrated with 2FA enabled — they are caught by the `enroll_2fa` branch of the login state machine on their next sign-in.

### 2. The challenge token — the security-critical primitive

A login that isn't finished must carry state between requests without granting access. That state is a **challenge token**: a short-lived JWT in its own `adops-challenge` cookie, carrying a `purpose` claim and the user id.

| Purpose | TTL | Issued when |
|---|---|---|
| `totp` | 5 min | Password verified, user is enrolled |
| `password_change` | 10 min | Password verified, `must_change_password` is set |
| `totp_enroll` | 10 min | Password verified, user is privileged and not enrolled |

**`verifySession()` must reject any token carrying a `purpose` claim.** This is the single most important rule in the design. Without it a challenge token — handed out *before* the second factor is verified — could be replayed as a full session cookie, silently reducing 2FA to a no-op. It gets a dedicated test.

The challenge cookie uses the same `httpOnly / secure / sameSite=lax / path=/` options as the session cookie, with `maxAge` matching the token TTL.

### 3. Login as a state machine

A single resolver decides what a user needs next. Both `POST /api/users/login` and every challenge-completion endpoint call it, so completing one step correctly routes to the next:

```
resolveNextStep(user):
  1. two_factor_enabled_at  → "totp"
  2. must_change_password   → "password_change"
  3. privileged && !enrolled→ "enroll_2fa"
  4. otherwise              → issue session
```

**Order matters, and TOTP deliberately comes first.** Consider an admin resetting the password of a user who already has 2FA: the temporary password is handed over out-of-band and may be intercepted. If password-change ran first, whoever holds that temp password could set a new one and lock out the legitimate owner — without ever proving possession of the second factor. Verifying TOTP first means the temp password alone is worthless.

`POST /api/users/login` therefore returns `{ next: "totp" | "password_change" | "enroll_2fa" }` plus a challenge cookie, **or** a session cookie when nothing is pending. It never returns both.

**Two hardening fixes ship with this route:**

- Always run a bcrypt comparison, against a fixed dummy hash when no user matches, so response timing no longer distinguishes "no such username" from "wrong password".
- Failure responses stay generic (`Invalid credentials`) regardless of which check failed.

### 4. Password policy

New module `app/lib/auth/password-policy.ts`, called from every path that sets a password:

- Minimum 12 characters.
- **Maximum 72 characters.** Not arbitrary: bcrypt silently truncates input at 72 bytes. Without an explicit cap, two different long passphrases sharing a 72-byte prefix authenticate each other — a real, if uncommon, vulnerability. Rejecting explicitly is better than truncating silently.
- All characters permitted, including spaces and Unicode. No composition rules.
- Rejected if the new password equals the current one.
- **Breach screening** via HaveIBeenPwned range API using k-anonymity: SHA-1 the candidate, send only the first 5 hex characters, compare suffixes locally. The password itself never leaves the server.
- The breach check **fails open** on network error or timeout (2s), logging a warning. A third-party outage must not block password changes or lock users out; the length minimum still applies.

### 5. TOTP verification

Library: **`otpauth`** — actively maintained, dependency-free, works in both Node and edge runtimes. **`qrcode`** generates the enrolment QR as a data URL.

- Standard 6-digit, 30-second step, SHA-1 (what authenticator apps implement).
- Accept a ±1 step window to tolerate clock drift.
- **Replay prevention:** record the consumed step in `last_totp_step` and reject any step less than or equal to it. Without this, a code captured in transit stays valid for the remainder of its 30-second window.
- **Brute-force protection is database-backed, not Redis-backed.** A 6-digit code is ~1,000,000 possibilities; unlimited attempts break it trivially. Since `checkRateLimit` fails *open* when Upstash is unconfigured (`rate-limit.ts:43`), relying on it would silently leave 2FA unprotected in exactly the misconfiguration case that matters. Instead: increment `two_factor_failed_attempts`, and after 5 failures set `two_factor_locked_until = now + 15 min`. Reset the counter on success. This always works, with or without Redis.
- Backup codes are checked on the same endpoint: compare against unused `user_backup_codes` rows, and stamp `used_at` on match so each works exactly once.

### 6. Session revocation

`token_version` is embedded in the session JWT at signing. `requireAuth()` / `requirePermission()` compare it against the user's current value — these already query the database for role permissions, so the check costs nothing extra. Edge middleware stays stateless: a revoked session survives page navigation for a moment but dies at the first API call, which is where anything consequential happens.

Bumped on: password change, admin password reset, admin 2FA reset, and user 2FA disable.

---

## API surface

| Route | Method | Auth | Behavior |
|---|---|---|---|
| `/api/users/login` | POST | none | `{ username, password }` → session **or** challenge + `next` |
| `/api/users/login/2fa` | POST | `totp` challenge | `{ code }` — TOTP or backup code → next step or session |
| `/api/users/me/password` | POST | session **or** `password_change` challenge | `{ currentPassword, newPassword }`; bumps `token_version`, clears `must_change_password` |
| `/api/users/2fa/setup` | POST | session or `totp_enroll` challenge | Generates secret, returns `otpauth://` URI + QR data URL. Not yet active |
| `/api/users/2fa/enable` | POST | same | `{ code }` proves the user actually scanned it; activates and returns 10 backup codes **once** |
| `/api/users/2fa/disable` | POST | session | `{ password, code }` re-auth. **Rejected for privileged users** |
| `/api/users/2fa/backup-codes` | POST | session | Regenerate, invalidating all prior codes |
| `/api/users/[id]/reset-password` | POST | `settings.users:manage` | Generates temp password, sets `must_change_password`, bumps `token_version`, returns the temp password once |
| `/api/users/[id]/reset-2fa` | POST | `settings.users:manage` | Clears secret + backup codes, bumps `token_version` |
| `/api/users` | POST | `settings.users:manage` | Modified: accepts `username` (uniqueness-checked), generates a temp password when none supplied, sets `must_change_password` |

Temporary passwords are **system-generated, not admin-typed** — otherwise every new account starts life as `welcome123`. Generate from a CSPRNG, display once to the admin, never store in plaintext.

One new rate-limit bucket in `app/lib/rate-limit.ts`: `password-change`. TOTP verification uses the database counter described above rather than a bucket, for the fail-open reason given in §5.

---

## UI changes

- **`app/login/page.tsx`** — "Email Address" becomes "Username" (`type="text"`, no email validation). Gains an in-page second step for the OTP code, driven by the `next` field. Deliberately in-page rather than a separate route, so partial auth state is never reflected in the URL.
- **`/change-password`** — forced variant with no dismiss path, plus live policy feedback. Reached via the `password_change` step.
- **`/enroll-2fa`** — QR code with the secret shown as text for manual entry, a verification field, then a one-time backup-codes screen with copy/download and an explicit "I've saved these" confirmation.
- **Profile / account section** — self-service password change, 2FA enable/disable, regenerate backup codes.
- **Settings → Users** — username field in the create/edit form with inline uniqueness validation; a 2FA status column; "Reset password" and "Reset 2FA" row actions gated on `settings.users:manage`.

---

## Testing

Follows the existing pattern (`app/app/api/users/login/route.test.ts`, vitest).

**Security tests — these are the point of the exercise:**

1. A `totp` challenge token is rejected by `verifySession` and cannot be used as a session cookie.
2. An expired challenge token is rejected.
3. A backup code cannot be redeemed twice.
4. A TOTP code cannot be replayed within its own time step.
5. The account locks after 5 failed TOTP attempts, and stays locked with Upstash unconfigured.
6. A JWT with a stale `token_version` is rejected by `requireAuth`.
7. `/api/users/2fa/disable` is rejected for a privileged user.
8. Login timing does not distinguish unknown username from wrong password.

**Unit tests:** password policy boundaries (11/12/72/73 chars), breach-check fail-open, TOTP verification against fixed-clock vectors, username uniqueness (including case handling), AES-GCM encrypt/decrypt round-trip.

**Route tests:** each new endpoint's success and failure paths, plus each branch of `resolveNextStep`.

---

## Migration & rollout

1. Deploy migration `0008` — additive, backfills usernames from emails, breaks nothing.
2. Set `TOTP_ENCRYPTION_KEY` in the environment **before** the app deploy. Document in `.env.example`.
3. Existing users sign in exactly as before, typing their email into a field now labelled "Username".
4. Privileged users hit the enrolment wall on their next login. **Enrol at least one admin immediately after deploy** and store its backup codes somewhere durable before touching anything else.
5. Confirm `UPSTASH_REDIS_REST_URL` / `_TOKEN` are actually set in production — the limiter is silently inert without them.

---

## Out of scope (YAGNI)

Email OTP and all email infrastructure; "remember this device for 30 days"; an active-sessions list with per-device revocation; password history beyond blocking reuse of the current password; SSO / OAuth / social login; WebAuthn / passkeys; retroactive validation of existing passwords; migration to a third-party auth library.

---

## Known risks

| Risk | Mitigation |
|---|---|
| Losing `TOTP_ENCRYPTION_KEY` makes every enrolled secret undecryptable | Every user must re-enrol. Key belongs in the secret manager with the same care as `JWT_SECRET`. No key rotation mechanism in this design — a follow-up if ever needed |
| Last admin loses phone *and* backup codes | Decision 6 gives any `settings.users:manage` holder the ability to reset another user's 2FA. With exactly one such user, recovery still requires database access — worth ensuring a second privileged account exists |
| HIBP API becomes a soft dependency of password changes | Fails open with a 2s timeout and a logged warning; the length minimum still applies |
| Users created before this ships keep email-shaped usernames | Decision 8 makes usernames editable so they can be tidied incrementally |
| Weak legacy passwords persist indefinitely | Accepted per decision 9. Revisit by setting `must_change_password` in bulk if the posture needs tightening later |