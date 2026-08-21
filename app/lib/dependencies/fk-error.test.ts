import { describe, it, expect } from "vitest";
import { fkViolationResponse } from "./fk-error";

describe("fkViolationResponse", () => {
  it("returns null for unrelated errors", () => {
    expect(fkViolationResponse(new Error("boom"))).toBeNull();
  });

  it("maps a top-level 23503 to a 409", async () => {
    const res = fkViolationResponse(Object.assign(new Error("fk"), { code: "23503" }));
    expect(res?.status).toBe(409);
    expect((await res!.json()).error).toMatch(/still depends on/i);
  });

  it("maps a nested cause 23503 to a 409", () => {
    const res = fkViolationResponse(Object.assign(new Error("fk"), { cause: { code: "23503" } }));
    expect(res?.status).toBe(409);
  });
});
