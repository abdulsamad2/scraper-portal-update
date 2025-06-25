import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb', // Increase body size limit for CSV operations
    },
  },
  output: 'standalone', // Enable standalone output for Docker
};

export default nextConfig;
