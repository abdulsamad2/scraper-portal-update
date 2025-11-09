import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '1000mb', // Increase body size limit for CSV operations
    },
  },
};

export default nextConfig;
