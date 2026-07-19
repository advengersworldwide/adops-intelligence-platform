import { describe, it, expect } from "vitest";
import { parseIdList, parseEngine } from "./parse-params";

describe("parse-params", () => {
  it("parses a comma-separated id list, dropping non-numbers", () => {
    expect(parseIdList("1,2,x,3")).toEqual([1, 2, 3]);
    expect(parseIdList(null)).toEqual([]);
    expect(parseIdList("")).toEqual([]);
  });
  it("defaults engine to combined for invalid input", () => {
    expect(parseEngine("media")).toBe("media");
    expect(parseEngine("bogus")).toBe("combined");
    expect(parseEngine(null)).toBe("combined");
  });
});
