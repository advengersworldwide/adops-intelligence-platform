import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Consume workspace libs' TS source directly (no separate build step).
  transpilePackages: [
    "@workspace/db",
    "@workspace/api-zod",
    "@workspace/api-client-react",
  ],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
