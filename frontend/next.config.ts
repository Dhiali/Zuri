import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hides the floating Next.js "N" dev tools button (development only).
  devIndicators: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
