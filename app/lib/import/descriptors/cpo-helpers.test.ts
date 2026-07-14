// app/lib/import/descriptors/cpo-helpers.test.ts
import { describe, it, expect } from "vitest";
import {
  normalizeName, parseDateCell, dedupKey, mmyyKey, isoToLocalDate, parseCpoCode, seedMaxSeq,
} from "./cpo-helpers";

describe("parseDateCell", () => {
  it("returns null for an empty cell", () => {
    const errs: string[] = [];
    expect(parseDateCell("", "Receive Date", errs)).toBeNull();
    expect(errs).toEqual([]);
  });
  it("passes through a valid ISO date", () => {
    const errs: string[] = [];
    expect(parseDateCell("2026-01-05", "Receive Date", errs)).toBe("2026-01-05");
    expect(errs).toEqual([]);
  });
  it("rejects a malformed date with a labelled error", () => {
    const errs: string[] = [];
    expect(parseDateCell("05/01/2026", "Receive Date", errs)).toBeNull();
    expect(errs[0]).toContain("Receive Date");
  });
  it("rejects an impossible date", () => {
    const errs: string[] = [];
    expect(parseDateCell("2026-13-40", "Receive Date", errs)).toBeNull();
    expect(errs.length).toBe(1);
  });
});

describe("dedupKey", () => {
  it("builds a stable key from client + dates", () => {
    expect(dedupKey(7, "2026-01-05", null, "2026-02-01")).toBe("7|2026-01-05||2026-02-01");
  });
});

describe("mmyyKey", () => {
  it("formats month+2-digit-year", () => {
    expect(mmyyKey(isoToLocalDate("2026-01-05"))).toBe("0126");
  });
});

describe("parseCpoCode / seedMaxSeq", () => {
  it("parses a generated code into prefix/mmyy/seq", () => {
    expect(parseCpoCode("CPO-ACME-0126-0003")).toEqual({ prefix: "ACME", mmyy: "0126", seq: 3 });
  });
  it("ignores non-matching codes", () => {
    expect(parseCpoCode("garbage")).toBeNull();
  });
  it("seeds the max sequence per (prefix, mmyy) group", () => {
    const map = seedMaxSeq(["CPO-ACME-0126-0001", "CPO-ACME-0126-0004", "CPO-ACME-0226-0002", "bad"]);
    expect(map.get("ACME|0126")).toBe(4);
    expect(map.get("ACME|0226")).toBe(2);
  });
});
