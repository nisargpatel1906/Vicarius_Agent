import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { isAllowed, isOperatorAuthorized } from '@/lib/auth';

/**
 * Vicarius Edge Security Gate Middleware
 * Implements strict verified authentication via @supabase/ssr.
 * All route access requires verified cryptographic session check.
 */
export async function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;
  const method = req.method.toUpperCase();

  // 1. Static asset exemptions
  if (
    pathname.startsWith('/_next/static') ||
    pathname.startsWith('/_next/image') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.ico') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.jpg') ||
    pathname.endsWith('.webp') ||
    pathname === '/favicon.ico' ||
    pathname === '/not-found'
  ) {
    return NextResponse.next();
  }

  // 2. External webhooks (POST-only Telegram & Google push webhooks)
  if (pathname === '/api/telegram' || pathname.startsWith('/api/webhooks/')) {
    if (method !== 'POST') {
      return NextResponse.json({ error: 'Method Not Allowed' }, { status: 405 });
    }
    return NextResponse.next();
  }

  // 3. Automated Cron / Ingest pipelines (Protected by constant-time secret token)
  if (pathname === '/api/ingest' || pathname === '/api/briefing') {
    if (isOperatorAuthorized(req)) {
      return NextResponse.next();
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 4. Create response and Supabase SSR client to refresh session cookies
  let response = NextResponse.next({
    request: {
      headers: req.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
          response = NextResponse.next({
            request: {
              headers: req.headers,
            },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // 5. Verify user session via official Supabase auth server check
  const { data: { user } } = await supabase.auth.getUser();
  const isUserAllowed = user && isAllowed(user.email);

  // 6. Auth routes (/login, /auth/*)
  const isAuthRoute = pathname === '/login' || pathname.startsWith('/auth/');
  if (isAuthRoute) {
    if (isUserAllowed && pathname === '/login') {
      const dest = searchParams.get('redirect') || '/';
      return NextResponse.redirect(new URL(dest, req.url));
    }
    return response;
  }

  // 7. Page routes (e.g. /, /setup, /tasks, /world, etc.)
  if (!pathname.startsWith('/api/')) {
    if (!isUserAllowed) {
      const loginUrl = new URL('/login', req.url);
      if (pathname !== '/') {
        loginUrl.searchParams.set('redirect', pathname);
      }
      return NextResponse.redirect(loginUrl);
    }

    return response;
  }

  // 8. Protected API routes (/api/tasks, /api/profile, etc.)
  if (isUserAllowed || isOperatorAuthorized(req)) {
    return response;
  }

  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
