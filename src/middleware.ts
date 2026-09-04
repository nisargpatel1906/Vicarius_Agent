import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Vicarius Edge Security Gate Middleware
 * Enforces strict FAIL-CLOSED access control for all pages, API endpoints, and static routes.
 * Unauthorized requests receive a stealth HTTP 404 Not Found response.
 */
export function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;
  const method = req.method.toUpperCase();

  // 1. Static asset exemptions (only Next.js runtime chunks & public icons)
  if (
    pathname.startsWith('/_next/static') ||
    pathname.startsWith('/_next/image') ||
    pathname === '/favicon.ico' ||
    pathname === '/icon.svg' ||
    pathname === '/logo.svg' ||
    pathname === '/not-found'
  ) {
    return NextResponse.next();
  }

  // 2. Incoming external webhooks (POST-only; any GET/probing returns 404)
  if (pathname === '/api/telegram' || pathname.startsWith('/api/webhooks/')) {
    if (method !== 'POST') {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    }
    return NextResponse.next();
  }

  // 3. Resolve configured authorization secret tokens
  const primaryToken = process.env.DASHBOARD_ACCESS_TOKEN?.trim();
  const ingestToken = process.env.INGEST_SECRET_TOKEN?.trim();
  const validTokens = [primaryToken, ingestToken].filter(Boolean) as string[];

  // FAIL-CLOSED: If environment has no security token configured, deny ALL access with 404
  if (validTokens.length === 0) {
    return pathname.startsWith('/api/')
      ? NextResponse.json({ error: 'Not Found' }, { status: 404 })
      : NextResponse.rewrite(new URL('/not-found', req.url), { status: 404 });
  }

  // 4. Extract token from Query Param, Cookie, or Authorization Header
  const queryToken = searchParams.get('token')?.trim() || searchParams.get('key')?.trim();
  const cookieToken = req.cookies.get('vicarius_access_token')?.value?.trim();
  const authHeader = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  const headerToken = req.headers.get('x-access-token')?.trim() || authHeader;

  const candidateToken = queryToken || cookieToken || headerToken;
  const isAuthorized = candidateToken ? validTokens.includes(candidateToken) : false;

  // 5. Ingest endpoint: must provide valid bearer token or query token, else 404
  if (pathname === '/api/ingest') {
    if (isAuthorized) {
      return NextResponse.next();
    }
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }

  // 6. Handle Page routes (e.g. /, /dashboard)
  if (!pathname.startsWith('/api/')) {
    // If authenticated via query parameter (?token=KEY), set cookie and strip token from address bar
    if (queryToken && validTokens.includes(queryToken)) {
      const cleanUrl = new URL(pathname, req.url);
      searchParams.forEach((val: string, key: string) => {
        if (key !== 'token' && key !== 'key') {
          cleanUrl.searchParams.set(key, val);
        }
      });

      const response = NextResponse.redirect(cleanUrl);
      response.cookies.set('vicarius_access_token', queryToken, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30, // 30 days
      });
      return response;
    }

    // If authenticated via persistent cookie
    if (isAuthorized) {
      return NextResponse.next();
    }

    // Unauthorized visitor: Rewrite to /not-found with stealth 404 status
    const notFoundUrl = new URL('/not-found', req.url);
    return NextResponse.rewrite(notFoundUrl, {
      status: 404,
      headers: {
        'x-robots-tag': 'noindex, nofollow',
      },
    });
  }

  // 7. Handle Internal API routes (/api/tasks, /api/profile, /api/health, etc.)
  if (isAuthorized) {
    return NextResponse.next();
  }

  // Unauthorized API call: Return clean 404 JSON (hiding endpoint existence)
  return NextResponse.json(
    { error: 'Not Found' },
    { status: 404 }
  );
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
