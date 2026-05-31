import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: process.cwd(),
  typedRoutes: true,
  allowedDevOrigins: ["daniels-macbook-pro.tail2be9f6.ts.net"],
  serverExternalPackages: ["pdf-parse"],
};

export default nextConfig;
