import { describe, it, expect } from "vitest";
import { formatPoCode } from "./po-codes";

describe("formatPoCode", () => {
  it("zero-pads the sequence to 4 digits", () => {
    expect(formatPoCode("CPO", 2026, 1)).toBe("CPO-2026-0001");
    expect(formatPoCode("PPO", 2026, 42)).toBe("PPO-2026-0042");
  });
  it("does not truncate sequences beyond 4 digits", () => {
    expect(formatPoCode("CPO", 2026, 12345)).toBe("CPO-2026-12345");
  });
  it("works for years other than 2026", () => {
    expect(formatPoCode("PPO", 2027, 1)).toBe("PPO-2027-0001");
  });
});
