import { describe, it, expect } from "vitest";
import { invoiceClauses } from "./invoice-clauses";

describe("invoiceClauses", () => {
  it("uses the payment term when provided", () => {
    expect(invoiceClauses("Net 30")[0]).toBe("Payment terms: Net 30");
  });
  it("uses the fallback when the term is empty/null", () => {
    expect(invoiceClauses("", "as agreed with the partner")[0]).toBe("Payment terms: as agreed with the partner");
    expect(invoiceClauses(null)[0]).toBe("Payment terms: as agreed");
  });
  it("returns the standard 6 clauses ending with the signature note", () => {
    const c = invoiceClauses("Net 30");
    expect(c).toHaveLength(6);
    expect(c[c.length - 1]).toContain("system generated document");
  });
});
