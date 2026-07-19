import { describe, it, expect } from "vitest";
import { collectionState } from "./collection-state";

describe("collectionState", () => {
  it("classifies paid / partial / outstanding", () => {
    expect(collectionState(100, 100)).toBe("paid");
    expect(collectionState(100, 100.0000001)).toBe("paid");
    expect(collectionState(100, 40)).toBe("partial");
    expect(collectionState(100, 0)).toBe("outstanding");
  });
  it("treats a fully-credited/zero-net billing as paid", () => {
    expect(collectionState(0, 0)).toBe("paid");
  });
});
