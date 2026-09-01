import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '1000mb', // Increase body size limit for CSV operations
      /**
       * Behind a reverse proxy, Next compares a Server Action's Origin against
       * the host it thinks it is serving. When they disagree it discards the
       * action: the POST still returns 200, nothing runs, and the browser shows
       * no error -- buttons simply stop working. List the hostnames users
       * actually type, comma-separated, in PORTAL_ALLOWED_ORIGINS.
       *
       * Left unset, Next keeps its default behaviour.
       */
      allowedOrigins: process.env.PORTAL_ALLOWED_ORIGINS
        ?.split(',')
        .map((h) => h.trim())
        .filter(Boolean),
    },
    staleTimes: {
      dynamic: 0,  // disable client-side Router Cache for dynamic routes
      static: 0,   // disable client-side Router Cache for static routes
    },
  },
};

export default nextConfig;
