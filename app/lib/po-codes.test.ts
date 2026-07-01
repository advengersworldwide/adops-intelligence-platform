import { describe, it, expect } from "vitest";
import { formatPoCode, derivePrefix } from "./po-codes";

describe("formatPoCode", () => {
  it("formats PREFIX-MMYY-NNNN with zero-padded month and sequence", () => {
    expect(formatPoCode("EPAY", new Date(2026, 0, 15), 1)).toBe("EPAY-0126-0001");
    expect(formatPoCode("JAZZ", new Date(2026, 0, 15), 2)).toBe("JAZZ-0126-0002");
  });
  it("uses 2-digit month for later months", () => {
    expect(formatPoCode("SAND", new Date(2026, 11, 1), 7)).toBe("SAND-1226-0007");
  });
  it("uses the 2-digit year and rolls over", () => {
    expect(formatPoCode("SAND", new Date(2027, 5, 1), 1)).toBe("SAND-0627-0001");
  });
  it("does not truncate sequences beyond 4 digits", () => {
    expect(formatPoCode("EPAY", new Date(2026, 0, 1), 12345)).toBe("EPAY-0126-12345");
  });
});

describe("derivePrefix", () => {
  it("takes the first 4 alphanumeric letters, uppercased", () => {
    expect(derivePrefix("Easypaisa")).toBe("EASY");
    expect(derivePrefix("JazzCash")).toBe("JAZZ");
  });
  it("strips spaces and punctuation before taking 4 chars", () => {
    expect(derivePrefix("U Micro Finance")).toBe("UMIC");
  });
  it("right-pads short names with X to reach 4 chars", () => {
    expect(derivePrefix("Al")).toBe("ALXX");
    expect(derivePrefix("")).toBe("XXXX");
  });
});
