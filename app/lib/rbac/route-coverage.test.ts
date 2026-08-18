import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = join(here, "..", "..", "app", "api");

// Routes that are truly public (no auth required).
const PUBLIC_ALLOWLIST = [
  "healthz/route.ts",
  "users/login/route.ts",
  "users/logout/route.ts",
];

// Routes that self-guard inline (getSession + explicit auth enforcement).
// These do not use requirePermission() because they need full permission context
// or special bootstrap behavior. Must verify they have getSession( and either
// a 401 (auth required) or 403 (permission denied) response.
const SELF_GUARDED_ROUTES = [
  "auth/me/route.ts",
  "dependencies/route.ts",
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
      if (SELF_GUARDED_ROUTES.includes(rel)) continue;
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

  it("self-guarded routes have getSession( and auth enforcement (401 or 403)", () => {
    const missing: { file: string; checks: string[] }[] = [];
    for (const rel of SELF_GUARDED_ROUTES) {
      if (!routeFiles().includes(rel)) {
        missing.push({ file: rel, checks: ["file does not exist"] });
        continue;
      }
      const src = readFileSync(join(apiDir, rel), "utf8");
      const checks: string[] = [];
      if (!/getSession\s*\(/.test(src)) checks.push("missing getSession(");
      if (!/status:\s*(401|403)/.test(src)) checks.push("missing status: 401 or 403");
      if (checks.length > 0) missing.push({ file: rel, checks });
    }
    expect(missing, `Self-guarded routes missing security checks:\n${missing.map((m) => `${m.file}: ${m.checks.join(", ")}`).join("\n")}`).toEqual([]);
  });
});
