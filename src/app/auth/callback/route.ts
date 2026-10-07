import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseAdmin } from '@/lib/supabase';
import { isAllowed } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const code = searchParams.get('code');
  const next = searchParams.get('next') || searchParams.get('redirect') || '/';

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const cookiesToSet: { name: string; value: string; options: any }[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(toSet) {
          toSet.forEach((item) => cookiesToSet.push(item));
        },
      },
    }
  );

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    console.error('[Auth Callback] Code exchange error:', error);
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const user = data.user;
  const session = data.session;

  // 1. Verify user email against allow-list
  if (!isAllowed(user.email)) {
    console.warn(`[Auth Callback] Unauthorized sign-in attempt from: ${user.email}`);
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=not_allowed`);
  }

  const admin = getSupabaseAdmin();

  // 2. Persist Google OAuth offline refresh token if granted by consent
  if (session?.provider_refresh_token) {
    try {
      await admin.from('google_credentials').upsert(
        {
          user_id: user.id,
          refresh_token: session.provider_refresh_token,
          scopes: [
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/gmail.send',
            'https://www.googleapis.com/auth/classroom.courses.readonly',
            'https://www.googleapis.com/auth/classroom.coursework.me',
            'https://www.googleapis.com/auth/classroom.announcements.readonly',
            'https://www.googleapis.com/auth/drive.file',
            'https://www.googleapis.com/auth/drive.readonly',
            'https://www.googleapis.com/auth/tasks',
            'https://www.googleapis.com/auth/calendar.events',
          ],
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );
    } catch (tokenErr) {
      console.error('[Auth Callback] Failed to persist google refresh token:', tokenErr);
    }
  }

  // 3. Claim unowned rows for this owner in database
  try {
    await admin.rpc('claim_unowned_rows', { owner: user.id });
  } catch (rpcErr) {
    console.warn('[Auth Callback] claim_unowned_rows notice:', rpcErr);
  }

  // 4. Check if profile setup wizard has been completed
  let redirectTarget = next;
  try {
    const { data: profile } = await admin
      .from('profile')
      .select('setup_completed')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!profile || !profile.setup_completed) {
      redirectTarget = '/setup';
    }
  } catch (profileErr) {
    console.warn('[Auth Callback] Profile check:', profileErr);
  }

  const response = NextResponse.redirect(`${origin}${redirectTarget}`);
  cookiesToSet.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options);
  });

  return response;
}
