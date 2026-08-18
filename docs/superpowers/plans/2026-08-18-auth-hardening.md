# Auth Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace email login with unique usernames, add TOTP two-factor authentication with backup codes, enforce a NIST-aligned password policy, add temporary passwords with a forced first-login change, and make sessions revocable.

**Architecture:** Login becomes a state machine. `POST /api/users/login` verifies the password then returns either a full session cookie or a short-lived *challenge token* naming the next required step (`totp`, `password_change`, `enroll_2fa`). The challenge token carries a `purpose` claim, and `verifySession` refuses any token bearing that claim — this is what stops a half-authenticated token being replayed as a session. A `token_version` integer on the user, embedded in the session JWT and checked in `requireAuth`/`requirePermission`, invalidates live sessions on password change or 2FA reset.

**Tech Stack:** Next.js 15 App Router, Drizzle ORM + Postgres, `jose` (HS256 JWT), `bcryptjs`, `otpauth` 9.5.1 (TOTP), `qrcode` 1.5.4, Vitest, Upstash rate limiting.

**Spec:** `docs/superpowers/specs/2026-08-18-auth-hardening-design.md`

## Global Constraints

- Password minimum length: **12** characters. Maximum: **72** characters (bcrypt truncates silently past 72 bytes — rejecting is safer than truncating).
- **No composition rules.** Do not require uppercase/lowercase/symbols anywhere. This was an explicit decision.
- Usernames are **case-insensitive**: normalize with `.trim().toLowerCase()` on every write and every lookup.
- Privileged = holds `settings.users:manage`, OR `isSystem === true`, OR `role === "System Admin"`. Use `effectivePermissions()` from `app/lib/rbac/can.ts` — never re-derive it.
- 2FA is **mandatory for privileged users**, optional for everyone else.
- All new API route files must export `export const runtime = "nodejs";` (bcrypt and `node:crypto` are unavailable on edge).
- Auth endpoints are **not** in `lib/api-spec/openapi.yaml`. Do not run orval codegen for any of this work.
- Every route returns generic failure text (`"Invalid credentials"`). Never reveal whether a username exists.
- Run tests with `pnpm --filter @workspace/web test`. Typecheck with `pnpm typecheck`.

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `app/lib/auth/password-policy.ts` | Create | Length rules + HaveIBeenPwned breach screening |
| `app/lib/auth/secret-crypto.ts` | Create | AES-256-GCM encrypt/decrypt for TOTP secrets |
| `app/lib/auth/totp.ts` | Create | Secret generation, otpauth URI, code verification with replay guard |
| `app/lib/auth/credentials.ts` | Create | Backup-code and temp-password generation/hashing |
| `lib/db/src/schema/auth.ts` | Modify | 9 new `users` columns + `user_backup_codes` table |
| `lib/db/migrations/0008_auth_hardening.sql` | Create | Additive migration + username backfill |
| `app/lib/auth/jwt.ts` | Modify | `tokenVersion`/`username` in session; challenge sign/verify; reject `purpose` in `verifySession` |
| `app/lib/auth/cookies.ts` | Modify | `CHALLENGE_COOKIE` + its cookie options |
| `app/lib/auth/require.ts` | Modify | Enforce `token_version` on every guarded route |
| `app/lib/auth/next-step.ts` | Create | `resolveNextStep()` — the single source of login ordering |
| `app/lib/auth/actor.ts` | Create | Reads the challenge cookie; resolves a user from a session *or* a challenge |
| `app/lib/auth/session-issue.ts` | Create | Shared session-cookie and challenge-cookie response builders |
| `app/middleware.ts` | Modify | Exempt `/change-password` and `/enroll-2fa` from the session guard |
| `app/app/api/users/login/route.ts` | Modify | Username lookup, constant-time compare, challenge issuance |
| `app/app/api/users/login/2fa/route.ts` | Create | TOTP + backup code verification, lockout |
| `app/app/api/users/2fa/setup/route.ts` | Create | Generate secret + QR |
| `app/app/api/users/2fa/enable/route.ts` | Create | Verify code, activate, issue backup codes |
| `app/app/api/users/2fa/disable/route.ts` | Create | Re-auth + disable (blocked for privileged) |
| `app/app/api/users/2fa/backup-codes/route.ts` | Create | Regenerate backup codes |
| `app/app/api/users/me/password/route.ts` | Create | Self-service password change |
| `app/app/api/users/[id]/reset-password/route.ts` | Create | Admin temp-password reset |
| `app/app/api/users/[id]/reset-2fa/route.ts` | Create | Admin 2FA clear |
| `app/app/api/users/route.ts` | Modify | Username field, uniqueness, temp password on create |
| `app/app/api/auth/me/route.ts` | Modify | Expose `username` and `twoFactorEnabled` |
| `app/scripts/seed.ts` | Modify | Seed admin with a username |
| `app/lib/rate-limit.ts` | Modify | Add `password-change` bucket |
| `app/app/login/page.tsx` | Modify | Username field + in-page second step |
| `app/app/change-password/page.tsx` | Create | Forced + voluntary password change |
| `app/app/enroll-2fa/page.tsx` | Create | QR enrolment + one-time backup codes |
| `app/components/settings/AccountSecurity.tsx` | Create | Self-service password change and 2FA management |
| `app/app/(dashboard)/settings/page.tsx` | Modify | Username field, 2FA column, reset actions, security section |

---

## Task 1: Password policy module

**Files:**
- Create: `app/lib/auth/password-policy.ts`
- Test: `app/lib/auth/password-policy.test.ts`

**Interfaces:**
- Consumes: nothing (pure module, first task).
- Produces: `MIN_PASSWORD_LENGTH: 12`, `MAX_PASSWORD_LENGTH: 72`, `isBreached(password: string): Promise<boolean>`, `validatePassword(password: string): Promise<{ ok: boolean; errors: string[] }>`.

- [ ] **Step 1: Write the failing test**

Create `app/lib/auth/password-policy.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { validatePassword, isBreached, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from "./password-policy";

const okFetch = (body: string) =>
  vi.fn(async () => new Response(body, { status: 200 }));

beforeEach(() => {
  vi.stubGlobal("fetch", okFetch(""));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("validatePassword", () => {
  it("rejects a password shorter than the minimum", async () => {
    const result = await validatePassword("a".repeat(MIN_PASSWORD_LENGTH - 1));
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("12");
  });

  it("accepts a password exactly at the minimum", async () => {
    const result = await validatePassword("a".repeat(MIN_PASSWORD_LENGTH));
    expect(result.ok).toBe(true);
  });

  it("rejects a password longer than the maximum", async () => {
    const result = await validatePassword("a".repeat(MAX_PASSWORD_LENGTH + 1));
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("72");
  });

  it("accepts a long passphrase with no symbols or uppercase", async () => {
    const result = await validatePassword("correct horse battery staple");
    expect(result.ok).toBe(true);
  });

  it("rejects a breached password", async () => {
    // SHA-1 of "password123" is CBFDAC6008F9CAB4083784CBD1874F76618D2A97
    vi.stubGlobal("fetch", okFetch("0000000000000000000000000000000000A:1\n08F9CAB4083784CBD1874F76618D2A97:24230577"));
    const result = await validatePassword("password123!!");
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("breach");
  });
});

describe("isBreached", () => {
  it("fails open when the breach API is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    await expect(isBreached("correct horse battery staple")).resolves.toBe(false);
  });

  it("fails open on a non-200 response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    await expect(isBreached("correct horse battery staple")).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/web test password-policy`
Expected: FAIL — `Failed to resolve import "./password-policy"`.

- [ ] **Step 3: Write the implementation**

Create `app/lib/auth/password-policy.ts`:

```ts
import { createHash } from "node:crypto";

export const MIN_PASSWORD_LENGTH = 12;
/**
 * bcrypt silently truncates input at 72 bytes. Without an explicit cap, two
 * different long passphrases sharing a 72-byte prefix authenticate each other.
 * Rejecting is safer than truncating.
 */
export const MAX_PASSWORD_LENGTH = 72;

const HIBP_RANGE_URL = "https://api.pwnedpasswords.com/range";
const HIBP_TIMEOUT_MS = 2000;

export interface PasswordValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Checks the password against HaveIBeenPwned using k-anonymity: only the first
 * five characters of the SHA-1 hash are sent. The password never leaves this
 * process.
 *
 * Fails OPEN — a third-party outage must not block password changes.
 */
export async function isBreached(password: string): Promise<boolean> {
  const hash = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  try {
    const res = await fetch(`${HIBP_RANGE_URL}/${prefix}`, {
      signal: AbortSignal.timeout(HIBP_TIMEOUT_MS),
      headers: { "Add-Padding": "true" },
    });
    if (!res.ok) {
      console.warn(`[password-policy] breach check returned ${res.status}; failing open`);
      return false;
    }
    const body = await res.text();
    return body
      .split("\n")
      .some((line) => line.split(":")[0]?.trim().toUpperCase() === suffix);
  } catch (err) {
    console.warn("[password-policy] breach check unavailable; failing open", err);
    return false;
  }
}

export async function validatePassword(password: string): Promise<PasswordValidationResult> {
  const errors: string[] = [];

  if (password.length < MIN_PASSWORD_LENGTH) {
    errors.push(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    errors.push(`Password must be at most ${MAX_PASSWORD_LENGTH} characters.`);
  }

  // Only spend a network call on a password that is otherwise acceptable.
  if (errors.length === 0 && (await isBreached(password))) {
    errors.push("This password has appeared in a known data breach. Choose a different one.");
  }

  return { ok: errors.length === 0, errors };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @workspace/web test password-policy`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add app/lib/auth/password-policy.ts app/lib/auth/password-policy.test.ts
git commit -m "feat(auth): NIST-aligned password policy with breach screening"
```

---

## Task 2: TOTP secret encryption

**Files:**
- Create: `app/lib/auth/secret-crypto.ts`
- Test: `app/lib/auth/secret-crypto.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `encryptSecret(plaintext: string): string` returning `"iv:tag:ciphertext"` (all base64), `decryptSecret(payload: string): string`.

A TOTP secret is a bearer credential — unlike a password hash, anyone who reads it can mint valid codes forever. It must be encrypted, not merely stored.

- [ ] **Step 1: Write the failing test**

Create `app/lib/auth/secret-crypto.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptSecret, decryptSecret } from "./secret-crypto";

beforeAll(() => {
  process.env.TOTP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

describe("secret-crypto", () => {
  it("round-trips a secret", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it("produces different ciphertext each time (random IV)", () => {
    expect(encryptSecret("JBSWY3DPEHPK3PXP")).not.toBe(encryptSecret("JBSWY3DPEHPK3PXP"));
  });

  it("rejects a tampered ciphertext", () => {
    const payload = encryptSecret("JBSWY3DPEHPK3PXP");
    const [iv, tag, ct] = payload.split(":");
    const flipped = Buffer.from(ct, "base64");
    flipped[0] ^= 0xff;
    expect(() => decryptSecret(`${iv}:${tag}:${flipped.toString("base64")}`)).toThrow();
  });

  it("rejects a malformed payload", () => {
    expect(() => decryptSecret("not-a-valid-payload")).toThrow(/Malformed/);
  });

  it("rejects a key of the wrong length", () => {
    const original = process.env.TOTP_ENCRYPTION_KEY;
    process.env.TOTP_ENCRYPTION_KEY = Buffer.from("too-short").toString("base64");
    expect(() => encryptSecret("x")).toThrow(/32 bytes/);
    process.env.TOTP_ENCRYPTION_KEY = original;
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/web test secret-crypto`
Expected: FAIL — cannot resolve `./secret-crypto`.

- [ ] **Step 3: Write the implementation**

Create `app/lib/auth/secret-crypto.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length

function getKey(): Buffer {
  const raw = process.env.TOTP_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("TOTP_ENCRYPTION_KEY environment variable is required");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("TOTP_ENCRYPTION_KEY must decode to exactly 32 bytes (base64-encoded)");
  }
  return key;
}

/** Returns "iv:authTag:ciphertext", each segment base64. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted secret");
  }
  const [ivB64, tagB64, ctB64] = parts;
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @workspace/web test secret-crypto`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add app/lib/auth/secret-crypto.ts app/lib/auth/secret-crypto.test.ts
git commit -m "feat(auth): AES-256-GCM encryption for TOTP secrets at rest"
```

---

## Task 3: TOTP verification core

**Files:**
- Create: `app/lib/auth/totp.ts`
- Test: `app/lib/auth/totp.test.ts`
- Modify: `app/package.json`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `TOTP_PERIOD: 30`, `generateSecret(): string`, `buildOtpauthUri(secret: string, accountLabel: string): string`, `currentStep(now?: number): number`, `generateCode(secret: string, now?: number): string`, `verifyTotp(secret: string, code: string, lastStep: number | null, now?: number): { valid: boolean; step: number | null }`.

- [ ] **Step 1: Install the TOTP library**

```bash
pnpm --filter @workspace/web add otpauth@9.5.1
```

- [ ] **Step 2: Write the failing test**

Create `app/lib/auth/totp.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateSecret, buildOtpauthUri, verifyTotp, generateCode, currentStep, TOTP_PERIOD } from "./totp";

const FIXED_NOW = 1_700_000_000_000; // deterministic clock

