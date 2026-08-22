# Auth Hardening — Rollout Checklist

**Branch:** `feat/auth-hardening` · **Spec:** `2026-08-18-auth-hardening-design.md` · **Plan:** `../plans/2026-08-18-auth-hardening.md`

Do these in order. Steps 1 and 2 are required before the app will work; the rest are judgement calls.

## 1. Set `TOTP_ENCRYPTION_KEY` — before deploying

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Put it in the Vercel project environment. **Do this before the deploy, not after.**

`getKey()` throws when it is absent, so `/api/users/2fa/setup` returns 500 and enrolment becomes impossible. Because 2FA is mandatory for privileged users and they are *forced* into enrolment at login, a missing key locks out every admin.

Losing this key later means every enrolled user must re-enrol. There is no key-rotation mechanism. Store it with the same care as `JWT_SECRET`.

## 2. Apply the migration by hand

Run `lib/db/migrations/0008_auth_hardening.sql` against the database — psql or the Supabase SQL editor.

**Do not use `drizzle-kit push`.** It performs a schema diff and never executes this file; it would try to add `username text NOT NULL UNIQUE` to a populated table in one step, skipping the staged backfill.

The file is wrapped in a transaction and opens with a guard that aborts before touching anything if any two emails collide when lowercased and trimmed (Postgres unique constraints are case-sensitive, so `Foo@x.com` and `foo@x.com` can both exist today). If it raises, resolve those accounts first and re-run. Nothing is left half-applied.

## 3. Tell users their username is their email address

The backfill sets `username = lower(trim(email))`, so on day one every existing user signs in by typing their full email address into a field labelled **Username**. Their credentials are unchanged, but the label is not.

Usernames are editable in Settings → Users, so email-shaped ones can be tidied over time.

## 4. Enrol an admin immediately, and save the backup codes

Sign in as an admin right after deploying. You will be forced into 2FA enrolment. **Store the ten backup codes somewhere durable before doing anything else.**

Recovery depends on them: a user who loses both their phone and their codes needs another user holding `settings.users:manage` to reset their 2FA. For a *system* account, only another system account can do that. With one system admin and no saved codes, recovery means direct database access.

Make sure a second account holds `settings.users:manage` so two people can unlock each other.

## 5. Optional — force everyone to re-authenticate at cutover

Sessions issued by the current deployed code carry no `tokenVersion` claim, which decodes to `0`, and the new column defaults to `0`. So **existing sessions survive the deploy**. To force a clean re-login:

```sql
UPDATE users SET token_version = token_version + 1;
```

Run it after the migration.

## 6. Confirm rate limiting is actually live

`checkRateLimit` fails **open** when Upstash is unconfigured, so a misconfigured deploy silently has no login limiter. Verify `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set in Vercel.

TOTP brute-force protection is database-backed and unaffected by this.

---

## Known gaps, deliberately not fixed

Triaged during review and judged acceptable. Recorded so they are decisions rather than surprises.

| Gap | Why it stands |
|---|---|
| `db:seed` will run against whatever `DATABASE_URL` holds — currently production | Out of scope for this work. **Worth fixing separately:** the script inserts a system admin and has no environment guard. |
| Test mocks discard the `.where()` argument, so a query filtering the wrong column would still pass | Systemic across route tests. A shared helper that captures and asserts the `where` argument would retire the whole class at once — worth doing before the next auth change. |
| No end-to-end test crosses the HTTP cookie boundary | Every route is tested with module-level mocks. One integration test driving login → 2FA → session with real cookie propagation would cover the seam unit tests structurally cannot. |
| Usernames have no charset policy — any non-empty string after trim/lowercase | Normalization is consistent on write and lookup, so collisions resolve correctly. A `[a-z0-9._-]` allowlist would reduce homograph/impersonation risk in the admin user list. |
| Editing your own user record through Settings → Users invalidates your own session | Direct consequence of bumping `token_version` on every update, which is what makes a role demotion take effect immediately. The trade is correct; the UX edge is worth knowing. |
| Failure-counter increment is a non-atomic read-modify-write | Two concurrent wrong codes can each write `n+1` from the same read, undercounting by one. Does not materially weaken a 5-attempt lock. |
| The middleware matcher exempts by prefix | A future route named `/enroll-2fa-admin` would also be exempt. Pre-existing property of the pattern; no such route exists. |
| `scripts/` package does not typecheck | Pre-existing and unrelated — it imports `campaignsTable`/`transactionsTable`, dropped in migration 0007. `app` typechecks clean. |
