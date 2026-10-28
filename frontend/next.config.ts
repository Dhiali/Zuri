import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pins the workspace root so a stray lockfile in a parent folder isn't picked up.
  turbopack: { root: path.resolve(__dirname) },
  // Hides the floating Next.js "N" dev tools button (development only).
  devIndicators: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