describe("totp", () => {
  it("generates a base32 secret", () => {
    expect(generateSecret()).toMatch(/^[A-Z2-7]+$/);
  });

  it("builds an otpauth URI carrying issuer and label", () => {
    const uri = buildOtpauthUri(generateSecret(), "bilal");
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain("AdOps");
    expect(uri).toContain("bilal");
  });

  it("accepts a code generated for the current step", () => {
    const secret = generateSecret();
    const code = generateCode(secret, FIXED_NOW);
    const result = verifyTotp(secret, code, null, FIXED_NOW);
    expect(result.valid).toBe(true);
    expect(result.step).toBe(currentStep(FIXED_NOW));
  });

  it("accepts a code from one step earlier (clock drift)", () => {
    const secret = generateSecret();
    const code = generateCode(secret, FIXED_NOW - TOTP_PERIOD * 1000);
    expect(verifyTotp(secret, code, null, FIXED_NOW).valid).toBe(true);
  });

  it("rejects a code from far outside the window", () => {
    const secret = generateSecret();
    const code = generateCode(secret, FIXED_NOW - 10 * TOTP_PERIOD * 1000);
    expect(verifyTotp(secret, code, null, FIXED_NOW).valid).toBe(false);
  });

  it("rejects a wrong code", () => {
    expect(verifyTotp(generateSecret(), "000000", null, FIXED_NOW).valid).toBe(false);
  });

  it("rejects replay of an already-consumed step", () => {
    const secret = generateSecret();
    const code = generateCode(secret, FIXED_NOW);
    const first = verifyTotp(secret, code, null, FIXED_NOW);
    expect(first.valid).toBe(true);
    // Same code, same 30s window, but the step is now recorded as consumed.
    expect(verifyTotp(secret, code, first.step, FIXED_NOW).valid).toBe(false);
  });

  it("rejects a code for a step at or below the recorded step", () => {
    const secret = generateSecret();
    const code = generateCode(secret, FIXED_NOW);
    expect(verifyTotp(secret, code, currentStep(FIXED_NOW) + 5, FIXED_NOW).valid).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @workspace/web test totp`
Expected: FAIL — cannot resolve `./totp`.

- [ ] **Step 4: Write the implementation**

Create `app/lib/auth/totp.ts`:

```ts
import * as OTPAuth from "otpauth";

export const TOTP_PERIOD = 30;
const TOTP_DIGITS = 6;
const TOTP_ALGORITHM = "SHA1"; // what authenticator apps actually implement
const ISSUER = "AdOps Intelligence";
/** ±1 step of tolerance for clock drift between server and phone. */
const DRIFT_WINDOW = 1;

export function generateSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

function buildTotp(secret: string, accountLabel: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label: accountLabel,
    algorithm: TOTP_ALGORITHM,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}

export function buildOtpauthUri(secret: string, accountLabel: string): string {
  return buildTotp(secret, accountLabel).toString();
}

/** The TOTP time step for a given wall-clock time. */
export function currentStep(now: number = Date.now()): number {
  return Math.floor(now / 1000 / TOTP_PERIOD);
}

/** Only used by tests and never by production code. */
export function generateCode(secret: string, now: number = Date.now()): string {
  return buildTotp(secret, "test").generate({ timestamp: now });
}

/**
 * Verifies a code and returns the time step it belongs to, so the caller can
 * record it. `lastStep` is the most recently consumed step for this user;
 * any code at or below it is a replay and is rejected even if cryptographically
 * valid, because a code stays valid for the remainder of its 30-second window.
 */
export function verifyTotp(
  secret: string,
  code: string,
  lastStep: number | null,
  now: number = Date.now(),
): { valid: boolean; step: number | null } {
  const normalized = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) return { valid: false, step: null };

  const delta = buildTotp(secret, "verify").validate({
    token: normalized,
    window: DRIFT_WINDOW,
    timestamp: now,
  });
  if (delta === null) return { valid: false, step: null };

  const step = currentStep(now) + delta;
  if (lastStep !== null && step <= lastStep) return { valid: false, step: null };

  return { valid: true, step };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @workspace/web test totp`
Expected: PASS — 8 tests.

- [ ] **Step 6: Commit**

```bash
git add app/package.json ../pnpm-lock.yaml app/lib/auth/totp.ts app/lib/auth/totp.test.ts
git commit -m "feat(auth): TOTP verification with drift window and replay guard"
```

---

## Task 4: Backup codes and temporary passwords

**Files:**
- Create: `app/lib/auth/credentials.ts`
- Test: `app/lib/auth/credentials.test.ts`

**Interfaces:**
- Consumes: `MIN_PASSWORD_LENGTH` from `app/lib/auth/password-policy.ts` (Task 1).
- Produces: `generateBackupCodes(count?: number): string[]` (format `XXXX-XXXX`), `hashBackupCode(code: string): Promise<string>`, `verifyBackupCode(code: string, hash: string): Promise<boolean>`, `normalizeBackupCode(code: string): string`, `generateTempPassword(length?: number): string`.

- [ ] **Step 1: Write the failing test**

Create `app/lib/auth/credentials.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  generateBackupCodes,
  hashBackupCode,
  verifyBackupCode,
  normalizeBackupCode,
  generateTempPassword,
} from "./credentials";
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from "./password-policy";

describe("backup codes", () => {
  it("generates ten unique codes by default", () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
  });

  it("formats codes as XXXX-XXXX with no ambiguous characters", () => {
    for (const code of generateBackupCodes()) {
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    }
  });

  it("round-trips hash and verify", async () => {
    const [code] = generateBackupCodes(1);
    const hash = await hashBackupCode(code);
    await expect(verifyBackupCode(code, hash)).resolves.toBe(true);
  });

  it("rejects a different code", async () => {
    const [a, b] = generateBackupCodes(2);
    await expect(verifyBackupCode(b, await hashBackupCode(a))).resolves.toBe(false);
  });

  it("verifies regardless of case, spaces, or dashes", async () => {
    const [code] = generateBackupCodes(1);
    const hash = await hashBackupCode(code);
    const messy = ` ${code.toLowerCase().replace("-", " ")} `;
    await expect(verifyBackupCode(messy, hash)).resolves.toBe(true);
  });

  it("normalizes to uppercase without separators", () => {
    expect(normalizeBackupCode(" ab2c-d3ef ")).toBe("AB2CD3EF");
  });
});

describe("temp passwords", () => {
  it("satisfies the length policy", () => {
    const pw = generateTempPassword();
    expect(pw.length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
    expect(pw.length).toBeLessThanOrEqual(MAX_PASSWORD_LENGTH);
  });

  it("is different every time", () => {
    const generated = new Set(Array.from({ length: 50 }, () => generateTempPassword()));
    expect(generated.size).toBe(50);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/web test credentials`
Expected: FAIL — cannot resolve `./credentials`.

- [ ] **Step 3: Write the implementation**

Create `app/lib/auth/credentials.ts`:

```ts
import { randomBytes, randomInt } from "node:crypto";
import bcrypt from "bcryptjs";

/**
 * 32 characters, excluding I, O, 0 and 1 so users cannot mistranscribe them.
 * Exactly 32 divides 256, so `byte % 32` introduces no modulo bias.
 */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const BACKUP_CODE_COUNT = 10;
const BCRYPT_ROUNDS = 12;

const TEMP_PASSWORD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const TEMP_PASSWORD_LENGTH = 16; // comfortably above the 12-char minimum

export function generateBackupCodes(count: number = BACKUP_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    const bytes = randomBytes(8);
    const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
    codes.add(`${chars.slice(0, 4)}-${chars.slice(4, 8)}`);
  }
  return [...codes];
}

/** Strips spaces and dashes and uppercases, so user transcription is forgiving. */
export function normalizeBackupCode(code: string): string {
  return code.replace(/[\s-]/g, "").toUpperCase();
}

export function hashBackupCode(code: string): Promise<string> {
  return bcrypt.hash(normalizeBackupCode(code), BCRYPT_ROUNDS);
}

export function verifyBackupCode(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(normalizeBackupCode(code), hash);
}

/** `randomInt` is rejection-sampled, so this is unbiased across the alphabet. */
export function generateTempPassword(length: number = TEMP_PASSWORD_LENGTH): string {
  return Array.from(
    { length },
    () => TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)],
  ).join("");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @workspace/web test credentials`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add app/lib/auth/credentials.ts app/lib/auth/credentials.test.ts
git commit -m "feat(auth): backup code and temporary password generation"
```

---

## Task 5: Database schema and migration

**Files:**
- Modify: `lib/db/src/schema/auth.ts`
- Create: `lib/db/migrations/0008_auth_hardening.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `usersTable` gains `username`, `mustChangePassword`, `passwordChangedAt`, `tokenVersion`, `twoFactorSecret`, `twoFactorEnabledAt`, `twoFactorFailedAttempts`, `twoFactorLockedUntil`, `lastTotpStep`. New `userBackupCodesTable` with `id`, `userId`, `codeHash`, `usedAt`, `createdAt`, exported from `@workspace/db`.

- [ ] **Step 1: Extend the Drizzle schema**

In `lib/db/src/schema/auth.ts`, replace the import line and the `usersTable` definition, then append the new table. The full replacement for lines 1 and 18-31:

```ts
import { pgTable, text, serial, timestamp, boolean, jsonb, integer, bigint } from "drizzle-orm/pg-core";
```

```ts
export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull(),
  isSystem: boolean("is_system").notNull().default(false),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
  tokenVersion: integer("token_version").notNull().default(0),
  twoFactorSecret: text("two_factor_secret"),
  twoFactorEnabledAt: timestamp("two_factor_enabled_at", { withTimezone: true }),
  twoFactorFailedAttempts: integer("two_factor_failed_attempts").notNull().default(0),
  twoFactorLockedUntil: timestamp("two_factor_locked_until", { withTimezone: true }),
  lastTotpStep: bigint("last_totp_step", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

export const userBackupCodesTable = pgTable("user_backup_codes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserBackupCode = typeof userBackupCodesTable.$inferSelect;
```

- [ ] **Step 2: Write the migration**

Create `lib/db/migrations/0008_auth_hardening.sql`:

```sql
-- Auth hardening: username login, TOTP 2FA, password lifecycle, session revocation.

-- 1. Username. Added nullable, backfilled from email, then constrained.
--    Safe because email is already UNIQUE, so no collision is possible.
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
```

- [ ] **Step 3: Apply the schema to the database**

Run: `pnpm --filter @workspace/db push`
Expected: drizzle-kit reports the new columns and table applied with no data loss warnings.

- [ ] **Step 4: Verify the typecheck passes**

Run: `pnpm typecheck`
Expected: PASS. If `app/app/api/users/route.ts` errors on a missing `username` in an insert, leave it — Task 13 fixes that file. If it blocks, temporarily note it and proceed; do not patch it here.

- [ ] **Step 5: Commit**

```bash
git add lib/db/src/schema/auth.ts lib/db/migrations/0008_auth_hardening.sql
git commit -m "feat(db): auth hardening schema — username, 2FA, token version, backup codes"
```

---

## Task 6: Challenge tokens and session token versioning

**Files:**
- Modify: `app/lib/auth/jwt.ts`
- Modify: `app/lib/auth/cookies.ts`
- Test: `app/lib/auth/jwt.test.ts` (extend existing)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `SessionUser` gains `username: string` and `tokenVersion: number`. New: `ChallengePurpose = "totp" | "password_change" | "totp_enroll"`, `signChallenge(sub: number, purpose: ChallengePurpose, totpDone?: boolean): Promise<string>`, `verifyChallenge(token: string, expected: ChallengePurpose): Promise<{ sub: number; purpose: ChallengePurpose; totpDone: boolean }>`, `CHALLENGE_TTL_SECONDS: Record<ChallengePurpose, number>`. From cookies: `CHALLENGE_COOKIE = "adops-challenge"`, `buildChallengeCookieOptions(maxAge: number, nodeEnv?: string)`.

**This task contains the single most important security rule in the plan:** `verifySession` must reject any token carrying a `purpose` claim. Without it, a challenge token issued *before* the second factor is verified could be replayed as a session cookie, reducing 2FA to a no-op.

- [ ] **Step 1: Write the failing tests**

Append to `app/lib/auth/jwt.test.ts`:

```ts
import { signChallenge, verifyChallenge, signSession, verifySession } from "./jwt";

describe("challenge tokens", () => {
  const user = {
    sub: 7,
    name: "Bilal",
    username: "bilal",
    email: "bilal@advengers.com",
    role: "System Admin",
    isSystem: true,
    tokenVersion: 3,
  };

  it("round-trips a challenge token", async () => {
    const token = await signChallenge(7, "totp");
    const claims = await verifyChallenge(token, "totp");
    expect(claims.sub).toBe(7);
    expect(claims.purpose).toBe("totp");
    expect(claims.totpDone).toBe(false);
  });

  it("carries the totpDone flag", async () => {
    const token = await signChallenge(7, "password_change", true);
    await expect(verifyChallenge(token, "password_change")).resolves.toMatchObject({ totpDone: true });
  });

  it("rejects a challenge token verified against the wrong purpose", async () => {
    const token = await signChallenge(7, "totp");
    await expect(verifyChallenge(token, "password_change")).rejects.toThrow();
  });

  it("rejects an expired challenge token", async () => {
    vi.useFakeTimers();
    try {
      const token = await signChallenge(7, "totp"); // 5 minute TTL
      vi.setSystemTime(Date.now() + 6 * 60 * 1000);
      await expect(verifyChallenge(token, "totp")).rejects.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it("CRITICAL: a challenge token cannot be used as a session", async () => {
    const token = await signChallenge(7, "totp");
    await expect(verifySession(token)).rejects.toThrow(/purpose|challenge/i);
  });

  it("a real session token is not accepted as a challenge", async () => {
    const token = await signSession(user);
    await expect(verifyChallenge(token, "totp")).rejects.toThrow();
  });

  it("round-trips tokenVersion and username on a session", async () => {
    const decoded = await verifySession(await signSession(user));
    expect(decoded.tokenVersion).toBe(3);
    expect(decoded.username).toBe("bilal");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @workspace/web test jwt`
Expected: FAIL — `signChallenge` is not exported.

- [ ] **Step 3: Add the challenge cookie**

Append to `app/lib/auth/cookies.ts`:

```ts
export const CHALLENGE_COOKIE = "adops-challenge";

/** Same protections as the session cookie, but scoped to the challenge TTL. */
export function buildChallengeCookieOptions(
  maxAgeSeconds: number,
  nodeEnv: string = process.env.NODE_ENV ?? "development",
): CookieOptions {
  return buildCookieOptions({ maxAge: maxAgeSeconds }, nodeEnv);
}
```

- [ ] **Step 4: Rewrite `app/lib/auth/jwt.ts`**

```ts
import { SignJWT, jwtVerify } from "jose";

export interface SessionUser {
  sub: number;
  name: string;
  username: string;
  email: string;
  role: string;
  isSystem: boolean;
  tokenVersion: number;
}

export type ChallengePurpose = "totp" | "password_change" | "totp_enroll";

export const CHALLENGE_TTL_SECONDS: Record<ChallengePurpose, number> = {
  totp: 5 * 60,
  password_change: 10 * 60,
  totp_enroll: 10 * 60,
};

export interface ChallengeClaims {
  sub: number;
  purpose: ChallengePurpose;
  /** True once the second factor has been satisfied earlier in this login. */
  totpDone: boolean;
}

function getSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required");
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({
    name: user.name,
    username: user.username,
    email: user.email,
    role: user.role,
    isSystem: user.isSystem,
    tokenVersion: user.tokenVersion,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.sub))
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(getSecretKey());
}

export async function verifySession(token: string): Promise<SessionUser> {
  const { payload } = await jwtVerify(token, getSecretKey(), { algorithms: ["HS256"] });

  // A challenge token is issued BEFORE the second factor is verified. Accepting
  // one here would let a caller skip 2FA entirely by presenting it as a session
  // cookie. This check is the boundary between half-authenticated and
  // authenticated — do not remove it.
  if ("purpose" in payload) {
    throw new Error("Challenge token cannot be used as a session");
  }

  return {
    sub: Number(payload.sub),
    name: String(payload.name),
    username: String(payload.username),
    email: String(payload.email),
    role: String(payload.role),
    isSystem: Boolean(payload.isSystem),
    tokenVersion: Number(payload.tokenVersion ?? 0),
  };
}

export async function signChallenge(
  sub: number,
  purpose: ChallengePurpose,
  totpDone = false,
): Promise<string> {
  return new SignJWT({ purpose, totpDone })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(sub))
    .setIssuedAt()
    .setExpirationTime(`${CHALLENGE_TTL_SECONDS[purpose]}s`)
    .sign(getSecretKey());
}

export async function verifyChallenge(
  token: string,
  expected: ChallengePurpose,
): Promise<ChallengeClaims> {
  const { payload } = await jwtVerify(token, getSecretKey(), { algorithms: ["HS256"] });
  if (payload.purpose !== expected) {
    throw new Error("Challenge purpose mismatch");
  }
  return {
    sub: Number(payload.sub),
    purpose: expected,
    totpDone: Boolean(payload.totpDone),
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @workspace/web test jwt cookies`
Expected: PASS. Pre-existing `jwt.test.ts` cases that build a `SessionUser` without `username`/`tokenVersion` will now fail typecheck — add `username: "admin"` and `tokenVersion: 0` to those fixtures.

- [ ] **Step 6: Commit**

```bash
git add app/lib/auth/jwt.ts app/lib/auth/jwt.test.ts app/lib/auth/cookies.ts
git commit -m "feat(auth): challenge tokens and session token versioning"
```

---

## Task 7: Enforce token version on guarded routes

**Files:**
- Modify: `app/lib/auth/require.ts`
- Test: `app/lib/auth/require.test.ts` (extend existing)

**Interfaces:**
- Consumes: `SessionUser` with `tokenVersion` (Task 6), `usersTable.tokenVersion` (Task 5).
- Produces: `requireAuth()`, `requireAdmin()`, `requirePermission()` all reject a session whose `tokenVersion` no longer matches the database.

Edge middleware stays stateless — a revoked session survives page navigation momentarily but dies at the first API call, which is where anything consequential happens.

- [ ] **Step 1: Write the failing test**

Append to `app/lib/auth/require.test.ts` (match the existing mock style in that file; if it mocks `./session`, extend that mock rather than adding a second one):

```ts
describe("token version enforcement", () => {
  it("rejects a session whose tokenVersion is stale", async () => {
    mockSession({ sub: 1, name: "A", username: "a", email: "a@x.com", role: "System Admin", isSystem: true, tokenVersion: 1 });
    mockDbUserRow({ tokenVersion: 2 }); // password was changed since this token was issued
    const result = await requireAuth();
    expect(isAuthError(result)).toBe(true);
    expect((result as Response).status).toBe(401);
  });

  it("accepts a session whose tokenVersion matches", async () => {
    mockSession({ sub: 1, name: "A", username: "a", email: "a@x.com", role: "System Admin", isSystem: true, tokenVersion: 2 });
    mockDbUserRow({ tokenVersion: 2 });
    const result = await requireAuth();
    expect(isAuthError(result)).toBe(false);
  });

  it("rejects when the user row no longer exists", async () => {
    mockSession({ sub: 99, name: "A", username: "a", email: "a@x.com", role: "Viewer", isSystem: false, tokenVersion: 0 });
    mockDbUserRow(null);
    expect(isAuthError(await requireAuth())).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/web test require`
Expected: FAIL — stale versions are currently accepted.

- [ ] **Step 3: Rewrite `app/lib/auth/require.ts`**

```ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { getSession } from "./session";
import type { SessionUser } from "./jwt";
import { getRolePermissions } from "@/lib/rbac/role-permissions";
import { effectivePermissions } from "@/lib/rbac/can";
import type { Permission } from "@/lib/rbac/catalog";

type AuthResult = { user: SessionUser } | Response;

const unauthenticated = () =>
  NextResponse.json({ error: "Authentication required" }, { status: 401 });

/**
 * Sessions are stateless JWTs, so revocation works by comparing the token's
 * tokenVersion against the database. Bumped on password change, admin password
 * reset, 2FA reset and 2FA disable — any of which must kill live sessions.
 *
 * This is one indexed primary-key lookup; these guards already query the
 * database for role permissions, so it adds no round trip in practice.
 */
async function isCurrentSession(user: SessionUser): Promise<boolean> {
  const [row] = await db
    .select({ tokenVersion: usersTable.tokenVersion })
    .from(usersTable)
    .where(eq(usersTable.id, user.sub));
  return Boolean(row) && row.tokenVersion === user.tokenVersion;
}

/** Resolves the session and verifies it has not been revoked. */
async function getLiveSession(): Promise<SessionUser | null> {
  const user = await getSession();
  if (!user) return null;
  return (await isCurrentSession(user)) ? user : null;
}

export async function requireAuth(): Promise<AuthResult> {
  const user = await getLiveSession();
  if (!user) return unauthenticated();
  return { user };
}

export async function requireAdmin(): Promise<AuthResult> {
  const user = await getLiveSession();
  if (!user) return unauthenticated();
  if (user.role !== "System Admin" && !user.isSystem)
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  return { user };
}

export async function requirePermission(perm: Permission): Promise<AuthResult> {
  const user = await getLiveSession();
  if (!user) return unauthenticated();
  const rolePerms = await getRolePermissions(user.role);
  const eff = effectivePermissions({ role: user.role, isSystem: user.isSystem }, rolePerms);
  if (!eff.has(perm)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return { user };
}

export function isAuthError(result: AuthResult): result is Response {
  return result instanceof Response;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @workspace/web test require`
Expected: PASS. Existing cases in this file need `username` and `tokenVersion` added to their session fixtures, plus a `mockDbUserRow` returning a matching version.

- [ ] **Step 5: Commit**

```bash
git add app/lib/auth/require.ts app/lib/auth/require.test.ts
git commit -m "feat(auth): enforce token version on all guarded routes"
```

---

## Task 8: The login step resolver

**Files:**
- Create: `app/lib/auth/next-step.ts`
- Test: `app/lib/auth/next-step.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `NextStep = "totp" | "password_change" | "enroll_2fa" | "session"`, `resolveNextStep(user: StepUser, isPrivileged: boolean, totpDone: boolean): NextStep`, `isPrivileged(role: string, isSystem: boolean, rolePermissions: string[]): boolean`, and `StepUser` (`{ mustChangePassword: boolean; twoFactorEnabledAt: Date | null }`).

**Ordering is deliberate and TOTP comes first.** When an admin resets the password of a user who already has 2FA, the temporary password is handed over out-of-band and may be intercepted. If password-change ran first, whoever holds that temp password could set a new one and lock out the real owner without ever proving possession of the second factor.

- [ ] **Step 1: Write the failing test**

Create `app/lib/auth/next-step.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveNextStep, isPrivileged } from "./next-step";

const enrolled = { mustChangePassword: false, twoFactorEnabledAt: new Date() };
const notEnrolled = { mustChangePassword: false, twoFactorEnabledAt: null };

describe("resolveNextStep", () => {
  it("demands TOTP for an enrolled user", () => {
    expect(resolveNextStep(enrolled, false, false)).toBe("totp");
  });

  it("demands TOTP before a password change, even when both are pending", () => {
    const user = { mustChangePassword: true, twoFactorEnabledAt: new Date() };
    expect(resolveNextStep(user, false, false)).toBe("totp");
  });

  it("moves to password change once TOTP is satisfied", () => {
    const user = { mustChangePassword: true, twoFactorEnabledAt: new Date() };
    expect(resolveNextStep(user, false, true)).toBe("password_change");
  });

  it("issues a session once TOTP is satisfied and nothing else is pending", () => {
    expect(resolveNextStep(enrolled, false, true)).toBe("session");
  });

  it("demands a password change for an unenrolled user with a temp password", () => {
    expect(resolveNextStep({ mustChangePassword: true, twoFactorEnabledAt: null }, false, false)).toBe("password_change");
  });

  it("forces enrolment for a privileged user without 2FA", () => {
    expect(resolveNextStep(notEnrolled, true, false)).toBe("enroll_2fa");
  });

  it("does not force enrolment for a non-privileged user", () => {
    expect(resolveNextStep(notEnrolled, false, false)).toBe("session");
  });

  it("puts the password change before enrolment for a privileged user with a temp password", () => {
    expect(resolveNextStep({ mustChangePassword: true, twoFactorEnabledAt: null }, true, false)).toBe("password_change");
  });
});

describe("isPrivileged", () => {
  it("is true for isSystem", () => {
    expect(isPrivileged("Viewer", true, [])).toBe(true);
  });
  it("is true for the System Admin role", () => {
    expect(isPrivileged("System Admin", false, [])).toBe(true);
  });
  it("is true for a role holding settings.users:manage", () => {
    expect(isPrivileged("Ops Lead", false, ["settings.users:manage"])).toBe(true);
  });
  it("is false for an ordinary role", () => {
    expect(isPrivileged("Viewer", false, ["clients:view"])).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/web test next-step`
Expected: FAIL — cannot resolve `./next-step`.

- [ ] **Step 3: Write the implementation**

Create `app/lib/auth/next-step.ts`:

```ts
import { effectivePermissions } from "@/lib/rbac/can";

export type NextStep = "totp" | "password_change" | "enroll_2fa" | "session";

export interface StepUser {
  mustChangePassword: boolean;
  twoFactorEnabledAt: Date | null;
}

/** 2FA is mandatory for these users. Single definition — do not re-derive it. */
export function isPrivileged(role: string, isSystem: boolean, rolePermissions: string[]): boolean {
  return effectivePermissions({ role, isSystem }, rolePermissions).has("settings.users:manage");
}

/**
 * The single source of truth for login ordering. Called by the login route and
 * by every challenge-completion route, so finishing one step routes correctly
 * to the next.
 *
 * `totpDone` suppresses the TOTP branch once the second factor has been
 * satisfied in this login; without it an enrolled user would loop on "totp"
 * forever, since twoFactorEnabledAt stays set.
 */
export function resolveNextStep(
  user: StepUser,
  privileged: boolean,
  totpDone: boolean,
): NextStep {
  // 1. Second factor first — see the note in the plan on intercepted temp passwords.
  if (user.twoFactorEnabledAt && !totpDone) return "totp";
  // 2. Then any forced password change.
  if (user.mustChangePassword) return "password_change";
  // 3. Then enrolment, for privileged users who have not set up 2FA.
  if (privileged && !user.twoFactorEnabledAt) return "enroll_2fa";
  return "session";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @workspace/web test next-step`
Expected: PASS — 12 tests.

- [ ] **Step 5: Commit**

```bash
git add app/lib/auth/next-step.ts app/lib/auth/next-step.test.ts
git commit -m "feat(auth): login step resolver with TOTP-first ordering"
```

---

## Task 9: Rewrite the login route

**Files:**
- Modify: `app/app/api/users/login/route.ts`
- Modify: `app/app/api/users/login/route.test.ts`
- Create: `app/lib/auth/session-issue.ts`

**Interfaces:**
- Consumes: `resolveNextStep`, `isPrivileged` (Task 8); `signSession`, `signChallenge`, `CHALLENGE_TTL_SECONDS` (Task 6); `CHALLENGE_COOKIE`, `buildChallengeCookieOptions` (Task 6); `getRolePermissions`.
- Produces: `app/lib/auth/session-issue.ts` exporting `issueSession(user: User): Promise<NextResponse>` and `issueChallenge(userId: number, step: Exclude<NextStep, "session">, totpDone: boolean): Promise<NextResponse>`, reused by Tasks 10-12. Also `app/lib/auth/actor.ts` exporting `readChallengeCookie(req: Request): string | null`, extended in Task 11. Login responds `{ next }` + challenge cookie, or `{ user }` + session cookie.

- [ ] **Step 1: Write the shared response helper**

Create `app/lib/auth/session-issue.ts`:

```ts
import { NextResponse } from "next/server";
import type { User } from "@workspace/db";
import { signSession, signChallenge, CHALLENGE_TTL_SECONDS, type ChallengePurpose } from "./jwt";
import { SESSION_COOKIE, CHALLENGE_COOKIE, buildCookieOptions, buildChallengeCookieOptions } from "./cookies";
import type { NextStep } from "./next-step";

/** Maps a pending step onto the challenge purpose that gates it. */
const STEP_PURPOSE: Record<Exclude<NextStep, "session">, ChallengePurpose> = {
  totp: "totp",
  password_change: "password_change",
  enroll_2fa: "totp_enroll",
};

/** Issues the real session cookie and clears any in-flight challenge. */
export async function issueSession(user: User): Promise<NextResponse> {
  const token = await signSession({
    sub: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    role: user.role,
    isSystem: user.isSystem,
    tokenVersion: user.tokenVersion,
  });

  const res = NextResponse.json({
    next: "session",
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      role: user.role,
      isSystem: user.isSystem,
    },
  });
  res.cookies.set(SESSION_COOKIE, token, buildCookieOptions());
  res.cookies.set(CHALLENGE_COOKIE, "", buildChallengeCookieOptions(0));
  return res;
}

/** Issues a short-lived challenge cookie. Never sets the session cookie. */
export async function issueChallenge(
  userId: number,
  step: Exclude<NextStep, "session">,
  totpDone: boolean,
): Promise<NextResponse> {
  const purpose = STEP_PURPOSE[step];
  const token = await signChallenge(userId, purpose, totpDone);
  const res = NextResponse.json({ next: step });
  res.cookies.set(CHALLENGE_COOKIE, token, buildChallengeCookieOptions(CHALLENGE_TTL_SECONDS[purpose]));
  return res;
}
```

- [ ] **Step 2: Write the failing tests**

Replace `app/app/api/users/login/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const selectMock = vi.fn();
const compareMock = vi.fn();

vi.mock("@workspace/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => selectMock() }) }) },
  usersTable: { username: "username", id: "id", tokenVersion: "token_version" },
}));

vi.mock("bcryptjs", () => ({ default: { compare: (...a: unknown[]) => compareMock(...a) } }));

vi.mock("@/lib/rbac/role-permissions", () => ({
  getRolePermissions: vi.fn(async () => []),
}));

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret-at-least-32-chars-long-xxxxx";
  delete process.env.UPSTASH_REDIS_REST_URL;
});

beforeEach(() => {
  selectMock.mockReset();
  compareMock.mockReset();
  compareMock.mockResolvedValue(false);
});

const baseUser = {
  id: 1,
  name: "Admin",
  username: "admin",
  email: "admin@advengers.com",
  password: "hash",
  role: "Viewer",
  isSystem: false,
  tokenVersion: 0,
  mustChangePassword: false,
  twoFactorEnabledAt: null,
};

async function call(body: unknown) {
  const { POST } = await import("./route");
  return POST(new Request("http://localhost/api/users/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

describe("POST /api/users/login", () => {
  it("issues a session when nothing is pending", async () => {
    selectMock.mockResolvedValueOnce([baseUser]);
    compareMock.mockResolvedValue(true);
    const res = await call({ username: "admin", password: "right" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ next: "session" });
    expect(res.headers.get("set-cookie")).toContain("adops-session=");
  });

  it("returns a totp challenge WITHOUT a session cookie for an enrolled user", async () => {
    selectMock.mockResolvedValueOnce([{ ...baseUser, twoFactorEnabledAt: new Date() }]);
    compareMock.mockResolvedValue(true);
    const res = await call({ username: "admin", password: "right" });
    expect(await res.json()).toMatchObject({ next: "totp" });
    const cookies = res.headers.get("set-cookie") ?? "";
    expect(cookies).toContain("adops-challenge=");
    expect(cookies).not.toContain("adops-session=ey"); // no real session issued
  });

  it("returns a password_change challenge for a temp password", async () => {
    selectMock.mockResolvedValueOnce([{ ...baseUser, mustChangePassword: true }]);
    compareMock.mockResolvedValue(true);
    expect(await (await call({ username: "admin", password: "temp" })).json())
      .toMatchObject({ next: "password_change" });
  });

  it("forces enrolment for a privileged user without 2FA", async () => {
    selectMock.mockResolvedValueOnce([{ ...baseUser, isSystem: true }]);
    compareMock.mockResolvedValue(true);
    expect(await (await call({ username: "admin", password: "right" })).json())
      .toMatchObject({ next: "enroll_2fa" });
  });

  it("lowercases the submitted username", async () => {
    selectMock.mockResolvedValueOnce([baseUser]);
    compareMock.mockResolvedValue(true);
    await call({ username: "  ADMIN  ", password: "right" });
    expect(compareMock).toHaveBeenCalled();
  });

  it("returns 401 on a wrong password", async () => {
    selectMock.mockResolvedValueOnce([baseUser]);
    expect((await call({ username: "admin", password: "wrong" })).status).toBe(401);
  });

  it("still runs a bcrypt compare when no user matches (timing)", async () => {
    selectMock.mockResolvedValueOnce([]);
    const res = await call({ username: "nobody", password: "whatever" });
    expect(res.status).toBe(401);
    expect(compareMock).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when fields are missing", async () => {
    expect((await call({ username: "" })).status).toBe(400);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @workspace/web test users/login`
Expected: FAIL — the route still reads `email` and never issues a challenge.

- [ ] **Step 4: Rewrite `app/app/api/users/login/route.ts`**

```ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { getRolePermissions } from "@/lib/rbac/role-permissions";
import { resolveNextStep, isPrivileged } from "@/lib/auth/next-step";
import { issueSession, issueChallenge } from "@/lib/auth/session-issue";

export const runtime = "nodejs";

/**
 * A valid bcrypt hash of a random string. Compared against when no user matches
 * so that "unknown username" and "wrong password" take the same time — without
 * this, response latency reveals which usernames exist.
 */
const DUMMY_HASH = "$2b$12$p1fh4OYbcwEjLqRDnLgGEOl6OLRq3yx1DjWpmsvdmJVehoewnZSq.";

const INVALID = () => NextResponse.json({ error: "Invalid credentials" }, { status: 401 });

export async function POST(req: Request): Promise<Response> {
  if (!process.env.JWT_SECRET) {
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { success } = await checkRateLimit("login", ip);
  if (!success) {
    return NextResponse.json(
      { error: "Too many login attempts. Please try again in 15 minutes." },
      { status: 429 },
    );
  }

  let body: { username?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const username = String(body.username ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!username || !password) {
    return NextResponse.json({ error: "username and password are required" }, { status: 400 });
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, username));

  // Always run one compare, even for an unknown username.
  const isValid = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);
  if (!user || !isValid) return INVALID();

  const rolePerms = await getRolePermissions(user.role);
  const privileged = isPrivileged(user.role, user.isSystem, rolePerms);
  const step = resolveNextStep(user, privileged, false);

  if (step === "session") return issueSession(user);
  return issueChallenge(user.id, step, false);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @workspace/web test users/login`
Expected: PASS — 8 tests.

- [ ] **Step 6: Commit**

```bash
git add app/app/api/users/login/route.ts app/app/api/users/login/route.test.ts app/lib/auth/session-issue.ts
git commit -m "feat(auth): username login with challenge-based 2FA gating"
```

---

## Task 10: TOTP verification endpoint

**Files:**
- Create: `app/app/api/users/login/2fa/route.ts`
- Test: `app/app/api/users/login/2fa/route.test.ts`

**Interfaces:**
- Consumes: `verifyChallenge` (Task 6), `verifyTotp` (Task 3), `decryptSecret` (Task 2), `verifyBackupCode` (Task 4), `resolveNextStep`/`isPrivileged` (Task 8), `issueSession`/`issueChallenge` (Task 9), `userBackupCodesTable` (Task 5).
- Produces: `POST /api/users/login/2fa` accepting `{ code }` with the `totp` challenge cookie.

**Brute-force protection is database-backed, not Redis-backed.** A six-digit code is one million possibilities, and `checkRateLimit` fails *open* when Upstash is unconfigured (`app/lib/rate-limit.ts:43`) — relying on it would leave 2FA unprotected in exactly the misconfiguration case that matters. Five failures sets a 15-minute lock on the user row.

- [ ] **Step 1: Write the failing test**

Create `app/app/api/users/login/2fa/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const userRow = vi.fn();
const backupRows = vi.fn(() => []);
const updateSet = vi.fn();

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: (t: unknown) => ({ where: () => (t === "backup" ? backupRows() : userRow()) }) }),
    update: () => ({ set: (v: unknown) => { updateSet(v); return { where: async () => undefined }; } }),
    delete: () => ({ where: async () => undefined }),
    insert: () => ({ values: async () => undefined }),
  },
  usersTable: "users",
  userBackupCodesTable: "backup",
}));

vi.mock("@/lib/rbac/role-permissions", () => ({ getRolePermissions: vi.fn(async () => []) }));
vi.mock("@/lib/auth/secret-crypto", () => ({ decryptSecret: (s: string) => s }));

const verifyTotpMock = vi.fn();
vi.mock("@/lib/auth/totp", () => ({ verifyTotp: (...a: unknown[]) => verifyTotpMock(...a) }));

beforeAll(() => { process.env.JWT_SECRET = "test-secret-at-least-32-chars-long-xxxxx"; });

const enrolledUser = {
  id: 1, name: "Admin", username: "admin", email: "a@x.com", password: "h",
  role: "Viewer", isSystem: false, tokenVersion: 0, mustChangePassword: false,
  twoFactorEnabledAt: new Date(), twoFactorSecret: "SECRET",
  twoFactorFailedAttempts: 0, twoFactorLockedUntil: null, lastTotpStep: null,
};

async function call(code: string, challengeToken: string) {
  const { POST } = await import("./route");
  return POST(new Request("http://localhost/api/users/login/2fa", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `adops-challenge=${challengeToken}` },
    body: JSON.stringify({ code }),
  }));
}

async function challengeFor(sub: number) {
  const { signChallenge } = await import("@/lib/auth/jwt");
  return signChallenge(sub, "totp");
}

beforeEach(() => {
  userRow.mockReset(); backupRows.mockReset(); updateSet.mockReset(); verifyTotpMock.mockReset();
  backupRows.mockReturnValue([]);
});

describe("POST /api/users/login/2fa", () => {
  it("issues a session on a valid code", async () => {
    userRow.mockReturnValue([enrolledUser]);
    verifyTotpMock.mockReturnValue({ valid: true, step: 100 });
    const res = await call("123456", await challengeFor(1));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("adops-session=");
  });

  it("records the consumed step to block replay", async () => {
    userRow.mockReturnValue([enrolledUser]);
    verifyTotpMock.mockReturnValue({ valid: true, step: 100 });
    await call("123456", await challengeFor(1));
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ lastTotpStep: 100 }));
  });

  it("rejects an invalid code and increments the failure counter", async () => {
    userRow.mockReturnValue([enrolledUser]);
    verifyTotpMock.mockReturnValue({ valid: false, step: null });
    const res = await call("000000", await challengeFor(1));
    expect(res.status).toBe(401);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ twoFactorFailedAttempts: 1 }));
  });

  it("locks the account on the fifth failure", async () => {
    userRow.mockReturnValue([{ ...enrolledUser, twoFactorFailedAttempts: 4 }]);
    verifyTotpMock.mockReturnValue({ valid: false, step: null });
    await call("000000", await challengeFor(1));
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ twoFactorLockedUntil: expect.any(Date) }),
    );
  });

  it("returns 429 while locked out", async () => {
    userRow.mockReturnValue([{
      ...enrolledUser,
      twoFactorLockedUntil: new Date(Date.now() + 60_000),
    }]);
    expect((await call("123456", await challengeFor(1))).status).toBe(429);
  });

  it("accepts a backup code and marks it used", async () => {
    userRow.mockReturnValue([enrolledUser]);
    verifyTotpMock.mockReturnValue({ valid: false, step: null });
    const { hashBackupCode } = await import("@/lib/auth/credentials");
    backupRows.mockReturnValue([{ id: 9, codeHash: await hashBackupCode("ABCD-2345"), usedAt: null }]);
    const res = await call("ABCD-2345", await challengeFor(1));
    expect(res.status).toBe(200);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ usedAt: expect.any(Date) }));
  });

  it("rejects a request with no challenge cookie", async () => {
    const { POST } = await import("./route");
    const res = await POST(new Request("http://localhost/api/users/login/2fa", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "123456" }),
    }));
    expect(res.status).toBe(401);
  });

  it("rejects a challenge token minted for a different purpose", async () => {
    const { signChallenge } = await import("@/lib/auth/jwt");
    userRow.mockReturnValue([enrolledUser]);
    const wrong = await signChallenge(1, "password_change");
    expect((await call("123456", wrong)).status).toBe(401);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/web test login/2fa`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Create the cookie reader**

Create `app/lib/auth/actor.ts` (Task 11 adds a second export to this same file):

```ts
import { CHALLENGE_COOKIE } from "./cookies";

export function readChallengeCookie(req: Request): string | null {
  const header = req.headers.get("cookie") ?? "";
  const match = header.match(new RegExp(`${CHALLENGE_COOKIE}=([^;]+)`));
  return match?.[1] ?? null;
}
```

- [ ] **Step 4: Write the implementation**

Create `app/app/api/users/login/2fa/route.ts`:

```ts
import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db, usersTable, userBackupCodesTable } from "@workspace/db";
import { verifyChallenge } from "@/lib/auth/jwt";
import { readChallengeCookie } from "@/lib/auth/actor";
import { verifyTotp } from "@/lib/auth/totp";
import { decryptSecret } from "@/lib/auth/secret-crypto";
import { verifyBackupCode } from "@/lib/auth/credentials";
import { resolveNextStep, isPrivileged } from "@/lib/auth/next-step";
import { issueSession, issueChallenge } from "@/lib/auth/session-issue";
import { getRolePermissions } from "@/lib/rbac/role-permissions";

export const runtime = "nodejs";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

const INVALID = () => NextResponse.json({ error: "Invalid code" }, { status: 401 });

export async function POST(req: Request): Promise<Response> {
  const token = readChallengeCookie(req);
  if (!token) return INVALID();

  let sub: number;
  try {
    ({ sub } = await verifyChallenge(token, "totp"));
  } catch {
    return INVALID();
  }

  let body: { code?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const code = String(body.code ?? "").trim();
  if (!code) return NextResponse.json({ error: "code is required" }, { status: 400 });

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, sub));
  if (!user || !user.twoFactorSecret || !user.twoFactorEnabledAt) return INVALID();

  if (user.twoFactorLockedUntil && user.twoFactorLockedUntil.getTime() > Date.now()) {
    return NextResponse.json(
      { error: "Too many incorrect codes. Try again in 15 minutes." },
      { status: 429 },
    );
  }

  // Try the authenticator code first, then fall back to backup codes.
  const secret = decryptSecret(user.twoFactorSecret);
  const totp = verifyTotp(secret, code, user.lastTotpStep ?? null);

  let matchedBackupCodeId: number | null = null;
  if (!totp.valid) {
    const unused = await db
      .select()
      .from(userBackupCodesTable)
      .where(and(eq(userBackupCodesTable.userId, user.id), isNull(userBackupCodesTable.usedAt)));
    for (const row of unused) {
      if (await verifyBackupCode(code, row.codeHash)) {
        matchedBackupCodeId = row.id;
        break;
      }
    }
  }

  if (!totp.valid && matchedBackupCodeId === null) {
    const attempts = user.twoFactorFailedAttempts + 1;
    await db
      .update(usersTable)
      .set({
        twoFactorFailedAttempts: attempts,
        twoFactorLockedUntil: attempts >= MAX_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MS) : null,
      })
      .where(eq(usersTable.id, user.id));
    return INVALID();
  }

  // Success — clear the counters and record the consumed step so the same code
  // cannot be replayed inside its remaining validity window.
  await db
    .update(usersTable)
    .set({
      twoFactorFailedAttempts: 0,
      twoFactorLockedUntil: null,
      ...(totp.valid ? { lastTotpStep: totp.step } : {}),
    })
    .where(eq(usersTable.id, user.id));

  if (matchedBackupCodeId !== null) {
    await db
      .update(userBackupCodesTable)
      .set({ usedAt: new Date() })
      .where(eq(userBackupCodesTable.id, matchedBackupCodeId));
  }

  const rolePerms = await getRolePermissions(user.role);
  const privileged = isPrivileged(user.role, user.isSystem, rolePerms);
  const step = resolveNextStep(user, privileged, true);

  if (step === "session") return issueSession(user);
  return issueChallenge(user.id, step, true);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @workspace/web test login/2fa`
Expected: PASS — 8 tests.

- [ ] **Step 6: Commit**

```bash
git add app/app/api/users/login/2fa/ app/lib/auth/actor.ts
git commit -m "feat(auth): TOTP and backup code verification endpoint with lockout"
```

---

## Task 11: 2FA enrolment endpoints

**Files:**
- Modify: `app/lib/auth/actor.ts` (created in Task 10)
- Create: `app/app/api/users/2fa/setup/route.ts`
- Create: `app/app/api/users/2fa/enable/route.ts`
- Create: `app/app/api/users/2fa/disable/route.ts`
- Create: `app/app/api/users/2fa/backup-codes/route.ts`
- Test: `app/app/api/users/2fa/enable/route.test.ts`
- Test: `app/app/api/users/2fa/disable/route.test.ts`
- Modify: `app/package.json`

**Interfaces:**
- Consumes: `verifyChallenge` (Task 6), `getSession` (existing), `generateSecret`/`buildOtpauthUri`/`verifyTotp` (Task 3), `encryptSecret`/`decryptSecret` (Task 2), `generateBackupCodes`/`hashBackupCode` (Task 4), `isPrivileged` (Task 8), `issueSession` (Task 9).
- Produces: `app/lib/auth/actor.ts` exporting `resolveActor(req: Request, purpose: ChallengePurpose): Promise<number | null>` — resolves a user id from *either* a live session *or* a challenge cookie of the given purpose. Reused by Task 12.

The pending secret lives in `two_factor_secret` with `two_factor_enabled_at` still `NULL`. That column pair already distinguishes "scanned but unconfirmed" from "active", so no extra state is needed.

- [ ] **Step 1: Install the QR library**

```bash
pnpm --filter @workspace/web add qrcode@1.5.4
pnpm --filter @workspace/web add -D @types/qrcode
```

- [ ] **Step 2: Add the dual-auth helper**

Append to `app/lib/auth/actor.ts` (which already exports `readChallengeCookie` from Task 10), adding these imports at the top:

```ts
import { getSession } from "./session";
import { verifyChallenge, type ChallengePurpose } from "./jwt";
```

```ts
/**
 * Enrolment and forced password change are reachable two ways: by an already
 * signed-in user changing their own settings, or by a half-authenticated user
 * mid-login holding a challenge token. This resolves the acting user id from
 * whichever is present, and returns null when neither is valid.
 */
export async function resolveActor(req: Request, purpose: ChallengePurpose): Promise<number | null> {
  const session = await getSession();
  if (session) return session.sub;

  const token = readChallengeCookie(req);
  if (!token) return null;
  try {
    const claims = await verifyChallenge(token, purpose);
    return claims.sub;
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Write the setup route**

Create `app/app/api/users/2fa/setup/route.ts`:

```ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import QRCode from "qrcode";
import { db, usersTable } from "@workspace/db";
import { resolveActor } from "@/lib/auth/actor";
import { generateSecret, buildOtpauthUri } from "@/lib/auth/totp";
import { encryptSecret } from "@/lib/auth/secret-crypto";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const userId = await resolveActor(req, "totp_enroll");
  if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (user.twoFactorEnabledAt) {
    return NextResponse.json({ error: "Two-factor authentication is already enabled" }, { status: 400 });
  }

  // Stored immediately but left inactive (two_factor_enabled_at stays NULL) so
  // /enable can verify the user actually scanned this exact secret.
  const secret = generateSecret();
  await db
    .update(usersTable)
    .set({ twoFactorSecret: encryptSecret(secret) })
    .where(eq(usersTable.id, userId));

  const uri = buildOtpauthUri(secret, user.username);
  return NextResponse.json({ secret, otpauthUri: uri, qrDataUrl: await QRCode.toDataURL(uri) });
}
```

- [ ] **Step 4: Write the failing test for enable**

Create `app/app/api/users/2fa/enable/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const userRow = vi.fn();
const updateSet = vi.fn();
const insertValues = vi.fn();

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => userRow() }) }),
    update: () => ({ set: (v: unknown) => { updateSet(v); return { where: async () => undefined }; } }),
    insert: () => ({ values: async (v: unknown) => { insertValues(v); } }),
    delete: () => ({ where: async () => undefined }),
  },
  usersTable: "users",
  userBackupCodesTable: "backup",
}));

vi.mock("@/lib/auth/secret-crypto", () => ({
  encryptSecret: (s: string) => s,
  decryptSecret: (s: string) => s,
}));
vi.mock("@/lib/rbac/role-permissions", () => ({ getRolePermissions: vi.fn(async () => []) }));

const verifyTotpMock = vi.fn();
vi.mock("@/lib/auth/totp", () => ({ verifyTotp: (...a: unknown[]) => verifyTotpMock(...a) }));

const sessionMock = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSession: () => sessionMock() }));

beforeAll(() => { process.env.JWT_SECRET = "test-secret-at-least-32-chars-long-xxxxx"; });

const pendingUser = {
  id: 1, name: "A", username: "admin", email: "a@x.com", password: "h",
  role: "Viewer", isSystem: false, tokenVersion: 0, mustChangePassword: false,
  twoFactorSecret: "SECRET", twoFactorEnabledAt: null, lastTotpStep: null,
};

beforeEach(() => {
  userRow.mockReset(); updateSet.mockReset(); insertValues.mockReset();
  verifyTotpMock.mockReset(); sessionMock.mockReset();
  sessionMock.mockResolvedValue({ sub: 1 });
});

async function call(code: string) {
  const { POST } = await import("./route");
  return POST(new Request("http://localhost/api/users/2fa/enable", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  }));
}

describe("POST /api/users/2fa/enable", () => {
  it("activates 2FA and returns exactly ten backup codes", async () => {
    userRow.mockReturnValue([pendingUser]);
    verifyTotpMock.mockReturnValue({ valid: true, step: 100 });
    const res = await call("123456");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.backupCodes).toHaveLength(10);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ twoFactorEnabledAt: expect.any(Date) }));
  });

  it("stores backup codes hashed, never in plaintext", async () => {
    userRow.mockReturnValue([pendingUser]);
    verifyTotpMock.mockReturnValue({ valid: true, step: 100 });
    const json = await (await call("123456")).json();
    const inserted = insertValues.mock.calls[0][0] as { codeHash: string }[];
    for (const code of json.backupCodes) {
      expect(inserted.some((row) => row.codeHash === code)).toBe(false);
    }
    expect(inserted[0].codeHash).toMatch(/^\$2[aby]\$/);
  });

  it("refuses to activate when the code is wrong", async () => {
    userRow.mockReturnValue([pendingUser]);
    verifyTotpMock.mockReturnValue({ valid: false, step: null });
    expect((await call("000000")).status).toBe(401);
    expect(updateSet).not.toHaveBeenCalledWith(expect.objectContaining({ twoFactorEnabledAt: expect.anything() }));
  });

  it("rejects when no setup has been started", async () => {
    userRow.mockReturnValue([{ ...pendingUser, twoFactorSecret: null }]);
    expect((await call("123456")).status).toBe(400);
  });

  it("rejects an unauthenticated caller", async () => {
    sessionMock.mockResolvedValue(null);
    expect((await call("123456")).status).toBe(401);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm --filter @workspace/web test 2fa/enable`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 6: Write the enable route**

Create `app/app/api/users/2fa/enable/route.ts`:

```ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, usersTable, userBackupCodesTable } from "@workspace/db";
import { resolveActor } from "@/lib/auth/actor";
import { verifyTotp } from "@/lib/auth/totp";
import { decryptSecret } from "@/lib/auth/secret-crypto";
import { generateBackupCodes, hashBackupCode } from "@/lib/auth/credentials";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const userId = await resolveActor(req, "totp_enroll");
  if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  let body: { code?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const code = String(body.code ?? "").trim();

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!user.twoFactorSecret) {
    return NextResponse.json({ error: "Start setup before enabling two-factor authentication" }, { status: 400 });
  }
  if (user.twoFactorEnabledAt) {
    return NextResponse.json({ error: "Two-factor authentication is already enabled" }, { status: 400 });
  }

  // Requiring a valid code proves the user actually scanned the QR — otherwise
  // we would lock them out of their own account at the next login.
  const result = verifyTotp(decryptSecret(user.twoFactorSecret), code, null);
  if (!result.valid) return NextResponse.json({ error: "Invalid code" }, { status: 401 });

  const codes = generateBackupCodes();
  const rows = await Promise.all(
    codes.map(async (code) => ({ userId: user.id, codeHash: await hashBackupCode(code) })),
  );
  await db.insert(userBackupCodesTable).values(rows);

  await db
    .update(usersTable)
    .set({
      twoFactorEnabledAt: new Date(),
      lastTotpStep: result.step,
      twoFactorFailedAttempts: 0,
      twoFactorLockedUntil: null,
    })
    .where(eq(usersTable.id, user.id));

  // Shown exactly once — they are hashed at rest and cannot be recovered.
  return NextResponse.json({ backupCodes: codes });
}
```

- [ ] **Step 7: Write the failing test for disable**

Create `app/app/api/users/2fa/disable/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const userRow = vi.fn();
const updateSet = vi.fn();
const compareMock = vi.fn();

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => userRow() }) }),
    update: () => ({ set: (v: unknown) => { updateSet(v); return { where: async () => undefined }; } }),
    delete: () => ({ where: async () => undefined }),
  },
  usersTable: "users",
  userBackupCodesTable: "backup",
}));

