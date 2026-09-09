import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Keep the WhatsApp stack out of the bundle and let it resolve through a plain Node
   * require at runtime.
   *
   * whatsapp-web.js drags in puppeteer and unzipper, and unzipper's S3 helper does an
   * OPTIONAL `require('@aws-sdk/client-s3')` from inside a function body. That branch never
   * executes for us, but the bundler resolves requires statically, so it fails the build on
   * a dependency the feature does not use and nobody installed. Marking these external
   * leaves the require to Node, which only evaluates it if that code path is ever hit.
   *
   * It is also what you want regardless: puppeteer ships a Chromium download and native
   * bits that must not be traced into a serverless bundle.
   */
  serverExternalPackages: ['whatsapp-web.js', 'puppeteer', 'puppeteer-core', 'unzipper'],
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
