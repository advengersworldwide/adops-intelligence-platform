import { describe, it, expect } from "vitest";
import { fkViolationResponse } from "./fk-error";

describe("fkViolationResponse", () => {
  it("returns null for unrelated errors", () => {
    expect(fkViolationResponse(new Error("boom"))).toBeNull();
  });

  it("maps a top-level 23503 to a 409 with an entity-agnostic message", async () => {
    const res = fkViolationResponse(Object.assign(new Error("fk"), { code: "23503" }));
    expect(res?.status).toBe(409);
    const { error } = await res!.json();
    expect(error).toBe("Another record still depends on this. Remove the dependent records first, then try again.");
    // Must not instruct the user to open a dialog: only 3 of the 14 wrapped routes
    // (buying-houses, clients, partners) have the dependency-review dialog wired up.
    expect(error).not.toMatch(/dialog/i);
  });

  it("maps a nested cause 23503 to a 409", () => {
    const res = fkViolationResponse(Object.assign(new Error("fk"), { cause: { code: "23503" } }));
    expect(res?.status).toBe(409);
  });
});