vi.mock("bcryptjs", () => ({ default: { compare: (...a: unknown[]) => compareMock(...a) } }));
vi.mock("@/lib/auth/secret-crypto", () => ({ decryptSecret: (s: string) => s }));
vi.mock("@/lib/auth/totp", () => ({ verifyTotp: () => ({ valid: true, step: 1 }) }));

const permsMock = vi.fn(async () => [] as string[]);
vi.mock("@/lib/rbac/role-permissions", () => ({ getRolePermissions: () => permsMock() }));

const sessionMock = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSession: () => sessionMock() }));

beforeAll(() => { process.env.JWT_SECRET = "test-secret-at-least-32-chars-long-xxxxx"; });

const enrolled = {
  id: 1, name: "A", username: "u", email: "a@x.com", password: "h",
  role: "Viewer", isSystem: false, tokenVersion: 0,
  twoFactorSecret: "S", twoFactorEnabledAt: new Date(), lastTotpStep: null,
};

beforeEach(() => {
  userRow.mockReset(); updateSet.mockReset(); compareMock.mockReset(); sessionMock.mockReset();
  permsMock.mockResolvedValue([]);
  sessionMock.mockResolvedValue({ sub: 1 });
  compareMock.mockResolvedValue(true);
});

async function call() {
  const { POST } = await import("./route");
  return POST(new Request("http://localhost/api/users/2fa/disable", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "pw", code: "123456" }),
  }));
}

