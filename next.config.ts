import type { NextConfig } from "next";
import { securityHeaders } from "./lib/security/headers";

const isVercel = process.env.VERCEL === "1";

const nextConfig: NextConfig = {
  distDir: isVercel ? ".next" : process.env.NEXT_DIST_DIR || ".next-build",
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: [
      ...securityHeaders,
      ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
    ] }];
  },
};

export default nextConfig;
