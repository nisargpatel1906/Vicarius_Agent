import { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseAdmin } from './supabase';
import type { User } from '@supabase/supabase-js';

/**
 * Resolves the list of allow-listed emails from environment variables.
 * Checks ALLOWED_EMAILS (comma-separated) and OWNER_EMAIL.
 */
export function getAllowedEmails(): string[] {
  const envList = (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const owner = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (owner && !envList.includes(owner)) {
    envList.push(owner);
  }

  return envList;
}

/**
 * Checks whether the given email address is authorized for this deployment.
 * If ALLOWED_EMAILS and OWNER_EMAIL are both empty, allows all authenticated users (single-tenant open model).
 */
export function isAllowed(email?: string | null): boolean {
  if (!email) return false;
  const allowed = getAllowedEmails();
  if (allowed.length === 0) return true;
  return allowed.includes(email.toLowerCase());
}

/**
 * Edge-compatible constant-time string comparison to prevent timing attacks on operator tokens.
 */
export function timingSafeCompare(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Validates operator secret bearer tokens (e.g., CRON_SECRET, INGEST_SECRET_TOKEN).
 */
export function isOperatorAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const ingestToken = process.env.INGEST_SECRET_TOKEN?.trim();
  const workerKey = process.env.SUPABASE_WORKER_KEY?.trim();
  const validSecrets = [cronSecret, ingestToken, workerKey].filter(Boolean) as string[];

  const authHeader = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  const headerToken = req.headers.get('x-access-token')?.trim() || authHeader;
  if (!headerToken) return false;

  return validSecrets.some((secret) => timingSafeCompare(secret, headerToken));
}

/**
 * Extracts and cryptographically verifies the current authenticated user via Supabase SSR / JWT,
 * and ensures their email belongs to the allow-list.
 * Returns the verified User object, or null if unauthenticated / unauthorized.
 */
export async function requireOwner(req: NextRequest): Promise<User | null> {
  const authHeader = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();

  // 1. Bearer JWT validation via Supabase admin
  if (authHeader && authHeader.startsWith('eyJ')) {
    try {
      const admin = getSupabaseAdmin();
      const { data: { user }, error } = await admin.auth.getUser(authHeader);
      if (!error && user && isAllowed(user.email)) {
        return user;
      }
    } catch {}
  }

  // 2. Cookie-based session validation via official @supabase/ssr
  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
      {
        cookies: {
          getAll() {
            return req.cookies.getAll();
          },
          setAll() {},
        },
      }
    );

    const { data: { user }, error } = await supabase.auth.getUser();
    if (!error && user && isAllowed(user.email)) {
      return user;
    }
  } catch (err) {
    console.warn('[requireOwner] Error verifying session:', err);
  }

  return null;
}

/**
 * Legacy compatibility alias for getAuthenticatedUser.
 */
export async function getAuthenticatedUser(req: NextRequest): Promise<User | null> {
  return requireOwner(req);
}

/**
 * Validates whether the incoming request is authorized either by an allow-listed owner session
 * or by an operator secret token.
 */
export async function isRequestAuthorized(req: NextRequest): Promise<boolean> {
  if (isOperatorAuthorized(req)) return true;
  const user = await requireOwner(req);
  return !!user;
}
