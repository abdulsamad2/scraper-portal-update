import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '1000mb', // Increase body size limit for CSV operations
    },
  },
  // Disable all caching to ensure fresh data
  headers: async () => [
    {
      source: '/(.*)',
      headers: [
        {
          key: 'Cache-Control',
          value: 'no-store, no-cache, must-revalidate, proxy-revalidate'
        },
        {
          key: 'Pragma',
          value: 'no-cache'
        },
        {
          key: 'Expires',
          value: '0'
        }
      ]
    }
  ],
};

export default nextConfig;
