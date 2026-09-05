import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['pdf-parse', 'mammoth'],
};

export default nextConfig;
