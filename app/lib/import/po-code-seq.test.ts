// app/lib/import/po-code-seq.test.ts
import { describe, it, expect } from "vitest";
import { parsePoCode, seedMaxSeq } from "./po-code-seq";

describe("parsePoCode", () => {
  it("parses tag/prefix/mmyy/seq", () => {
    expect(parsePoCode("PPO-ACME-0126-0003")).toEqual({ tag: "PPO", prefix: "ACME", mmyy: "0126", seq: 3 });
    expect(parsePoCode("CPO-BETA2-0226-0012")).toEqual({ tag: "CPO", prefix: "BETA2", mmyy: "0226", seq: 12 });
  });
  it("returns null for non-matching codes", () => {
    expect(parsePoCode("garbage")).toBeNull();
  });
});

describe("seedMaxSeq", () => {
  it("keeps the max sequence per (prefix, mmyy) for the given tag only", () => {
    const map = seedMaxSeq(
      ["PPO-ACME-0126-0001", "PPO-ACME-0126-0004", "PPO-ACME-0226-0002", "CPO-ACME-0126-0009", "bad"],
      "PPO",
    );
    expect(map.get("ACME|0126")).toBe(4);
    expect(map.get("ACME|0226")).toBe(2);
    expect(map.size).toBe(2); // the CPO code is excluded
  });
});
