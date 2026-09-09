import { timingSafeEqual } from 'crypto';

/**
 * Username/password validation — Node runtime only.
 *
 * This lives apart from lib/auth.ts because middleware.ts imports that module,
 * and middleware runs on the Edge runtime, where node:crypto does not exist.
 * Merely importing it was enough to trip: Next bundles the whole module graph,
 * so `timingSafeEqual` was pulled into the Edge bundle and warned on every
 * request, even though middleware only ever calls verifySession() and never
 * reaches this code.
 *
 * Only the login route needs these, and it runs on Node, where node:crypto is
 * fine. Keep it that way — do not import this from middleware.
 */

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Compare a against itself to spend constant time, then return false
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Validate credentials against server-side environment variables.
 * Credentials are NEVER exposed to the client.
 * Returns the role ('superadmin' | 'admin') or null if invalid.
 */
export function validateCredentials(username: string, password: string): 'superadmin' | 'admin' | null {
  const validUsername = process.env.AUTH_USERNAME;
  const validPassword = process.env.AUTH_PASSWORD;
  const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD;

  if (!validUsername || !validPassword) {
    console.error('AUTH_USERNAME or AUTH_PASSWORD env vars are not set');
    return null;
  }

  const usernameMatch = safeCompare(username, validUsername);
  if (!usernameMatch) return null;

  // Check superadmin password first
  if (superAdminPassword && safeCompare(password, superAdminPassword)) {
    return 'superadmin';
  }

  // Check regular admin password
  if (safeCompare(password, validPassword)) {
    return 'admin';
  }

  return null;
}
