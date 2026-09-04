import { NextRequest, NextResponse, after } from 'next/server';
import { TelegramUpdate, handleTelegramWebhook } from '@/lib/telegram';

export async function POST(req: NextRequest) {
  try {
    const body: TelegramUpdate = await req.json();

    if (!body || !body.update_id) {
      return NextResponse.json({ success: true, handled: false });
    }

    // Process asynchronously after returning 200 OK to Telegram instantly.
    // This prevents Telegram webhook timeouts (5s limit) and eliminates retry loops.
    after(async () => {
      try {
        await handleTelegramWebhook(body);
      } catch (err) {
        console.error(`Background Telegram update processing error (Update ID ${body.update_id}):`, err);
      }
    });

    // Return instant 200 OK to Telegram
    return NextResponse.json({ success: true, handled: true });
  } catch (err: any) {
    console.error('Telegram webhook route error:', err);
    return NextResponse.json({ success: true, error: err?.message });
  }
}

export async function GET() {
  return NextResponse.json({ error: 'Not Found' }, { status: 404 });
}
