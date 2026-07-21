import { describe, it, expect } from "vitest";
import { resolveInitialDashboard, readLocalDashboard, LOCAL_KEYS } from "./resolve-layout";

const fallback = { activeWidgets: ["revenue-kpi"], layout: [{ i: "revenue-kpi", x: 0, y: 0, w: 3, h: 3 }], preset: "exec" };

describe("resolveInitialDashboard", () => {
  it("uses the server row when present", () => {
    const server = { activeWidgets: ["profit-kpi"], layout: [], preset: null };
    expect(resolveInitialDashboard(server, null, fallback)).toEqual({ value: server, migrateFromLocal: false });
  });
  it("migrates from local when server is null and local exists", () => {
    const local = { activeWidgets: ["cost-kpi"], layout: [{ i: "cost-kpi", x: 0, y: 0, w: 3, h: 3 }], preset: null };
    expect(resolveInitialDashboard(null, local, fallback)).toEqual({ value: local, migrateFromLocal: true });
  });
  it("falls back to the default preset when both are empty", () => {
    expect(resolveInitialDashboard(null, null, fallback)).toEqual({ value: fallback, migrateFromLocal: false });
  });
});

describe("readLocalDashboard", () => {
  it("returns null when no legacy keys are set", () => {
    const store = new Map<string, string>();
    const shim = { getItem: (k: string) => store.get(k) ?? null } as unknown as Storage;
    expect(readLocalDashboard(shim)).toBeNull();
  });
  it("reads legacy localStorage keys", () => {
    const store = new Map<string, string>([
      [LOCAL_KEYS.widgets, JSON.stringify(["revenue"])],
      [LOCAL_KEYS.layout, JSON.stringify([{ i: "revenue-kpi", x: 0, y: 0, w: 3, h: 3 }])],
    ]);
    const shim = { getItem: (k: string) => store.get(k) ?? null } as unknown as Storage;
    expect(readLocalDashboard(shim)).toMatchObject({ activeWidgets: ["revenue"] });
  });
});