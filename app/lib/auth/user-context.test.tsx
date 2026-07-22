import { describe, it, expect } from "vitest";
import { computeCan } from "./user-context";

describe("computeCan", () => {
  it("grants when permission present", () => {
    expect(computeCan(["clients:view"], "clients:view")).toBe(true);
  });
  it("denies when absent", () => {
    expect(computeCan(["clients:view"], "clients:edit")).toBe(false);
  });
  it("denies when permissions null (still loading)", () => {
    expect(computeCan(null, "clients:view")).toBe(false);
  });
});