describe("POST /api/users/2fa/disable", () => {
  it("disables 2FA and bumps tokenVersion for an ordinary user", async () => {
    userRow.mockReturnValue([enrolled]);
    expect((await call()).status).toBe(200);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      twoFactorEnabledAt: null,
      twoFactorSecret: null,
      tokenVersion: 1,
    }));
  });

  it("REFUSES for a privileged user — 2FA is mandatory for them", async () => {
    userRow.mockReturnValue([{ ...enrolled, isSystem: true }]);
    const res = await call();
    expect(res.status).toBe(403);
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("rejects a wrong password", async () => {
    userRow.mockReturnValue([enrolled]);
    compareMock.mockResolvedValue(false);
    expect((await call()).status).toBe(401);
  });
});
```

- [ ] **Step 8: Write the disable and backup-codes routes**

Create `app/app/api/users/2fa/disable/route.ts`:

```ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, usersTable, userBackupCodesTable } from "@workspace/db";
import { getSession } from "@/lib/auth/session";
import { verifyTotp } from "@/lib/auth/totp";
import { decryptSecret } from "@/lib/auth/secret-crypto";
import { isPrivileged } from "@/lib/auth/next-step";
import { getRolePermissions } from "@/lib/rbac/role-permissions";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  let body: { password?: unknown; code?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, session.sub));
  if (!user || !user.twoFactorEnabledAt || !user.twoFactorSecret) {
    return NextResponse.json({ error: "Two-factor authentication is not enabled" }, { status: 400 });
  }

  const rolePerms = await getRolePermissions(user.role);
  if (isPrivileged(user.role, user.isSystem, rolePerms)) {
    return NextResponse.json(
      { error: "Two-factor authentication is required for administrator accounts and cannot be disabled." },
      { status: 403 },
    );
  }

  // Re-authenticate with both factors before removing one of them.
  const passwordOk = await bcrypt.compare(String(body.password ?? ""), user.password);
  const codeOk = verifyTotp(decryptSecret(user.twoFactorSecret), String(body.code ?? ""), null).valid;
  if (!passwordOk || !codeOk) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  await db.delete(userBackupCodesTable).where(eq(userBackupCodesTable.userId, user.id));
  await db
    .update(usersTable)
    .set({
      twoFactorSecret: null,
      twoFactorEnabledAt: null,
      lastTotpStep: null,
      twoFactorFailedAttempts: 0,
      twoFactorLockedUntil: null,
      tokenVersion: user.tokenVersion + 1,
    })
    .where(eq(usersTable.id, user.id));

  return NextResponse.json({ ok: true });
}
```

Create `app/app/api/users/2fa/backup-codes/route.ts`:

```ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, usersTable, userBackupCodesTable } from "@workspace/db";
import { getSession } from "@/lib/auth/session";
import { generateBackupCodes, hashBackupCode } from "@/lib/auth/credentials";

