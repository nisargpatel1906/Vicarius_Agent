import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await requireOwner(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();

  // 1. Check profile in database
  const { data: profile } = await supabase
    .from('profile')
    .select('full_name, preferred_name, university, program, current_semester, enrollment_no, default_citation_style, telegram_id, setup_completed')
    .eq('user_id', user.id)
    .maybeSingle();

  // 2. Check google_credentials
  const { data: googleCreds } = await supabase
    .from('google_credentials')
    .select('user_id, updated_at')
    .eq('user_id', user.id)
    .maybeSingle();

  const googleConnected = Boolean(googleCreds?.user_id || process.env.GOOGLE_OAUTH_REFRESH_TOKEN);

  // 3. LLM providers configured (booleans only, never secrets)
  const groqConfigured = Boolean(process.env.GROQ_API_KEY?.trim());
  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY?.trim());
  const openrouterConfigured = Boolean(process.env.OPENROUTER_API_KEY?.trim());
  const llmConfigured = groqConfigured || geminiConfigured || openrouterConfigured;

  // 4. Telegram bot & chat status
  const telegramBotConfigured = Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim());
  const telegramChatLinked = Boolean(profile?.telegram_id || process.env.TELEGRAM_ALLOWED_CHAT_ID?.trim());

  // 5. Short link code for Telegram /start link_<code>
  const telegramLinkCode = user.id.slice(0, 8);

  return NextResponse.json({
    success: true,
    data: {
      user: {
        id: user.id,
        email: user.email,
        name: user.user_metadata?.full_name || user.user_metadata?.name || '',
      },
      profile: profile || null,
      connections: {
        database: true,
        google: googleConnected,
        llm: llmConfigured,
        groq: groqConfigured,
        gemini: geminiConfigured,
        openrouter: openrouterConfigured,
        telegramBot: telegramBotConfigured,
        telegramLinked: telegramChatLinked,
      },
      telegramLinkCode,
      setupCompleted: Boolean(profile?.setup_completed),
    },
  });
}
