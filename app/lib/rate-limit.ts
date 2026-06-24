import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

type Bucket = "login" | "global";

const LIMITS: Record<Bucket, { tokens: number; window: `${number} ${"s" | "m"}` }> = {
  login: { tokens: 10, window: "15 m" }, // mirrors old express loginLimiter
  global: { tokens: 100, window: "1 m" },
};

let redis: Redis | null = null;
const limiters = new Map<Bucket, Ratelimit>();

function getRedis(): Redis | null {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  redis = new Redis({ url, token });
  return redis;
}

function getLimiter(bucket: Bucket): Ratelimit | null {
  const existing = limiters.get(bucket);
  if (existing) return existing;
  const client = getRedis();
  if (!client) return null;
  const limiter = new Ratelimit({
    redis: client,
    limiter: Ratelimit.slidingWindow(LIMITS[bucket].tokens, LIMITS[bucket].window),
    prefix: `rl:${bucket}`,
  });
  limiters.set(bucket, limiter);
  return limiter;
}

export async function checkRateLimit(
  bucket: Bucket,
  identifier: string,
): Promise<{ success: boolean }> {
  const limiter = getLimiter(bucket);
  // Fail open when Upstash isn't configured (local dev).
  if (!limiter) return { success: true };
  const { success } = await limiter.limit(identifier);
  return { success };
}