export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, session.sub));
  if (!user?.twoFactorEnabledAt) {
    return NextResponse.json({ error: "Two-factor authentication is not enabled" }, { status: 400 });
  }

  // Regenerating invalidates every previously issued code.
  await db.delete(userBackupCodesTable).where(eq(userBackupCodesTable.userId, user.id));
  const codes = generateBackupCodes();
  await db.insert(userBackupCodesTable).values(
    await Promise.all(codes.map(async (c) => ({ userId: user.id, codeHash: await hashBackupCode(c) }))),
  );

  return NextResponse.json({ backupCodes: codes });
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `pnpm --filter @workspace/web test 2fa`
Expected: PASS — 8 tests across both files.

- [ ] **Step 10: Commit**

```bash
git add app/lib/auth/actor.ts app/app/api/users/2fa/ app/package.json ../pnpm-lock.yaml
git commit -m "feat(auth): 2FA enrolment, disable, and backup code regeneration"
```

---

## Task 12: Password change endpoint

**Files:**
- Create: `app/app/api/users/me/password/route.ts`
- Test: `app/app/api/users/me/password/route.test.ts`
- Modify: `app/lib/rate-limit.ts`

**Interfaces:**
- Consumes: `resolveActor`/`readChallengeCookie` (Task 11), `verifyChallenge` (Task 6), `validatePassword` (Task 1), `resolveNextStep`/`isPrivileged` (Task 8), `issueSession`/`issueChallenge` (Task 9).
- Produces: `POST /api/users/me/password` accepting `{ currentPassword, newPassword }`; bumps `tokenVersion`, clears `mustChangePassword`, and returns the next step.

- [ ] **Step 1: Add the rate-limit bucket**

In `app/lib/rate-limit.ts`, change the `Bucket` type and `LIMITS` map:

```ts
type Bucket = "login" | "global" | "password-change";

const LIMITS: Record<Bucket, { tokens: number; window: `${number} ${"s" | "m"}` }> = {
  login: { tokens: 10, window: "15 m" }, // mirrors old express loginLimiter
  global: { tokens: 100, window: "1 m" },
  "password-change": { tokens: 5, window: "15 m" },
};
```

- [ ] **Step 2: Write the failing test**

