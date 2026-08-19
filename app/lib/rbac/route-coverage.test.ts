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
// or special bootstrap behavior. Each must have getSession( and the listed status codes.
const SELF_GUARDED_ROUTES: { file: string; requiredStatusCodes: number[] }[] = [
  { file: "auth/me/route.ts", requiredStatusCodes: [401] },
  { file: "dependencies/route.ts", requiredStatusCodes: [401, 403] },
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
    const selfGuardedFiles = new Set(SELF_GUARDED_ROUTES.map((r) => r.file));
    for (const rel of routeFiles()) {
      if (PUBLIC_ALLOWLIST.includes(rel)) continue;
      if (selfGuardedFiles.has(rel)) continue;
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

  it("self-guarded routes have getSession( and all required status codes", () => {
    const missing: { file: string; checks: string[] }[] = [];
    for (const route of SELF_GUARDED_ROUTES) {
      if (!routeFiles().includes(route.file)) {
        missing.push({ file: route.file, checks: ["file does not exist"] });
        continue;
      }
      const src = readFileSync(join(apiDir, route.file), "utf8");
      const checks: string[] = [];
      if (!/getSession\s*\(/.test(src)) checks.push("missing getSession(");
      for (const code of route.requiredStatusCodes) {
        if (!new RegExp(`status:\\s*${code}`).test(src)) {
          checks.push(`missing status: ${code}`);
        }
      }
      if (checks.length > 0) missing.push({ file: route.file, checks });
    }
    expect(missing, `Self-guarded routes missing security checks:\n${missing.map((m) => `${m.file}: ${m.checks.join(", ")}`).join("\n")}`).toEqual([]);
  });
});
