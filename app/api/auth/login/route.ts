import { NextResponse } from 'next/server';
import { validateCredentials, createSessionToken, getSessionCookieConfig } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password are required' },
        { status: 400 }
      );
    }

    // Validate on the server — credentials never leave the server
    const isValid = validateCredentials(username, password);

    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid username or password' },
        { status: 401 }
      );
    }

    // Create signed JWT
    const token = await createSessionToken(username);

    // Set HttpOnly cookie (not accessible from client JS)
    const response = NextResponse.json({ success: true });
    const cookieConfig = getSessionCookieConfig(token);
    response.cookies.set(cookieConfig);

    return response;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
