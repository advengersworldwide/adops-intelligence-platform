import type { RevenueEngine } from "./filters";

export function parseIdList(raw: string | null | undefined): number[] {
  if (!raw) return [];
  return raw.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
}

export function parseEngine(raw: string | null | undefined): RevenueEngine {
  return raw === "media" || raw === "performance" ? raw : "combined";
}
