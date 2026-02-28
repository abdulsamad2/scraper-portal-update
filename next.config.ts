import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '1000mb', // Increase body size limit for CSV operations
    },
    staleTimes: {
      dynamic: 0,  // disable client-side Router Cache for dynamic routes
      static: 0,   // disable client-side Router Cache for static routes
    },
  },
};

export default nextConfig;
