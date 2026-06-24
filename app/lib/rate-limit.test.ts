import { describe, it, expect, beforeEach } from "vitest";
import { checkRateLimit } from "./rate-limit";

describe("rate limit", () => {
  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  it("fails open (success=true) when Upstash is not configured", async () => {
    const result = await checkRateLimit("login", "1.2.3.4");
    expect(result.success).toBe(true);
  });
});
