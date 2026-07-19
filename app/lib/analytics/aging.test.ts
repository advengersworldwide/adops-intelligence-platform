import { describe, it, expect } from "vitest";
import { bucketByAge } from "./aging";

describe("bucketByAge", () => {
  const asOf = new Date("2026-07-11T00:00:00Z");
  it("buckets amounts by age in days", () => {
    const r = bucketByAge([
      { amount: 100, date: "2026-07-01" }, // 10d
      { amount: 50, date: "2026-06-01" },  // 40d
      { amount: 40, date: "2026-05-05" },  // 67d
      { amount: 25, date: "2026-03-01" },  // 132d
    ], asOf);
    expect(r).toEqual({ "0-30": 100, "31-60": 50, "61-90": 40, "90+": 25 });
  });
  it("treats null date as age 0 and sums within a bucket", () => {
    const r = bucketByAge([{ amount: 10, date: null }, { amount: 5, date: "2026-07-10" }], asOf);
    expect(r["0-30"]).toBe(15);
  });
  it("returns all-zero buckets for empty input", () => {
    expect(bucketByAge([], asOf)).toEqual({ "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 });
  });
});
