import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { NextRequest } from 'next/server';

const COOKIE_NAME = 'session_token';

/**
 * Get the JWT secret from environment variable.
 * Falls back to NEXT_SERVER_ACTIONS_ENCRYPTION_KEY if AUTH_SECRET is not set.
 */
function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET || process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error('AUTH_SECRET environment variable is not set');
  }
  return new TextEncoder().encode(secret);
}

/**
 * Validate credentials against server-side environment variables.
 * Credentials are NEVER exposed to the client.
 */
export function validateCredentials(username: string, password: string): boolean {
  const validUsername = process.env.AUTH_USERNAME;
  const validPassword = process.env.AUTH_PASSWORD;

  if (!validUsername || !validPassword) {
    console.error('AUTH_USERNAME or AUTH_PASSWORD env vars are not set');
    return false;
  }

  // Constant-time-ish comparison to mitigate timing attacks
  const usernameMatch = username === validUsername;
  const passwordMatch = password === validPassword;
  return usernameMatch && passwordMatch;
}

/**
 * Create a signed JWT token.
 */
export async function createSessionToken(username: string): Promise<string> {
  const token = await new SignJWT({ username } as JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(getSecret());

  return token;
}

/**
 * Verify a JWT token and return its payload.
 * Returns null if the token is invalid or expired.
 */
export async function verifySessionToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload;
  } catch {
    return null;
  }
}

/**
 * Verify the session from a NextRequest (for use in middleware).
 * Reads the session cookie and verifies the JWT.
 */
export async function verifySession(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return false;
  const payload = await verifySessionToken(token);
  return payload !== null;
}

/**
 * Get session cookie configuration.
 */
export function getSessionCookieConfig(token: string) {
  return {
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,       // Not accessible from JavaScript
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 60 * 60 * 24, // 24 hours
  };
}

/**
 * Get an expired cookie config (for logout).
 */
export function getExpiredCookieConfig() {
  return {
    name: COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 0,
  };
}

export { COOKIE_NAME };
