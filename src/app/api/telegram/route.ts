// POST /api/telegram
// Telegram Webhook Handler Endpoint
// Sourced from PRD_academic_task_agent.md (Section 8, Section 11)

import { NextRequest, NextResponse } from 'next/server';
import { handleTelegramWebhook, TelegramUpdate } from '@/lib/telegram';

export async function POST(req: NextRequest) {
  try {
    const body: TelegramUpdate = await req.json();
    const result = await handleTelegramWebhook(body);
    return NextResponse.json({ success: true, handled: result.handled });
  } catch (err: any) {
    console.error('Telegram webhook error:', err);
    // Always return 200 to Telegram so it doesn't repeatedly retry malformed payloads
    return NextResponse.json({ success: false, error: err?.message || 'Error processing update' });
  }
}

export async function GET() {
  return NextResponse.json({ success: true, message: 'Vicarius Telegram Webhook endpoint active' });
}
