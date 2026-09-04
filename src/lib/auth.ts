import { NextRequest } from 'next/server';

/**
 * Validates whether the incoming request contains a valid authorization token.
 * Checks URL query param (?token=... or ?key=...), HTTP-only cookie, or Authorization header.
 * Enforces FAIL-CLOSED security: if no token is configured, all requests are denied.
 */
export function isRequestAuthorized(req: NextRequest): boolean {
  const primaryToken = process.env.DASHBOARD_ACCESS_TOKEN?.trim();
  const ingestToken = process.env.INGEST_SECRET_TOKEN?.trim();
  const validTokens = [primaryToken, ingestToken].filter(Boolean) as string[];

  // Fail-closed: If no token is configured in environment, deny all access
  if (validTokens.length === 0) {
    return false;
  }

  const { searchParams } = req.nextUrl;
  const queryToken = searchParams.get('token')?.trim() || searchParams.get('key')?.trim();
  const cookieToken = req.cookies.get('vicarius_access_token')?.value?.trim();
  const authHeader = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  const headerToken = req.headers.get('x-access-token')?.trim() || authHeader;

  const candidate = queryToken || cookieToken || headerToken;
  if (!candidate) {
    return false;
  }

  return validTokens.includes(candidate);
}
