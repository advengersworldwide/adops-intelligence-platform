import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = join(here, "..", "..", "app", "api");

// Routes that legitimately need no requirePermission guard.
// - public: healthz, login, logout
// - auth/me self-guards inline (getSession -> 401) and returns the permission
//   set that bootstraps the client, so it cannot require a specific permission.
// - login/2fa is pre-session by construction: it exchanges a short-lived
//   challenge cookie (issued by login, verified via verifyChallenge) for the
//   real session, so requireAuth/requireAdmin/requirePermission cannot apply —
//   there is no session yet to check. It guards itself via the challenge
//   token plus TOTP/backup-code verification and database-backed lockout.
const PUBLIC_ALLOWLIST = [
  "healthz/route.ts",
  "users/login/route.ts",
  "users/login/2fa/route.ts",
  "users/logout/route.ts",
  "auth/me/route.ts",
];

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function routeFiles(): string[] {
  return readdirSync(apiDir, { recursive: true })
    .map((p) => String(p).replace(/\\/g, "/"))
    .filter((p) => p.endsWith("route.ts"));
}

describe("every API route enforces authorization", () => {
  it("has a require* guard in each exported HTTP handler", () => {
    const offenders: string[] = [];
    for (const rel of routeFiles()) {
      if (PUBLIC_ALLOWLIST.includes(rel)) continue;
      const src = readFileSync(join(apiDir, rel), "utf8");
      const exportsHandler = HTTP_METHODS.some((m) =>
        new RegExp(`export async function ${m}\\b`).test(src),
      );
      if (!exportsHandler) continue;
      const guarded = /require(Auth|Admin|Permission)\s*\(/.test(src);
      if (!guarded) offenders.push(rel);
    }
    expect(offenders, `Unguarded routes:\n${offenders.join("\n")}`).toEqual([]);
  });
});