Create `app/app/api/users/me/password/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const userRow = vi.fn();
const updateSet = vi.fn();
const compareMock = vi.fn();

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => userRow() }) }),
    update: () => ({ set: (v: unknown) => { updateSet(v); return { where: async () => undefined }; } }),
  },
  usersTable: "users",
}));

vi.mock("bcryptjs", () => ({
  default: {
    compare: (...a: unknown[]) => compareMock(...a),
    hash: async (p: string) => `hashed:${p}`,
  },
}));

const validateMock = vi.fn();
vi.mock("@/lib/auth/password-policy", () => ({
  validatePassword: (...a: unknown[]) => validateMock(...a),
}));

vi.mock("@/lib/rbac/role-permissions", () => ({ getRolePermissions: vi.fn(async () => []) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => ({ success: true })) }));

const sessionMock = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSession: () => sessionMock() }));

beforeAll(() => { process.env.JWT_SECRET = "test-secret-at-least-32-chars-long-xxxxx"; });

const user = {
  id: 1, name: "A", username: "u", email: "a@x.com", password: "oldhash",
  role: "Viewer", isSystem: false, tokenVersion: 4,
  mustChangePassword: true, twoFactorEnabledAt: null,
};

beforeEach(() => {
  userRow.mockReset(); updateSet.mockReset(); compareMock.mockReset();
  validateMock.mockReset(); sessionMock.mockReset();
  userRow.mockReturnValue([user]);
  compareMock.mockResolvedValue(true);
  validateMock.mockResolvedValue({ ok: true, errors: [] });
  sessionMock.mockResolvedValue({ sub: 1 });
});

async function call(body: unknown) {
  const { POST } = await import("./route");
  return POST(new Request("http://localhost/api/users/me/password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

describe("POST /api/users/me/password", () => {
  it("changes the password and bumps tokenVersion to kill other sessions", async () => {
    const res = await call({ currentPassword: "old", newPassword: "a new long passphrase" });
    expect(res.status).toBe(200);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      tokenVersion: 5,
      mustChangePassword: false,
      passwordChangedAt: expect.any(Date),
    }));
  });

  it("rejects a wrong current password", async () => {
    compareMock.mockResolvedValue(false);
    expect((await call({ currentPassword: "nope", newPassword: "a new long passphrase" })).status).toBe(401);
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("rejects a new password that fails policy", async () => {
    validateMock.mockResolvedValue({ ok: false, errors: ["Password must be at least 12 characters."] });
    const res = await call({ currentPassword: "old", newPassword: "short" });
    expect(res.status).toBe(400);
    expect((await res.json()).errors).toContain("Password must be at least 12 characters.");
  });

  it("rejects reusing the current password", async () => {
    // bcrypt.compare returns true for BOTH the current-password check and the reuse check
    const res = await call({ currentPassword: "same one here", newPassword: "same one here" });
    expect(res.status).toBe(400);
    expect((await res.json()).errors.join(" ")).toMatch(/different/i);
  });

  it("rejects an unauthenticated caller with no challenge", async () => {
    sessionMock.mockResolvedValue(null);
    expect((await call({ currentPassword: "a", newPassword: "a new long passphrase" })).status).toBe(401);
  });

  it("routes to enrolment when the user is privileged and unenrolled", async () => {
    userRow.mockReturnValue([{ ...user, isSystem: true }]);
    const res = await call({ currentPassword: "old", newPassword: "a new long passphrase" });
    expect(await res.json()).toMatchObject({ next: "enroll_2fa" });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @workspace/web test me/password`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 4: Write the implementation**

Create `app/app/api/users/me/password/route.ts`:

```ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { resolveActor, readChallengeCookie } from "@/lib/auth/actor";
import { verifyChallenge } from "@/lib/auth/jwt";
import { validatePassword } from "@/lib/auth/password-policy";
import { resolveNextStep, isPrivileged } from "@/lib/auth/next-step";
import { issueSession, issueChallenge } from "@/lib/auth/session-issue";
import { getRolePermissions } from "@/lib/rbac/role-permissions";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const BCRYPT_ROUNDS = 12;

export async function POST(req: Request): Promise<Response> {
  const userId = await resolveActor(req, "password_change");
  if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { success } = await checkRateLimit("password-change", String(userId));
  if (!success) {
    return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
  }

  let body: { currentPassword?: unknown; newPassword?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const currentPassword = String(body.currentPassword ?? "");
  const newPassword = String(body.newPassword ?? "");
  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "currentPassword and newPassword are required" }, { status: 400 });
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  if (!(await bcrypt.compare(currentPassword, user.password))) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
  }

  if (await bcrypt.compare(newPassword, user.password)) {
    return NextResponse.json(
      { errors: ["Your new password must be different from your current one."] },
      { status: 400 },
    );
  }

  const validation = await validatePassword(newPassword);
  if (!validation.ok) {
    return NextResponse.json({ errors: validation.errors }, { status: 400 });
  }

  // Bumping tokenVersion invalidates every session issued before this change —
  // the point of changing a password you believe was stolen.
  const nextVersion = user.tokenVersion + 1;
  await db
    .update(usersTable)
    .set({
      password: await bcrypt.hash(newPassword, BCRYPT_ROUNDS),
      mustChangePassword: false,
      passwordChangedAt: new Date(),
      tokenVersion: nextVersion,
    })
    .where(eq(usersTable.id, user.id));

  // Carry forward whether the second factor was already satisfied this login.
  let totpDone = true;
  const challenge = readChallengeCookie(req);
  if (challenge) {
    try {
      totpDone = (await verifyChallenge(challenge, "password_change")).totpDone;
    } catch {
      totpDone = true;
    }
  }

  const updated = { ...user, mustChangePassword: false, tokenVersion: nextVersion };
  const rolePerms = await getRolePermissions(user.role);
  const privileged = isPrivileged(user.role, user.isSystem, rolePerms);
  const step = resolveNextStep(updated, privileged, totpDone);

  if (step === "session") return issueSession(updated);
  return issueChallenge(user.id, step, totpDone);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @workspace/web test me/password`
Expected: PASS — 6 tests.

- [ ] **Step 6: Commit**

```bash
git add app/app/api/users/me/password/ app/lib/rate-limit.ts
git commit -m "feat(auth): self-service password change with session revocation"
```

---

## Task 13: Admin reset endpoints

**Files:**
- Create: `app/app/api/users/[id]/reset-password/route.ts`
- Create: `app/app/api/users/[id]/reset-2fa/route.ts`
- Test: `app/app/api/users/[id]/reset-password/route.test.ts`

**Interfaces:**
- Consumes: `requirePermission`/`isAuthError` (Task 7), `generateTempPassword` (Task 4).
- Produces: `POST /api/users/:id/reset-password` returning `{ tempPassword }` once; `POST /api/users/:id/reset-2fa` returning `{ ok: true }`. Both gated on `settings.users:manage` and both bump `tokenVersion`.

- [ ] **Step 1: Write the failing test**

Create `app/app/api/users/[id]/reset-password/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const userRow = vi.fn();
const updateSet = vi.fn();
const authMock = vi.fn();

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => userRow() }) }),
    update: () => ({ set: (v: unknown) => { updateSet(v); return { where: async () => undefined }; } }),
  },
  usersTable: "users",
}));

vi.mock("bcryptjs", () => ({ default: { hash: async (p: string) => `hashed:${p}` } }));

vi.mock("@/lib/auth/require", () => ({
  requirePermission: () => authMock(),
  isAuthError: (r: unknown) => r instanceof Response,
}));

beforeAll(() => { process.env.JWT_SECRET = "test-secret-at-least-32-chars-long-xxxxx"; });

beforeEach(() => {
  userRow.mockReset(); updateSet.mockReset(); authMock.mockReset();
  authMock.mockResolvedValue({ user: { sub: 99, role: "System Admin", isSystem: true } });
  userRow.mockReturnValue([{ id: 5, username: "target", isSystem: false, tokenVersion: 2 }]);
});

async function call(id = "5") {
  const { POST } = await import("./route");
  return POST(new Request("http://localhost/api/users/5/reset-password", { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
}

describe("POST /api/users/[id]/reset-password", () => {
  it("returns a temp password meeting the length policy", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).tempPassword.length).toBeGreaterThanOrEqual(12);
  });

  it("forces a change and revokes sessions", async () => {
    await call();
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      mustChangePassword: true,
      tokenVersion: 3,
    }));
  });

  it("never stores the temp password in plaintext", async () => {
    const json = await (await call()).json();
    const written = updateSet.mock.calls[0][0] as { password: string };
    expect(written.password).not.toBe(json.tempPassword);
    expect(written.password).toContain("hashed:");
  });

  it("refuses without the manage permission", async () => {
    authMock.mockResolvedValue(new Response("no", { status: 403 }));
    expect((await call()).status).toBe(403);
  });

  it("refuses to reset a system account", async () => {
    userRow.mockReturnValue([{ id: 5, username: "sys", isSystem: true, tokenVersion: 0 }]);
    expect((await call()).status).toBe(400);
  });

  it("404s for a missing user", async () => {
    userRow.mockReturnValue([]);
    expect((await call("404")).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/web test reset-password`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Write the reset-password route**

Create `app/app/api/users/[id]/reset-password/route.ts`:

```ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { requirePermission, isAuthError } from "@/lib/auth/require";
import { generateTempPassword } from "@/lib/auth/credentials";

export const runtime = "nodejs";

const BCRYPT_ROUNDS = 12;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requirePermission("settings.users:manage");
  if (isAuthError(auth)) return auth;

  const { id } = await params;
  const userId = Number(id);
  if (!Number.isInteger(userId)) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (user.isSystem) {
    return NextResponse.json({ error: "Cannot modify system accounts" }, { status: 400 });
  }

  // System-generated rather than admin-typed, so no account starts life as
  // "welcome123". Shown once and never stored in plaintext.
  const tempPassword = generateTempPassword();
  await db
    .update(usersTable)
    .set({
      password: await bcrypt.hash(tempPassword, BCRYPT_ROUNDS),
      mustChangePassword: true,
      passwordChangedAt: new Date(),
      tokenVersion: user.tokenVersion + 1,
    })
    .where(eq(usersTable.id, user.id));

  return NextResponse.json({ tempPassword, username: user.username });
}
```

- [ ] **Step 4: Write the reset-2fa route**

Create `app/app/api/users/[id]/reset-2fa/route.ts`:

```ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, usersTable, userBackupCodesTable } from "@workspace/db";
import { requirePermission, isAuthError } from "@/lib/auth/require";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requirePermission("settings.users:manage");
  if (isAuthError(auth)) return auth;

  const { id } = await params;
  const userId = Number(id);
  if (!Number.isInteger(userId)) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // Clearing the secret forces re-enrolment at the next login for privileged
  // users, and simply disables 2FA for everyone else.
  await db.delete(userBackupCodesTable).where(eq(userBackupCodesTable.userId, user.id));
  await db
    .update(usersTable)
    .set({
      twoFactorSecret: null,
      twoFactorEnabledAt: null,
      lastTotpStep: null,
      twoFactorFailedAttempts: 0,
      twoFactorLockedUntil: null,
      tokenVersion: user.tokenVersion + 1,
    })
    .where(eq(usersTable.id, user.id));

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @workspace/web test reset-password`
Expected: PASS — 6 tests.

- [ ] **Step 6: Commit**

```bash
git add "app/app/api/users/[id]/reset-password/" "app/app/api/users/[id]/reset-2fa/"
git commit -m "feat(auth): admin password and 2FA reset endpoints"
```

---

## Task 14: User CRUD, seed, and session identity

**Files:**
- Modify: `app/app/api/users/route.ts`
- Modify: `app/app/api/auth/me/route.ts`
- Modify: `app/scripts/seed.ts`
- Test: `app/app/api/users/route.test.ts` (create if absent)

**Interfaces:**
- Consumes: `generateTempPassword` (Task 4), `validatePassword` (Task 1), `requirePermission` (Task 7).
- Produces: `POST /api/users` accepts `{ name, username, email, role, password? }`, returns `{ ..., username, twoFactorEnabled, tempPassword? }`. `GET /api/users` returns `username` and `twoFactorEnabled` per row. `GET /api/auth/me` returns `username` and `twoFactorEnabled`.

- [ ] **Step 1: Write the failing test**

Create `app/app/api/users/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const selectRows = vi.fn();
const insertValues = vi.fn();
const updateSet = vi.fn();
const authMock = vi.fn();

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => selectRows(), orderBy: () => selectRows() }) }),
    insert: () => ({ values: (v: unknown) => { insertValues(v); return { returning: async () => [{ id: 7, ...(v as object) }] }; } }),
    update: () => ({ set: (v: unknown) => { updateSet(v); return { where: () => ({ returning: async () => [{ id: 5, ...(v as object) }] }) }; } }),
  },
  usersTable: { username: "username", email: "email" },
}));

vi.mock("bcryptjs", () => ({ default: { hash: async (p: string) => `hashed:${p}` } }));
vi.mock("@/lib/auth/require", () => ({
  requirePermission: () => authMock(),
  isAuthError: (r: unknown) => r instanceof Response,
}));
vi.mock("@/lib/auth/password-policy", () => ({ validatePassword: async () => ({ ok: true, errors: [] }) }));

beforeAll(() => { process.env.JWT_SECRET = "test-secret-at-least-32-chars-long-xxxxx"; });

beforeEach(() => {
  selectRows.mockReset(); insertValues.mockReset(); updateSet.mockReset(); authMock.mockReset();
  authMock.mockResolvedValue({ user: { sub: 1, role: "System Admin", isSystem: true } });
  selectRows.mockReturnValue([]);
});

async function post(body: unknown) {
  const { POST } = await import("./route");
  return POST(new Request("http://localhost/api/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

describe("POST /api/users", () => {
  const valid = { name: "Ahmed", username: "ahmed", email: "ahmed@x.com", role: "Viewer" };

  it("creates a user and returns a temp password when none is supplied", async () => {
    const res = await post(valid);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.tempPassword).toBeTruthy();
    expect(json.mustChangePassword).toBe(true);
  });

  it("lowercases the username before storing", async () => {
    await post({ ...valid, username: "  AhMeD  " });
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ username: "ahmed" }));
  });

  it("rejects a duplicate username", async () => {
    selectRows.mockReturnValue([{ id: 3, username: "ahmed", email: "other@x.com" }]);
    const res = await post(valid);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/username/i);
  });

  it("requires a username", async () => {
    const res = await post({ name: "A", email: "a@x.com", role: "Viewer" });
    expect(res.status).toBe(400);
  });

  it("never returns the stored password hash", async () => {
    const json = await (await post(valid)).json();
    expect(json.password).toBeUndefined();
  });

  it("refuses without the manage permission", async () => {
    authMock.mockResolvedValue(new Response("no", { status: 403 }));
    expect((await post(valid)).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/web test api/users/route`
Expected: FAIL — the route has no username handling.

- [ ] **Step 3: Rewrite `app/app/api/users/route.ts`**

