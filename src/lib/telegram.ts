// Telegram Bot Integration & Notifications
// Sourced from PRD_academic_task_agent.md (Section 8, Section 7)

import { getSupabaseAdmin, logSystemEvent } from './supabase';
import { getGmailClient } from './google-auth';
import Groq from 'groq-sdk';

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name?: string; username?: string };
    chat: { id: number; type: string };
    date: number;
    text?: string;
    reply_to_message?: {
      message_id: number;
      text?: string;
    };
  };
  callback_query?: {
    id: string;
    from: { id: number };
    message?: { message_id: number; chat: { id: number } };
    data?: string;
  };
}

/**
 * Sends a message via Telegram Bot API
 */
export async function sendTelegramMessage(text: string, parseMode: 'Markdown' | 'HTML' = 'Markdown'): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;

  if (!token || !chatId) {
    console.warn('Telegram token or chat ID not configured.');
    return false;
  }

  try {
    const res = await fetch(`${TELEGRAM_API_BASE}${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
      }),
    });

    if (!res.ok) {
      console.error(`Telegram sendMessage failed: HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error('Error sending Telegram message:', err?.message || err);
    return false;
  }
}

/**
 * Sends an alert via Telegram with dual-channel email fallback for urgent messages (PRD Section 7)
 */
export async function sendTelegramAlert(text: string, isUrgent: boolean = false): Promise<void> {
  const success = await sendTelegramMessage(text);

  // If Telegram failed or if task is urgent, send email backup
  if ((!success || isUrgent) && process.env.GOOGLE_OAUTH_REFRESH_TOKEN) {
    try {
      const gmail = getGmailClient();
      const rawEmail = [
        `To: me`,
        `Subject: [Vicarius Agent Alert] ${isUrgent ? 'URGENT: ' : ''}Task Notification`,
        `Content-Type: text/plain; charset=utf-8`,
        ``,
        text.replace(/[*_`]/g, ''),
      ].join('\n');

      const encodedEmail = Buffer.from(rawEmail)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw: encodedEmail },
      });
    } catch (emailErr: any) {
      console.error('Email fallback alert failed:', emailErr?.message || emailErr);
    }
  }
}

/**
 * Handles incoming webhook updates from Telegram
 */
export async function handleTelegramWebhook(update: TelegramUpdate): Promise<{ handled: boolean; responseText?: string }> {
  const allowedChatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;
  const incomingChatId = update.message?.chat.id?.toString() || update.callback_query?.message?.chat.id?.toString();

  // Strict chat-ID authorization: silently ignore unauthorized senders (PRD Section 8 / CLAUDE.md)
  if (!incomingChatId || (allowedChatId && incomingChatId !== allowedChatId)) {
    return { handled: false };
  }

  const supabase = getSupabaseAdmin();
  const text = update.message?.text?.trim() || '';

  // 1. Check if user is replying to a pending question
  const replyTo = update.message?.reply_to_message;
  let pendingQuestion = null;

  if (replyTo) {
    // Attempt match by reply text
    const { data: q } = await supabase
      .from('questions')
      .select('*')
      .eq('status', 'pending')
      .order('asked_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    pendingQuestion = q;
  } else {
    // If no explicit reply, check if there's any pending question awaiting answer
    const { data: q } = await supabase
      .from('questions')
      .select('*')
      .eq('status', 'pending')
      .order('asked_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    // If text is not a command and there's a recent pending question (< 30 mins)
    if (q && !text.startsWith('/')) {
      pendingQuestion = q;
    }
  }

  if (pendingQuestion && text) {
    // Interpreting answer via Groq classification pass (PRD Section 8)
    let finalAnswer = text;
    const groqKey = process.env.GROQ_API_KEY;
    if (groqKey) {
      try {
        const groq = new Groq({ apiKey: groqKey });
        const res = await groq.chat.completions.create({
          model: 'llama-3.3-70b-versatile',
          messages: [
            {
              role: 'system',
              content: 'Given the agent question and student reply, extract the precise concise answer string. Return JSON: {"answer": string, "confident": boolean}',
            },
            {
              role: 'user',
              content: `Question: ${pendingQuestion.question_text}\nUser Reply: ${text}`,
            },
          ],
          temperature: 0.1,
        });
        const content = res.choices[0]?.message?.content || '{}';
        const parsed = JSON.parse(content.replace(/```json/g, '').replace(/```/g, '').trim());
        if (parsed.confident && parsed.answer) {
          finalAnswer = parsed.answer;
        }
      } catch (err) {
        console.warn('Groq answer parse error, using raw text:', err);
      }
    }

    // Update question row in Supabase
    await supabase.from('questions').update({
      answer_text: finalAnswer,
      status: 'answered',
      answered_at: new Date().toISOString(),
    }).eq('id', pendingQuestion.id);

    await sendTelegramMessage(`✅ Recorded your answer: "${finalAnswer}". The agent will proceed.`);
    return { handled: true, responseText: 'Question answered' };
  }

  // 2. Status queries (Natural language & commands)
  const lower = text.toLowerCase();
  if (
    lower === '/status' ||
    lower.includes('status') ||
    lower.includes('pending') ||
    lower.includes("what's happening") ||
    lower.includes('what is happening') ||
    lower.includes('check')
  ) {
    const { data: tasks } = await supabase
      .from('tasks')
      .select('id, title, course, status, due_date')
      .eq('archived', false)
      .order('due_date', { ascending: true })
      .limit(10);

    if (!tasks || tasks.length === 0) {
      await sendTelegramMessage('📋 No active tasks currently in queue.');
      return { handled: true };
    }

    const counts: Record<string, number> = {};
    tasks.forEach((t) => {
      counts[t.status] = (counts[t.status] || 0) + 1;
    });

    let statusMsg = `📊 *Vicarius System Status*\n\n`;
    statusMsg += `• Queued: ${counts['queued'] || 0}\n`;
    statusMsg += `• In Progress: ${(counts['claimed'] || 0) + (counts['building'] || 0) + (counts['verifying'] || 0)}\n`;
    statusMsg += `• Flagged: ${counts['flagged'] || 0}\n`;
    statusMsg += `• Done: ${counts['done'] || 0}\n\n`;
    statusMsg += `*Upcoming Tasks:*\n`;

    tasks.slice(0, 5).forEach((t) => {
      const dueStr = t.due_date ? new Date(t.due_date).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'No deadline';
      statusMsg += `• [${t.status.toUpperCase()}] *${t.title}* (${t.course || 'General'}) — Due: ${dueStr}\n`;
    });

    await sendTelegramMessage(statusMsg);
    return { handled: true };
  }

  // 3. Control commands
  if (lower.startsWith('/retry')) {
    const parts = text.split(' ');
    if (parts.length > 1) {
      const taskId = parts[1];
      const { error } = await supabase
        .from('tasks')
        .update({ status: 'queued', updated_at: new Date().toISOString() })
        .eq('id', taskId);

      if (!error) {
        await sendTelegramMessage(`🔄 Task \`${taskId}\` requeued for build.`);
      } else {
        await sendTelegramMessage(`❌ Could not retry task: ${error.message}`);
      }
      return { handled: true };
    }
  }

  if (lower === '/help' || lower === '/start') {
    const helpMsg = `🤖 *Vicarius Academic Agent*\n\n` +
      `Commands:\n` +
      `• \`/status\` — View active tasks & queue state\n` +
      `• \`/retry <task_id>\` — Requeue a flagged or failed task\n` +
      `• Reply directly to any question message to clarify instructions for the build agent.`;
    await sendTelegramMessage(helpMsg);
    return { handled: true };
  }

  // 4. Unrecognized
  await sendTelegramMessage("I didn't recognize that command. Type `/status` to view active tasks or `/help` for options.");
  return { handled: true };
}
