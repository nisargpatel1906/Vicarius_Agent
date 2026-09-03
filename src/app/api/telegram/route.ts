import { NextRequest, NextResponse } from 'next/server';
import { TelegramUpdate } from '@/lib/telegram';

export async function POST(req: NextRequest) {
  try {
    const body: TelegramUpdate = await req.json();
    
    // TEMPORARILY DISABLED TO STOP INFINITE LOOP
    console.log("Webhook received but disabled:", body?.update_id);
    
    return NextResponse.json({ success: true, handled: true });
  } catch (err: any) {
    console.error('Telegram webhook error:', err);
    return NextResponse.json({ success: false, error: err?.message || 'Error processing update' });
  }
}

export async function GET() {
  return NextResponse.json({ success: true, message: 'Vicarius Telegram Webhook endpoint active' });
}