```ts
import { NextResponse } from "next/server";
import { eq, or } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { requirePermission, isAuthError } from "@/lib/auth/require";
import { validatePassword } from "@/lib/auth/password-policy";
import { generateTempPassword } from "@/lib/auth/credentials";

export const runtime = "nodejs";

const BCRYPT_ROUNDS = 12;

function publicUser(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    email: u.email,
    role: u.role,
    isSystem: u.isSystem,
    mustChangePassword: u.mustChangePassword,
    twoFactorEnabled: Boolean(u.twoFactorEnabledAt),
  };
}

export async function GET(): Promise<Response> {
  const auth = await requirePermission("settings.users:manage");
  if (isAuthError(auth)) return auth;
  try {
    const rows = await db.select().from(usersTable).orderBy(usersTable.id);
    return NextResponse.json(rows.map(publicUser));
  } catch {
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<Response> {
  const auth = await requirePermission("settings.users:manage");
  if (isAuthError(auth)) return auth;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  const username = String(body.username ?? "").trim().toLowerCase();
  const email = String(body.email ?? "").trim().toLowerCase();
  const role = String(body.role ?? "").trim();
  const password = body.password ? String(body.password) : null;

  if (!name || !username || !email || !role) {
    return NextResponse.json(
      { error: "name, username, email, and role are required" },
      { status: 400 },
    );
  }

  try {
    const matches = await db
      .select()
      .from(usersTable)
      .where(or(eq(usersTable.username, username), eq(usersTable.email, email)));

    const byUsername = matches.find((m) => m.username === username);
    const byEmail = matches.find((m) => m.email === email);

    // Update path: the account is identified by email, as it was before.
    if (byEmail) {
      if (byEmail.isSystem) {
        return NextResponse.json({ error: "Cannot modify system accounts" }, { status: 400 });
      }
      if (byUsername && byUsername.id !== byEmail.id) {
        return NextResponse.json({ error: "That username is already taken" }, { status: 409 });
      }

      const updates: Record<string, unknown> = { name, username, role, updatedAt: new Date() };
      if (password) {
        const validation = await validatePassword(password);
        if (!validation.ok) return NextResponse.json({ errors: validation.errors }, { status: 400 });
        updates.password = await bcrypt.hash(password, BCRYPT_ROUNDS);
        updates.passwordChangedAt = new Date();
        updates.tokenVersion = byEmail.tokenVersion + 1;
      }
      const [updated] = await db
        .update(usersTable)
        .set(updates)
        .where(eq(usersTable.email, email))
        .returning();
      return NextResponse.json(publicUser(updated));
    }

    if (byUsername) {
      return NextResponse.json({ error: "That username is already taken" }, { status: 409 });
    }

    // Create path. An admin-supplied password must still pass policy; otherwise
    // we generate one and force a change at first login.
    let initialPassword = password;
    if (initialPassword) {
      const validation = await validatePassword(initialPassword);
      if (!validation.ok) return NextResponse.json({ errors: validation.errors }, { status: 400 });
    } else {
      initialPassword = generateTempPassword();
    }

    const [inserted] = await db
      .insert(usersTable)
      .values({
        name,
        username,
        email,
        password: await bcrypt.hash(initialPassword, BCRYPT_ROUNDS),
        role,
        isSystem: false,
        mustChangePassword: true,
        passwordChangedAt: new Date(),
      })
      .returning();

    // Returned once so the admin can hand it over. Never stored in plaintext.
    return NextResponse.json({ ...publicUser(inserted), tempPassword: initialPassword }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to save user" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Expose the new identity fields on `/api/auth/me`**

In `app/app/api/auth/me/route.ts`, the handler needs the database row to know the 2FA state — the JWT does not carry it. Replace the body of `GET`:

```ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { getSession } from "@/lib/auth/session";
import { getRolePermissions } from "@/lib/rbac/role-permissions";
import { effectivePermissions } from "@/lib/rbac/can";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  const [row] = await db.select().from(usersTable).where(eq(usersTable.id, user.sub));
  if (!row || row.tokenVersion !== user.tokenVersion) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const rolePerms = await getRolePermissions(user.role);
  const eff = effectivePermissions({ role: user.role, isSystem: user.isSystem ?? false }, rolePerms);
  return NextResponse.json({
    id: user.sub,
    name: user.name,
    username: row.username,
    email: user.email,
    role: user.role,
    isSystem: user.isSystem ?? false,
    twoFactorEnabled: Boolean(row.twoFactorEnabledAt),
    permissions: [...eff],
  });
}
```

- [ ] **Step 5: Give the seeded admin a username**

In `app/scripts/seed.ts`, the insert at lines 40-46 must supply `username`. Replace that `db.insert(usersTable).values({...})` call with:

```ts
      await db.insert(usersTable).values({
        name: "System Admin",
        username: "admin",
        email: "admin@advengers.com",
        password: hashedPassword,
        role: "System Admin",
        isSystem: true,
      });
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `pnpm --filter @workspace/web test && pnpm typecheck`
Expected: PASS across the whole suite. Any remaining `SessionUser` fixtures missing `username`/`tokenVersion` surface here — add the fields.

- [ ] **Step 7: Commit**

```bash
git add app/app/api/users/route.ts app/app/api/users/route.test.ts app/app/api/auth/me/route.ts app/scripts/seed.ts
git commit -m "feat(auth): username-aware user CRUD, seed, and session identity"
```

---

## Task 15: Login page — username and second step

**Files:**
- Modify: `app/app/login/page.tsx`

**Interfaces:**
- Consumes: `POST /api/users/login` returning `{ next: "session" | "totp" | "password_change" | "enroll_2fa" }` (Task 9); `POST /api/users/login/2fa` (Task 10).
- Produces: navigation to `/` on `session`, `/change-password` on `password_change`, `/enroll-2fa` on `enroll_2fa`.

The second step is in-page rather than a separate route, so partial authentication state is never reflected in the URL.

- [ ] **Step 1: Replace the email field with username**

In `app/app/login/page.tsx`, change the state declaration at line 9 and the email input block at lines 150-167.

State — replace `const [email, setEmail] = useState("");` with:

```tsx
  const [username, setUsername] = useState("");
  const [stage, setStage] = useState<"credentials" | "totp">("credentials");
  const [code, setCode] = useState("");
```

Field — replace the whole "Email" `<div className="space-y-1.5">` block with:

```tsx
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground" htmlFor="login-username">
                Username
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input
                  id="login-username"
                  type="text"
                  autoComplete="username"
                  required
                  placeholder="your.username"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  className="pl-9 h-10 text-sm bg-card"
                  data-testid="login-username"
                />
              </div>
            </div>
```

Update the lucide import on line 4 — swap `Mail` for `User` and add `ShieldCheck`:

```tsx
import { Zap, User, Lock, AlertCircle, Eye, EyeOff, BarChart3, TrendingUp, DollarSign, ShieldCheck } from "lucide-react";
```

- [ ] **Step 2: Route on the `next` field**

Replace `handleSubmit` (lines 15-37) with these two handlers:

```tsx
  const routeNext = (next: string) => {
    if (next === "session") { window.location.href = "/"; return; }
    if (next === "password_change") { window.location.href = "/change-password"; return; }
    if (next === "enroll_2fa") { window.location.href = "/enroll-2fa"; return; }
    if (next === "totp") { setStage("totp"); setError(""); return; }
    setError("Unexpected server response. Please try again.");
  };

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const res = await fetch("/api/users/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim().toLowerCase(), password }),
      });
      if (res.ok) {
        routeNext((await res.json()).next);
      } else if (res.status === 429) {
        setError("Too many attempts. Please try again later.");
      } else {
        setError("Invalid username or password. Please try again.");
      }
    } catch {
      setError("Unable to connect to server. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const res = await fetch("/api/users/login/2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      if (res.ok) {
        routeNext((await res.json()).next);
      } else if (res.status === 429) {
        setError("Too many incorrect codes. Please try again in 15 minutes.");
      } else {
        setError("That code isn't valid. Check your authenticator app and try again.");
      }
    } catch {
      setError("Unable to connect to server. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };
```

- [ ] **Step 3: Render the second step**

Wrap the existing form. Change `<form onSubmit={handleSubmit} className="space-y-5">` to `<form onSubmit={handleCredentials} className="space-y-5">`, then wrap the username, password and submit blocks in `{stage === "credentials" && (<> ... </>)}`, and add this sibling block immediately after them, inside the same `<form>`:

```tsx
            {stage === "totp" && (
              <div className="space-y-5">
                <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 p-3">
                  <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Enter the 6-digit code from your authenticator app. You can also use one of your backup codes.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground" htmlFor="login-code">
                    Verification code
                  </label>
                  <Input
                    id="login-code"
                    type="text"
                    inputMode="text"
                    autoComplete="one-time-code"
                    autoFocus
                    required
                    placeholder="123456"
                    value={code}
                    onChange={e => setCode(e.target.value)}
                    className="h-10 text-sm bg-card tracking-widest"
                    data-testid="login-code"
                  />
                </div>
                <Button type="button" onClick={handleCode} disabled={isLoading}
                  className="w-full h-10 text-sm font-semibold" data-testid="login-verify">
                  {isLoading ? "Verifying…" : "Verify"}
                </Button>
                <button type="button" onClick={() => { setStage("credentials"); setCode(""); setError(""); }}
                  className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors">
                  Back to sign in
                </button>
              </div>
            )}
```

Update the header text at lines 132-137 so it reflects the stage:

```tsx
          <div className="space-y-1.5">
            <h2 className="text-2xl font-bold text-foreground">
              {stage === "totp" ? "Two-factor verification" : "Sign in"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {stage === "totp"
                ? "One more step to secure your account."
                : "Enter your credentials to access your workspace."}
            </p>
          </div>
```

- [ ] **Step 4: Verify the build compiles**

Run: `pnpm --filter @workspace/web typecheck`
Expected: PASS with no unused-import or missing-state errors.

- [ ] **Step 5: Manually verify both stages**

Run `pnpm --filter @workspace/web dev`, open `/login`, and confirm: signing in with a non-2FA account lands on `/`; signing in with an enrolled account shows the code step without navigating; a wrong code shows an error and stays put; "Back to sign in" returns to stage one.

- [ ] **Step 6: Commit**

```bash
git add app/app/login/page.tsx
git commit -m "feat(auth): username login form with in-page 2FA step"
```

---

## Task 16: Change-password and enrolment pages

**Files:**
- Create: `app/app/change-password/page.tsx`
- Create: `app/app/enroll-2fa/page.tsx`
- Modify: `app/middleware.ts`

**Interfaces:**
- Consumes: `POST /api/users/me/password` (Task 12); `POST /api/users/2fa/setup` and `/enable` (Task 11).
- Produces: two client pages that route onward using the same `next` contract as the login page.

Both pages are reachable mid-login, holding only a challenge cookie and no session, so **the middleware must not redirect them to `/login`**.

- [ ] **Step 1: Exempt the new pages from the session guard**

In `app/middleware.ts`, change the matcher at lines 32-37:

```ts
export const config = {
  matcher: [
    // Guard all page routes except login, the mid-login challenge pages, api,
    // and static/internal assets. change-password and enroll-2fa authenticate
    // via the challenge cookie, which is not a session.
    "/((?!login|change-password|enroll-2fa|api|_next/static|_next/image|favicon.ico).*)",
  ],
};
```

- [ ] **Step 2: Create the change-password page**

Create `app/app/change-password/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Lock, AlertCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const MIN_LENGTH = 12;

export default function ChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const tooShort = newPassword.length > 0 && newPassword.length < MIN_LENGTH;
  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors([]);
    if (newPassword !== confirmPassword) {
      setErrors(["The two passwords don't match."]);
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch("/api/users/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        if (json.next === "enroll_2fa") { window.location.href = "/enroll-2fa"; return; }
        if (json.next === "totp") { window.location.href = "/login"; return; }
        window.location.href = "/";
        return;
      }
      setErrors(json.errors ?? [json.error ?? "Unable to change password."]);
    } catch {
      setErrors(["Unable to connect to server. Please try again."]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-bold text-foreground">Choose a new password</h1>
          <p className="text-sm text-muted-foreground">
            Set a password you&apos;ll use from now on. This signs you out everywhere else.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {errors.length > 0 && (
            <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" data-testid="password-error">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <ul className="space-y-1">{errors.map(e => <li key={e}>{e}</li>)}</ul>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground" htmlFor="current-password">Current password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input id="current-password" type="password" autoComplete="current-password" required
                value={currentPassword} onChange={e => setCurrentPassword(e.target.value)}
                className="pl-9 h-10 text-sm bg-card" data-testid="current-password" />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground" htmlFor="new-password">New password</label>
            <Input id="new-password" type="password" autoComplete="new-password" required
              value={newPassword} onChange={e => setNewPassword(e.target.value)}
              className="h-10 text-sm bg-card" data-testid="new-password" />
            <p className={`text-[11px] ${tooShort ? "text-destructive" : "text-muted-foreground"}`}>
              At least {MIN_LENGTH} characters. A memorable phrase works well — no symbols required.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground" htmlFor="confirm-password">Confirm new password</label>
            <Input id="confirm-password" type="password" autoComplete="new-password" required
              value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
              className="h-10 text-sm bg-card" data-testid="confirm-password" />
            {mismatch && <p className="text-[11px] text-destructive">The two passwords don&apos;t match.</p>}
          </div>

          <Button type="submit" disabled={isLoading || tooShort || mismatch}
            className="w-full h-10 text-sm font-semibold" data-testid="password-submit">
            {isLoading ? "Saving…" : "Set new password"}
          </Button>
        </form>

        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" /> Checked against known breached passwords
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create the enrolment page**

Create `app/app/enroll-2fa/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Stage = "loading" | "scan" | "codes";

export default function Enroll2faPage() {
  const [stage, setStage] = useState<Stage>("loading");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/users/2fa/setup", { method: "POST" });
        if (!res.ok) { setError("Unable to start setup. Please sign in again."); setStage("scan"); return; }
        const json = await res.json();
        setQrDataUrl(json.qrDataUrl);
        setSecret(json.secret);
        setStage("scan");
      } catch {
        setError("Unable to connect to server.");
        setStage("scan");
      }
    })();
  }, []);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const res = await fetch("/api/users/2fa/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) { setBackupCodes(json.backupCodes ?? []); setStage("codes"); return; }
      setError(json.error ?? "That code isn't valid. Try the next one your app shows.");
    } catch {
      setError("Unable to connect to server.");
    } finally {
      setIsLoading(false);
    }
  };

  const copyCodes = async () => {
    await navigator.clipboard.writeText(backupCodes.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-sm space-y-8">
        {stage !== "codes" ? (
          <>
            <div className="space-y-1.5">
              <h1 className="text-2xl font-bold text-foreground">Set up two-factor authentication</h1>
              <p className="text-sm text-muted-foreground">
                Scan this with Google Authenticator, Authy, or 1Password, then enter the code it shows.
              </p>
            </div>

            {error && (
              <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" data-testid="enroll-error">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /><span>{error}</span>
              </div>
            )}

            {stage === "loading" ? (
              <div className="h-48 animate-pulse rounded-xl bg-muted" />
            ) : (
              qrDataUrl && (
                <div className="space-y-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrDataUrl} alt="Two-factor setup QR code"
                    className="mx-auto h-48 w-48 rounded-xl border border-border bg-white p-2" />
                  <details className="text-center">
                    <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                      Can&apos;t scan? Enter this key manually
                    </summary>
                    <code className="mt-2 block break-all rounded-lg bg-muted p-2 text-[11px] tracking-wider">{secret}</code>
                  </details>
                </div>
              )
            )}

            <form onSubmit={handleVerify} className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground" htmlFor="enroll-code">Verification code</label>
                <Input id="enroll-code" type="text" inputMode="numeric" autoComplete="one-time-code" required
                  placeholder="123456" value={code} onChange={e => setCode(e.target.value)}
                  className="h-10 text-sm bg-card tracking-widest" data-testid="enroll-code" />
              </div>
              <Button type="submit" disabled={isLoading || stage === "loading"}
                className="w-full h-10 text-sm font-semibold" data-testid="enroll-submit">
                {isLoading ? "Verifying…" : "Verify and enable"}
              </Button>
            </form>
          </>
        ) : (
          <>
            <div className="space-y-1.5">
              <h1 className="text-2xl font-bold text-foreground">Save your backup codes</h1>
              <p className="text-sm text-muted-foreground">
                Each code works once, and this is the only time they&apos;ll be shown. Store them somewhere safe —
                they&apos;re how you get in if you lose your phone.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-muted/40 p-4" data-testid="backup-codes">
              {backupCodes.map(c => (
                <code key={c} className="text-center text-sm tracking-wider text-foreground">{c}</code>
              ))}
            </div>

            <Button type="button" variant="outline" onClick={copyCodes} className="w-full h-10 text-sm">
              {copied ? <><Check className="mr-2 h-4 w-4" />Copied</> : <><Copy className="mr-2 h-4 w-4" />Copy all codes</>}
            </Button>

            <label className="flex items-start gap-2.5 text-sm text-foreground">
              <input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border" data-testid="codes-saved" />
              <span>I&apos;ve saved these codes somewhere safe.</span>
            </label>

            <Button type="button" disabled={!saved} onClick={() => { window.location.href = "/"; }}
              className="w-full h-10 text-sm font-semibold" data-testid="enroll-done">
              Continue to dashboard
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify the build compiles**

Run: `pnpm --filter @workspace/web typecheck`
Expected: PASS.

- [ ] **Step 5: Manually verify the full enrolment path**

Run `pnpm --filter @workspace/web dev`. Sign in as the seeded admin, confirm you are pushed to `/enroll-2fa`, scan the QR with a real authenticator app, enter the code, and confirm ten backup codes appear and "Continue" is disabled until the checkbox is ticked. **Save these codes** — you will need them.

- [ ] **Step 6: Commit**

```bash
git add app/app/change-password/ app/app/enroll-2fa/ app/middleware.ts
git commit -m "feat(auth): change-password and 2FA enrolment pages"
```

---

## Task 17: Settings → Users administration

**Files:**
- Modify: `app/app/(dashboard)/settings/page.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/users` returning `username`, `twoFactorEnabled`, `tempPassword` (Task 14); `POST /api/users/:id/reset-password` and `/reset-2fa` (Task 13).
- Produces: no new exports — UI only.

- [ ] **Step 1: Extend the User interface and fetch helpers**

In `app/app/(dashboard)/settings/page.tsx`, replace the `User` interface (around lines 31-37):

```tsx
interface User {
  id?: number;
  name: string;
  username: string;
  email: string;
  role: string;
  isSystem?: boolean;
  password?: string;
  twoFactorEnabled?: boolean;
}
```

Add these helpers next to the existing `getUsers`:

```tsx
async function resetUserPassword(id: number): Promise<string | null> {
  const res = await fetch(`/api/users/${id}/reset-password`, { method: "POST" });
  if (!res.ok) return null;
  return (await res.json()).tempPassword as string;
}

async function resetUserTwoFactor(id: number): Promise<boolean> {
  const res = await fetch(`/api/users/${id}/reset-2fa`, { method: "POST" });
  return res.ok;
}
```

- [ ] **Step 2: Add a username field to the user form**

Wherever the user dialog renders its Name and Email inputs, add a username field between them, with inline uniqueness feedback:

```tsx
<div className="space-y-1.5">
  <label className="text-xs font-semibold" htmlFor="user-username">Username</label>
  <Input
    id="user-username"
    value={userForm.username}
    onChange={e => setUserForm({ ...userForm, username: e.target.value.trim().toLowerCase() })}
    placeholder="ahmed.khan"
    data-testid="user-username"
  />
  {users.some(u => u.username === userForm.username && u.email !== userForm.email) && (
    <p className="text-[11px] text-destructive">That username is already taken.</p>
  )}
</div>
```

- [ ] **Step 3: Show 2FA status and the reset actions**

In the users list row, add a status badge and two actions beside the existing edit/delete buttons:

```tsx
<span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
  user.twoFactorEnabled
    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
    : "bg-muted text-muted-foreground"
}`}>
  {user.twoFactorEnabled ? "2FA on" : "2FA off"}
</span>

<Button variant="ghost" size="sm" disabled={user.isSystem}
  onClick={async () => {
    if (!user.id) return;
    const temp = await resetUserPassword(user.id);
    if (temp) {
      setTempPasswordDialog({ username: user.username, tempPassword: temp });
    } else {
      toast({ title: "Reset failed", description: "Could not reset that password.", variant: "destructive" });
    }
  }}>
  <Key className="h-3.5 w-3.5" />
</Button>

<Button variant="ghost" size="sm" disabled={!user.twoFactorEnabled}
  onClick={async () => {
    if (!user.id) return;
    const ok = await resetUserTwoFactor(user.id);
    toast({
      title: ok ? "Two-factor reset" : "Reset failed",
      description: ok
        ? `${user.username} will set up two-factor authentication again at next sign-in.`
        : "Could not reset two-factor authentication.",
      variant: ok ? undefined : "destructive",
    });
    if (ok) setUsers(await getUsers());
  }}>
  <Shield className="h-3.5 w-3.5" />
</Button>
```

- [ ] **Step 4: Add the one-time temp password dialog**

Add the state alongside the other `useState` calls:

```tsx
const [tempPasswordDialog, setTempPasswordDialog] = useState<{ username: string; tempPassword: string } | null>(null);
```

And render it near the other dialogs:

```tsx
<Dialog open={tempPasswordDialog !== null} onOpenChange={open => !open && setTempPasswordDialog(null)}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Temporary password for {tempPasswordDialog?.username}</DialogTitle>
    </DialogHeader>
    <p className="text-sm text-muted-foreground">
      Give this to the user directly. It won&apos;t be shown again, and they&apos;ll be asked
      to choose their own password the first time they sign in.
    </p>
    <code className="block rounded-lg bg-muted p-3 text-center text-base tracking-wider">
      {tempPasswordDialog?.tempPassword}
    </code>
    <DialogFooter>
      <Button onClick={() => {
        if (tempPasswordDialog) navigator.clipboard.writeText(tempPasswordDialog.tempPassword);
      }}>Copy</Button>
      <Button variant="outline" onClick={() => setTempPasswordDialog(null)}>Done</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

Reuse the same dialog for account creation: when `POST /api/users` returns a `tempPassword`, call `setTempPasswordDialog({ username, tempPassword })` instead of silently closing the form.

- [ ] **Step 5: Verify the build compiles**

Run: `pnpm --filter @workspace/web typecheck && pnpm --filter @workspace/web test`
Expected: PASS. `Shield` and `Key` are already imported at line 4 of this file.

- [ ] **Step 6: Commit**

```bash
git add "app/app/(dashboard)/settings/page.tsx"
git commit -m "feat(auth): username, 2FA status, and reset actions in user settings"
```

---

## Task 18: Account security self-service

**Files:**
- Create: `app/components/settings/AccountSecurity.tsx`
- Modify: `app/app/(dashboard)/settings/page.tsx`

**Interfaces:**
- Consumes: `GET /api/auth/me` returning `twoFactorEnabled` (Task 14); `POST /api/users/2fa/disable` and `/backup-codes` (Task 11); the `/change-password` and `/enroll-2fa` pages (Task 16).
- Produces: no new exports — a self-contained component rendered in Settings.

Without this, a non-privileged user has no way to turn 2FA *on*, and nobody has a way to change their password voluntarily — both endpoints exist but are unreachable from the UI.

- [ ] **Step 1: Create the component**

Create `app/components/settings/AccountSecurity.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, ShieldOff, KeyRound, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

export function AccountSecurity() {
  const { toast } = useToast();
  const [twoFactorEnabled, setTwoFactorEnabled] = useState<boolean | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/auth/me");
      if (res.ok) setTwoFactorEnabled(Boolean((await res.json()).twoFactorEnabled));
    })();
  }, []);

  const handleDisable = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/users/2fa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, code: code.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setTwoFactorEnabled(false);
        setDisableOpen(false);
        setPassword(""); setCode("");
        toast({ title: "Two-factor authentication disabled" });
      } else {
        toast({
          title: "Couldn't disable",
          description: json.error ?? "Check your password and code.",
          variant: "destructive",
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRegenerate = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/users/2fa/backup-codes", { method: "POST" });
      if (res.ok) {
        setNewCodes((await res.json()).backupCodes);
      } else {
        toast({ title: "Couldn't regenerate codes", variant: "destructive" });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Password</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Changing your password signs you out on every other device.
        </p>
        <Button variant="outline" size="sm" onClick={() => { window.location.href = "/change-password"; }}>
          Change password
        </Button>
      </div>

      <div className="rounded-xl border border-border p-4 space-y-3">
        <div className="flex items-center gap-2">
          {twoFactorEnabled
            ? <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            : <ShieldOff className="h-4 w-4 text-muted-foreground" />}
          <h3 className="text-sm font-semibold text-foreground">Two-factor authentication</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          {twoFactorEnabled === null
            ? "Checking…"
            : twoFactorEnabled
              ? "Enabled. You'll be asked for a code from your authenticator app when you sign in."
              : "Not enabled. Add a second factor so a stolen password isn't enough to get in."}
        </p>

        {twoFactorEnabled === false && (
          <Button size="sm" onClick={() => { window.location.href = "/enroll-2fa"; }}>
            Enable two-factor authentication
          </Button>
        )}

        {twoFactorEnabled === true && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={handleRegenerate}>
              <RefreshCw className="mr-2 h-3.5 w-3.5" /> Regenerate backup codes
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDisableOpen(true)}>
              Disable
            </Button>
          </div>
        )}
      </div>

      <Dialog open={disableOpen} onOpenChange={setDisableOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Disable two-factor authentication</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Confirm with your password and a current code. Your backup codes will be deleted.
          </p>
          <div className="space-y-3">
            <Input type="password" placeholder="Current password" autoComplete="current-password"
              value={password} onChange={e => setPassword(e.target.value)} />
            <Input type="text" placeholder="6-digit code" autoComplete="one-time-code"
              value={code} onChange={e => setCode(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisableOpen(false)}>Cancel</Button>
            <Button disabled={busy || !password || !code} onClick={handleDisable}>Disable</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={newCodes !== null} onOpenChange={open => !open && setNewCodes(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Your new backup codes</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Your previous codes no longer work. Each of these works once, and they won&apos;t be shown again.
          </p>
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-muted/40 p-4">
            {newCodes?.map(c => <code key={c} className="text-center text-sm tracking-wider">{c}</code>)}
          </div>
          <DialogFooter>
            <Button onClick={() => { if (newCodes) navigator.clipboard.writeText(newCodes.join("\n")); }}>
              Copy
            </Button>
            <Button variant="outline" onClick={() => setNewCodes(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Render it in Settings**

In `app/app/(dashboard)/settings/page.tsx`, add the import beside the existing `RolePermissionEditor` import:

```tsx
import { AccountSecurity } from "@/components/settings/AccountSecurity";
```

Render `<AccountSecurity />` inside the Security tab panel. This section is **not** permission-gated — every user manages their own account, so do not wrap it in `PermissionGuard`.

- [ ] **Step 3: Verify the build compiles**

Run: `pnpm --filter @workspace/web typecheck`
Expected: PASS.

- [ ] **Step 4: Manually verify self-service**

As a non-privileged user: enable 2FA from Settings, sign out, sign back in with a code, then regenerate backup codes and confirm an old code no longer works. Confirm the Disable button returns 403 for an admin account.

- [ ] **Step 5: Commit**

```bash
git add app/components/settings/AccountSecurity.tsx "app/app/(dashboard)/settings/page.tsx"
git commit -m "feat(auth): account security self-service for password and 2FA"
```

---

## Task 19: Environment configuration and rollout verification

**Files:**
- Modify: `.env.example`
- Modify: `app/.env.example`

**Interfaces:**
- Consumes: everything above.
- Produces: documented environment variables and a verified end-to-end run.

- [ ] **Step 1: Document the new environment variable**

Append to both `.env.example` and `app/.env.example`:

```bash
# 32-byte key, base64-encoded, used to encrypt TOTP secrets at rest.
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# WARNING: losing this makes every enrolled 2FA secret undecryptable and forces
# every user to re-enrol. Store it with the same care as JWT_SECRET.
TOTP_ENCRYPTION_KEY=
```

- [ ] **Step 2: Generate and set a real key locally**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Put the output in `app/.env` as `TOTP_ENCRYPTION_KEY=…`. Set the same variable in the Vercel project environment **before** deploying.

- [ ] **Step 3: Run the whole suite and typecheck**

Run: `pnpm typecheck && pnpm --filter @workspace/web test`
Expected: PASS. Every pre-existing test still green.

- [ ] **Step 4: Verify the end-to-end flows manually**

With `pnpm --filter @workspace/web dev` running, confirm each of these:

1. Existing user signs in by typing their **email into the Username field** — works unchanged.
2. Admin creates a user → temp password dialog appears → new user signs in → forced to `/change-password` → sets a 12+ character password → lands on the dashboard.
3. A password under 12 characters is rejected with a clear message; `password` (a known-breached value) is rejected too.
4. Admin without 2FA is pushed to `/enroll-2fa` and cannot reach the dashboard until enrolled.
5. Enrolled user signs in → code step appears → correct code lets them in.
6. A backup code works in place of an authenticator code, and the **same backup code fails the second time**.
7. Changing a password signs out a session open in another browser at its next API call.
8. Admin "Reset 2FA" on a user forces that user to re-enrol at next sign-in.

- [ ] **Step 5: Confirm production rate limiting is actually live**

`checkRateLimit` fails **open** when Upstash is unconfigured (`app/lib/rate-limit.ts:43`), so a misconfigured deploy silently has no login limiter. Verify `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set in the Vercel environment. TOTP brute-force protection is database-backed and unaffected.

- [ ] **Step 6: Commit**

```bash
git add .env.example app/.env.example
git commit -m "docs(auth): document TOTP_ENCRYPTION_KEY and rollout checks"
```

---

## Deployment notes

Apply in this order:

1. Set `TOTP_ENCRYPTION_KEY` in the production environment **first**. The 2FA routes throw without it.
2. Apply the schema: `pnpm --filter @workspace/db push`. The migration is additive and backfills usernames from emails, so no existing login breaks.
3. Deploy the application.
4. **Immediately sign in as an admin and complete 2FA enrolment**, storing the backup codes somewhere durable. Until at least one admin is enrolled with saved codes, a lost device means database surgery to recover.
5. Confirm a second account holds `settings.users:manage`, so the two admins can unlock each other.

## Rollback

Every task commits independently. To roll back the user-facing behaviour without touching the schema, revert the commits from Tasks 9-18 — the added columns are all nullable or defaulted and are harmless if unused. Reverting Task 5 requires dropping the columns and the `user_backup_codes` table, which discards enrolment data.