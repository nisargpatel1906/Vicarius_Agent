// Telegram Bot Integration & Notifications
// Sourced from PRD_academic_task_agent.md (Section 8, Section 7)

import { getSupabaseAdmin, logSystemEvent } from './supabase';
import { getGmailClient, getClassroomClient } from './google-auth';
import { TaskType } from './types';
import { rememberCourseCorrection } from './aethos';

const TELEGRAM_API_BASE = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org/bot';

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name?: string; username?: string };
    chat: { id: number; type: string };
    date: number;
    text?: string;
    caption?: string;
    // Document (PDF, DOCX, etc.)
    document?: {
      file_id: string;
      file_name?: string;
      mime_type?: string;
      file_size?: number;
    };
    // Photo messages (array of resolutions, use last = highest res)
    photo?: Array<{
      file_id: string;
      width: number;
      height: number;
      file_size?: number;
    }>;
    // Voice messages (Telegram voice note .ogg)
    voice?: {
      file_id: string;
      duration: number;
      mime_type?: string;
      file_size?: number;
    };
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

function escapeHtml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Sends a message via Telegram Bot API with automatic plain text fallback
 */
export async function sendTelegramMessage(
  text: string,
  parseMode: 'Markdown' | 'HTML' = 'HTML',
  targetChatId?: string | number
): Promise<boolean> {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const rawChatId = targetChatId || process.env.TELEGRAM_ALLOWED_CHAT_ID;
  const chatId = rawChatId ? String(rawChatId).replace(/['"\r\n\s]/g, '') : '';

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
        disable_web_page_preview: true,
      }),
    });

    if (res.ok) {
      return true;
    }

    const errBody = await res.text().catch(() => '');
    console.warn(`Telegram sendMessage parse_mode=${parseMode} failed: HTTP ${res.status} (${errBody}). Retrying with plain text...`);
    const cleanText = text.replace(/<[^>]+>/g, '').replace(/[*_`]/g, '');
    const fallbackRes = await fetch(`${TELEGRAM_API_BASE}${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: cleanText,
        disable_web_page_preview: true,
      }),
    });

    return fallbackRes.ok;
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
 * Creates and queues a new academic task directly from a Telegram prompt
 */
export async function createTaskFromTelegram(promptText: string): Promise<string> {
  const supabase = getSupabaseAdmin();
  const rawBody = promptText.trim();

  let parsed: any = {};
  const groqKey = process.env.GROQ_API_KEY;
  const systemPrompt = `You are the Vicarius Academic Task Parser for a Computer Engineering / AI-ML student.
Extract the structured task details into strict JSON:
{
  "title": string (concise, descriptive academic title),
  "course": string (e.g. "CE-401 Machine Learning", "CE-502 Cloud Computing", "CE-403 Web Technologies", "CE-505 Information Security", or "General"),
  "task_type": "document" | "presentation" | "code_project" | "ml_training" | "research" | "handwritten",
  "due_date": string in ISO 8601 with Asia/Kolkata timezone offset (+05:30) (e.g. "2026-09-10T18:00:00+05:30". If not specified, default to 3 days from now at 18:00:00+05:30),
  "requirements": string[] (list of key instructions),
  "success_criteria": string (verification criteria),
  "build_spec": string (detailed prompt instructions for the build agent. If the task involves UI, web app, frontend, or presentation, MUST mandate using docx/DESIGN.md Cognitive Heritage design tokens: surface #fff8f4, primary #705728, on-surface #231a0f, typography Noto Serif + Manrope)
}`;

  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (openRouterKey) {
    try {
      const res = await fetch(process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openRouterKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'minimax/minimax-m3:free',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: rawBody },
          ],
          temperature: 0.1,
        })
      });
      
      if (!res.ok) {
        throw new Error(`OpenRouter API error: ${res.statusText}`);
      }
      
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || '{}';
      parsed = JSON.parse(content.replace(/```json/g, '').replace(/```/g, '').trim());
    } catch (err) {
      console.warn('OpenRouter parsing error:', err);
    }
  }

  const title = parsed.title || rawBody.slice(0, 50) || 'Academic Assignment';
  const course = parsed.course || 'General';
  
  let taskType: TaskType = parsed.task_type || 'document';
  const lower = rawBody.toLowerCase();
  if (lower.includes('presentation') || lower.includes('slide') || lower.includes('deck') || lower.includes('.pptx')) {
    taskType = 'presentation';
  } else if (lower.includes('code') || lower.includes('react') || lower.includes('next.js') || lower.includes('python script') || lower.includes('web app') || lower.includes('gui')) {
    taskType = 'code_project';
  } else if (lower.includes('train') || lower.includes('cifar') || lower.includes('epoch') || lower.includes('accuracy target') || lower.includes('val_acc')) {
    taskType = 'ml_training';
  } else if (lower.includes('research') || lower.includes('citation') || lower.includes('literature review') || lower.includes('ieee') || lower.includes('survey')) {
    taskType = 'research';
  } else if (lower.includes('handwritten') || lower.includes('by hand') || lower.includes('copy-ready')) {
    taskType = 'handwritten';
  }

  let slideCount: number | null = null;
  const sm = rawBody.match(/(\d+)[\s-]*(?:slide|slides)/i);
  if (sm) {
    slideCount = parseInt(sm[1], 10);
  }
  
  // Default due date: 3 days ahead at 18:00 IST
  const defaultDue = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const dueDate = parsed.due_date || defaultDue.toISOString();

  const taskId = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  const { error } = await supabase.from('tasks').insert({
    id: taskId,
    source: 'classroom',
    external_id: `tg-${Date.now()}`,
    course: course,
    title: title,
    task_type: taskType,
    extracted_requirements: {
      summary: title,
      items: parsed.requirements || [rawBody],
      raw_text: rawBody,
      slide_count: slideCount,
    },
    success_criteria: parsed.success_criteria || (slideCount ? `Produce a verified ${slideCount}-slide presentation deck (.pptx).` : 'Produce complete academic deliverables matching requirements.'),
    build_spec: parsed.build_spec || rawBody,
    due_date: dueDate,
    status: 'queued',
    archived: false,
    created_at: nowIso,
    updated_at: nowIso,
  });

  if (error) {
    throw new Error(`Database error: ${error.message}`);
  }

  await logSystemEvent('info', 'telegram', `New task created from Telegram: '${title}' (ID: ${taskId})`);

  const displayDue = new Date(dueDate).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    `✅ <b>Task Created & Queued!</b>\n\n` +
    `📌 <b>Title:</b> ${escapeHtml(title)}\n` +
    `📚 <b>Course:</b> ${escapeHtml(course)}\n` +
    `🏷️ <b>Type:</b> <code>${taskType}</code>\n` +
    `⏰ <b>Due:</b> ${displayDue}\n\n` +
    `<i>The background daemon worker will pick this up automatically.</i>`
  );
}

/**
 * Reply-to-fix loop: takes a flagged/failed task plus the user's plain-language fix instruction,
 * uses the LLM to patch the build spec / success criteria / requirements, then re-queues the task
 * so the worker rebuilds automatically. This is the human-in-the-loop remediation path — the user
 * simply replies to a flag on Telegram and the agent applies the change and rebuilds.
 * (PRD Section 6.3 / 8; CLAUDE.md: one retry, then flag — this is a *user-initiated* re-queue,
 * not an extra automatic retry.)
 */
export async function applyFixAndRequeue(taskId: string, instruction: string): Promise<string> {
  const supabase = getSupabaseAdmin();

  const { data: task } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .maybeSingle();

  if (!task) {
    return `❌ I couldn't find that task (<code>${escapeHtml(taskId)}</code>) to fix.`;
  }

  const currentReqs = task.extracted_requirements || {};
  const currentItems: string[] = Array.isArray(currentReqs.items) ? currentReqs.items : [];

  let patch: any = null;
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (openRouterKey) {
    const systemPrompt = `You are the remediation module of an autonomous academic-task agent. A build task FAILED and the student has told you, in plain language, how to fix it. Apply ONLY the student's requested change (plus anything the failure summary clearly requires) to the task definition. Preserve everything that was already correct — do not drop existing requirements.

Return STRICT JSON only, no prose:
{
  "build_spec": string (the FULL updated build instructions, not a diff),
  "success_criteria": string (updated verification criteria),
  "requirements": string[] (updated list of key requirements),
  "change_summary": string (one short sentence describing what you changed, for the student)
}`;
    const userPrompt = `TASK TITLE: ${task.title}
COURSE: ${task.course || 'General'}
TYPE: ${task.task_type}
WHY IT FAILED: ${task.result_summary || 'unknown'}

CURRENT BUILD SPEC:
${task.build_spec || '(none)'}

CURRENT SUCCESS CRITERIA:
${task.success_criteria || '(none)'}

CURRENT REQUIREMENTS:
${currentItems.map((r) => `- ${r}`).join('\n') || '(none)'}

STUDENT'S FIX INSTRUCTION:
${instruction}`;

    try {
      const res = await fetch(process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${openRouterKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'minimax/minimax-m3:free',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.1,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content || '{}';
        patch = JSON.parse(content.replace(/```json/g, '').replace(/```/g, '').trim());
      }
    } catch (err) {
      console.warn('applyFixAndRequeue LLM patch error:', err);
    }
  }

  // If the LLM patch failed, still honor the fix by appending the raw instruction to the build spec
  // and requirements — never silently drop the user's instruction.
  const nowIso = new Date().toISOString();
  const changeSummary: string = patch?.change_summary || `Applied your instruction: "${instruction}"`;
  const newBuildSpec: string = (patch?.build_spec && String(patch.build_spec).trim())
    ? String(patch.build_spec)
    : `${task.build_spec || ''}\n\n[USER FIX]: ${instruction}`;
  const newSuccess: string = (patch?.success_criteria && String(patch.success_criteria).trim())
    ? String(patch.success_criteria)
    : task.success_criteria;
  const newItems: string[] = Array.isArray(patch?.requirements) && patch.requirements.length > 0
    ? patch.requirements
    : [...currentItems, instruction];

  const { error } = await supabase.from('tasks').update({
    status: 'queued',
    build_spec: newBuildSpec,
    success_criteria: newSuccess,
    extracted_requirements: { ...currentReqs, items: newItems },
    result_summary: `Re-queued after your fix: ${changeSummary}`.slice(0, 1000),
    updated_at: nowIso,
  }).eq('id', taskId);

  if (error) {
    return `❌ I understood the fix but couldn't save it: ${escapeHtml(error.message)}`;
  }

  await logSystemEvent('info', 'telegram', `User fix applied to task ${taskId} and re-queued: ${changeSummary}`);

  return (
    `✅ <b>Got it — I've updated the task and I'm rebuilding it now.</b>\n\n` +
    `📌 <b>Task:</b> ${escapeHtml(task.title)}\n` +
    `🔧 <b>What I changed:</b> ${escapeHtml(changeSummary)}\n\n` +
    `<i>The worker will pick it up on its next cycle. I'll message you when it's done.</i>`
  );
}

/**
 * Fetches latest announcements, notices, and coursework posts directly from Google Classroom
 */
export async function getLatestClassroomMessages(limit: number = 5): Promise<string> {
  try {
    const classroom = getClassroomClient();
    const coursesRes = await classroom.courses.list({ courseStates: ['ACTIVE'], pageSize: 10 });
    const courses = coursesRes.data.courses || [];

    if (courses.length === 0) {
      return '📚 <b>Google Classroom:</b> No active courses found in your account.';
    }

    const messages: Array<{
      course: string;
      type: string;
      time: string;
      title?: string;
      text: string;
    }> = [];

    for (const course of courses) {
      const courseName = course.name || 'Unnamed Course';
      const courseId = course.id;
      if (!courseId) continue;

      // 1. Announcements
      try {
        const annRes = await classroom.courses.announcements.list({
          courseId,
          announcementStates: ['PUBLISHED'],
          pageSize: 5,
        });
        for (const ann of annRes.data.announcements || []) {
          messages.push({
            course: courseName,
            type: 'Announcement',
            time: ann.creationTime || '',
            text: ann.text || '(No text)',
          });
        }
      } catch (e) {
        // ignore per-course errors
      }

      // 2. CourseWork
      try {
        const cwRes = await classroom.courses.courseWork.list({
          courseId,
          courseWorkStates: ['PUBLISHED'],
          pageSize: 5,
        });
        for (const cw of cwRes.data.courseWork || []) {
          messages.push({
            course: courseName,
            type: 'Assignment',
            time: cw.creationTime || '',
            title: cw.title || 'Untitled',
            text: cw.description || '',
          });
        }
      } catch (e) {
        // ignore per-course errors
      }
    }

    // Sort by creationTime desc
    messages.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

    if (messages.length === 0) {
      return '📚 <b>Google Classroom:</b> No recent announcements or assignments found across your active courses.';
    }

    const top = messages.slice(0, limit);
    let output = `📢 <b>Latest Google Classroom Posts (${top.length}):</b>\n\n`;

    top.forEach((m, idx) => {
      const dateStr = m.time
        ? new Date(m.time).toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : 'Recent';

      output += `${idx + 1}. [${m.type.toUpperCase()}] <b>${escapeHtml(m.course)}</b>\n`;
      if (m.title) {
        output += `   📌 <b>${escapeHtml(m.title)}</b>\n`;
      }
      const preview = m.text.length > 280 ? m.text.slice(0, 280) + '...' : m.text;
      output += `   💬 ${escapeHtml(preview)}\n`;
      output += `   🕒 <i>${dateStr} IST</i>\n\n`;
    });

    return output;
  } catch (err: any) {
    console.error('Error fetching Classroom messages:', err);
    return `❌ Could not fetch Google Classroom messages: ${escapeHtml(err.message)}`;
  }
}

/**
 * Fetches recent academic emails from Gmail
 */
export async function getRecentGmailEmails(limit: number = 5): Promise<string> {
  try {
    const gmail = getGmailClient();
    const res = await gmail.users.messages.list({
      userId: 'me',
      maxResults: limit,
      q: 'newer_than:7d',
    });
    const messages = res.data.messages || [];
    if (messages.length === 0) {
      return '✉️ <b>Gmail:</b> No recent emails found in the last 7 days.';
    }

    let output = `📬 <b>Recent Emails (${messages.length}):</b>\n\n`;
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg.id) continue;
      const detail = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From', 'Date'],
      });
      const headers = detail.data.payload?.headers || [];
      const subject = headers.find((h) => h.name?.toLowerCase() === 'subject')?.value || 'No Subject';
      const from = headers.find((h) => h.name?.toLowerCase() === 'from')?.value || 'Unknown Sender';
      const date = headers.find((h) => h.name?.toLowerCase() === 'date')?.value || '';
      const snippet = detail.data.snippet || '';

      output += `${i + 1}. <b>${escapeHtml(subject)}</b>\n`;
      output += `   👤 From: <code>${escapeHtml(from)}</code>\n`;
      if (snippet) output += `   💬 ${escapeHtml(snippet.slice(0, 150))}...\n`;
      output += `   🕒 <i>${escapeHtml(date)}</i>\n\n`;
    }
    return output;
  } catch (err: any) {
    console.error('Error fetching Gmail messages:', err);
    return `❌ Could not fetch Gmail messages: ${escapeHtml(err.message)}`;
  }
}

/**
 * Triggers on-demand synchronization of Google Classroom and Gmail
 */
export async function syncClassroomAndGmail(): Promise<string> {
  try {
    const { runIngestion } = await import('./ingest');
    const res = await runIngestion();
    return (
      `🔄 <b>Synchronization Complete!</b>\n\n` +
      `• 📚 Google Classroom items scanned: <b>${res.classroomCount}</b>\n` +
      `• ✉️ Gmail items scanned: <b>${res.gmailCount}</b>\n` +
      `• 🆕 New tasks queued: <b>${res.upsertedCount}</b>\n` +
      (res.errors.length > 0 ? `\n⚠️ Warnings: ${escapeHtml(res.errors.join(', '))}` : '')
    );
  } catch (err: any) {
    return `❌ Sync failed: ${escapeHtml(err.message)}`;
  }
}

/**
 * Intelligent Academic AI Assistant Chat on Telegram
 */
export async function askAiAssistant(userPrompt: string, chatId: string): Promise<string> {
  const supabase = getSupabaseAdmin();
  
  // Save user's incoming message to history
  await supabase.from('chat_messages').insert({
    chat_id: chatId,
    role: 'user',
    content: userPrompt
  });

  // Fetch active tasks and deliverables for real-time context
  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, title, course, task_type, status, due_date, result_summary')
    .eq('archived', false)
    .order('due_date', { ascending: true })
    .limit(8);

  const taskContext = (tasks || []).map(t => 
    `- [${t.status.toUpperCase()}] ${t.title} (${t.course || 'General'}, Due: ${t.due_date || 'N/A'}, ID: ${t.id})`
  ).join('\n');

  // Fetch recent conversation history
  const { data: history } = await supabase
    .from('chat_messages')
    .select('role, content')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false })
    .limit(10);
    
  const historyMessages = (history || []).reverse().map(msg => ({
    role: msg.role === 'system' ? 'system' : (msg.role === 'assistant' ? 'assistant' : 'user'),
    content: msg.content
  }));

  const systemPrompt = `You are Vicarius, an autonomous AI academic assistant and agent for Nisarg Patel (Computer Engineering / AI-ML student at Academic Institution).
You HAVE LIVE CONNECTIVITY to Nisarg's academic tools via Google OAuth 2.0:
1. Google Classroom: You CAN and MUST read live announcements, notices, assignments, and posts from all active courses using 'get_classroom_latest_messages'.
2. Gmail: You CAN read recent academic emails using 'get_recent_emails'.
3. Sync: You CAN trigger live synchronization of Classroom and Gmail using 'sync_classroom_and_gmail'.
4. Task Management: You CAN create and queue tasks with 'create_academic_task', check telemetry with 'get_system_status', and list tasks with 'list_active_tasks'.

Current Active Tasks in System:
${taskContext || 'No active tasks.'}

CRITICAL RULES:
1. NEVER EVER say you don't have access to Google Classroom, Gmail, or coursework! You DO have live access via authorized Google API tools.
2. If the student asks about messages, announcements, or posts from Classroom (e.g. "Tell me last message of my classroom", "What did the teacher post?", "Check classroom notices"), YOU MUST CALL 'get_classroom_latest_messages'!
3. If the student asks about emails, call 'get_recent_emails'!
4. When the student asks you to do, create, build, generate, write, or train an assignment/project, or says "use this and make a ppt" / "make slides", you MUST IMMEDIATELY call the 'create_academic_task' tool! Do NOT just print the text outline or ask them to type /task.
5. If the student asks for status or lists of tasks, call 'get_system_status' or 'list_active_tasks'.
6. If the student asks conceptual questions or converses, respond directly with rich technical depth and clarity.
7. Format all text replies in clean, valid HTML (<b>bold</b>, <i>italic</i>, <code>code</code>, bullet points •). Do NOT use markdown asterisks.
8. If the student gives a correction, feedback, rule, or grade for a specific course (e.g. "for CE-401 always use IEEE format", or "my teacher said to include loss curves"), YOU MUST CALL 'save_course_feedback' to remember it!`;

  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (openRouterKey) {
    try {
      const res = await fetch(process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openRouterKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'minimax/minimax-m3:free',
          messages: [
            { role: 'system', content: systemPrompt },
            ...historyMessages,
          ],
          tools: [
            {
              type: 'function',
              function: {
                name: 'get_classroom_latest_messages',
                description: 'Fetches the latest announcements, notices, messages, and coursework posts from the student\'s active Google Classroom courses.',
                parameters: {
                  type: 'object',
                  properties: {
                    limit: { type: 'number', description: 'Number of recent posts to fetch (default: 5)' }
                  }
                }
              }
            },
            {
              type: 'function',
              function: {
                name: 'get_recent_emails',
                description: 'Fetches recent academic emails and university notices from the student\'s Gmail inbox.',
                parameters: {
                  type: 'object',
                  properties: {
                    limit: { type: 'number', description: 'Number of recent emails to fetch (default: 5)' }
                  }
                }
              }
            },
            {
              type: 'function',
              function: {
                name: 'sync_classroom_and_gmail',
                description: 'Polls and synchronizes all new coursework, announcements, and emails from Google Classroom and Gmail into the database.',
                parameters: { type: 'object', properties: {} }
              }
            },
            {
              type: 'function',
              function: {
                name: 'create_academic_task',
                description: 'Creates and queues a new academic task/assignment for the student in Supabase database.',
                parameters: {
                  type: 'object',
                  properties: {
                    title: { type: 'string', description: 'Academic title of the task' },
                    course: { type: 'string', description: 'Course name e.g. CE-502 Cloud Computing, CE-401 Machine Learning, CE-403 Web Technologies, CE-505 Information Security, CE-402 Database Systems' },
                    task_type: { 
                      type: 'string', 
                      enum: ['presentation', 'code_project', 'ml_training', 'research', 'document', 'handwritten'],
                      description: 'Task deliverable category'
                    },
                    requirements: { type: 'array', items: { type: 'string' }, description: 'List of specific requirements' },
                    slide_count: { type: 'number', description: 'Exact slide count if presentation' },
                    success_criteria: { type: 'string', description: 'Verification criteria' }
                  },
                  required: ['title', 'course', 'task_type', 'requirements']
                }
              }
            },
            {
              type: 'function',
              function: {
                name: 'get_system_status',
                description: 'Returns the current telemetry, queue counts, and upcoming deadlines.',
                parameters: { type: 'object', properties: {} }
              }
            },
            {
              type: 'function',
              function: {
                name: 'list_active_tasks',
                description: 'Lists active pending or completed tasks for the student.',
                parameters: {
                  type: 'object',
                  properties: {
                    course: { type: 'string', description: 'Optional course filter' }
                  }
                }
              }
            },
            {
              type: 'function',
              function: {
                name: 'save_course_feedback',
                description: 'Saves feedback, corrections, or grades for a specific course to Aethos Memory so the AI remembers it for future tasks in that course.',
                parameters: {
                  type: 'object',
                  properties: {
                    course: { type: 'string', description: 'Course name to tag this feedback with.' },
                    feedback: { type: 'string', description: 'The exact feedback, correction, or rule to remember.' }
                  },
                  required: ['course', 'feedback']
                }
              }
            }
          ],
          temperature: 0.2,
        })
      });
      
      if (!res.ok) {
        throw new Error(`OpenRouter API error: ${res.statusText}`);
      }
      
      const data = await res.json();
      const choice = data.choices?.[0];
      const message = choice?.message;

      // Handle Function / Tool Calls directly
      if (message?.tool_calls && message.tool_calls.length > 0) {
        const toolCall = message.tool_calls[0];
        const funcName = toolCall.function?.name;
        let args: any = {};
        try {
          args = JSON.parse(toolCall.function?.arguments || '{}');
        } catch (e) {
          args = {};
        }

        if (funcName === 'get_classroom_latest_messages') {
          const classroomMsg = await getLatestClassroomMessages(args.limit || 5);
          await supabase.from('chat_messages').insert({
            chat_id: chatId,
            role: 'assistant',
            content: classroomMsg,
          });
          return classroomMsg;
        }

        if (funcName === 'get_recent_emails') {
          const emailMsg = await getRecentGmailEmails(args.limit || 5);
          await supabase.from('chat_messages').insert({
            chat_id: chatId,
            role: 'assistant',
            content: emailMsg,
          });
          return emailMsg;
        }

        if (funcName === 'sync_classroom_and_gmail') {
          const syncMsg = await syncClassroomAndGmail();
          await supabase.from('chat_messages').insert({
            chat_id: chatId,
            role: 'assistant',
            content: syncMsg,
          });
          return syncMsg;
        }

        if (funcName === 'create_academic_task') {
          const taskId = crypto.randomUUID();
          const nowIso = new Date().toISOString();
          const defaultDue = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
          const isUiTask = args.task_type === 'code_project' || args.task_type === 'presentation' || /web|ui|dashboard|frontend|app|react|slides/i.test(args.title);
          
          const designDirective = isUiTask ? `\n\nUI & Visual Design System (MANDATORY — from docx/DESIGN.md):
- Follow the Cognitive Heritage design system:
  • Colors: Surface (#fff8f4), Surface-Container (#fdebd9), On-Surface (#231a0f), Primary (#705728), Primary-Container (#8b6f3e), Secondary (#645e4e), Outline (#7f7669).
  • Typography: Headings ('Noto Serif' 600/700), Body & Controls ('Manrope' 400/600).
  • Visual Standards: Modern card structure, 0.2s cubic-bezier transitions, modern radii (8px buttons, 12px cards, 9999px badges).` : '';

          const reqsList = Array.isArray(args.requirements) ? args.requirements : [args.title];
          const reqsFormatted = reqsList.map((r: string) => `- ${r}`).join('\n');

          const buildSpec = `Task: ${args.title}
Source: ${args.course || 'Academic Course'} — ${args.task_type}
Requirements:
${reqsFormatted}
Success criteria: ${args.success_criteria || (args.slide_count ? `Produce a verified ${args.slide_count}-slide presentation deck (.pptx).` : 'Produce complete academic deliverables matching requirements.')}
Output format: ${args.task_type === 'presentation' ? `presentation.pptx (${args.slide_count || 10} slides)` : (args.task_type === 'code_project' ? 'zipped project + README.md + screenshot.png' : 'document.docx')}
${designDirective}

Instructions:
- Work to completion without stopping for approval.
- Report: files produced and any assumptions made.`;

          const { error } = await supabase.from('tasks').insert({
            id: taskId,
            source: 'classroom',
            external_id: `tg-ai-${Date.now()}`,
            course: args.course || 'General',
            title: args.title,
            task_type: args.task_type || 'document',
            extracted_requirements: {
              summary: args.title,
              items: reqsList,
              slide_count: args.slide_count || null,
            },
            success_criteria: args.success_criteria || (args.slide_count ? `Produce a verified ${args.slide_count}-slide presentation deck (.pptx).` : 'Produce complete academic deliverables matching requirements.'),
            build_spec: buildSpec,
            due_date: defaultDue,
            status: 'queued',
            archived: false,
            created_at: nowIso,
            updated_at: nowIso,
          });

          if (error) {
            throw new Error(`Database insert error: ${error.message}`);
          }

          await logSystemEvent('info', 'telegram', `AI Agent created task from Telegram: '${args.title}' (ID: ${taskId})`);

          const confirmation = 
            `✨ <b>AI Agent Created & Queued Task!</b>\n\n` +
            `📌 <b>Title:</b> ${escapeHtml(args.title)}\n` +
            `📚 <b>Course:</b> ${escapeHtml(args.course || 'General')}\n` +
            `🏷️ <b>Type:</b> <code>${args.task_type}</code>\n` +
            `⏰ <b>Due Date:</b> ${new Date(defaultDue).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\n` +
            `🆔 <b>Task ID:</b> <code>${taskId}</code>\n\n` +
            `<i>The background build worker is claiming and building your deliverables now.</i>`;

          await supabase.from('chat_messages').insert({
            chat_id: chatId,
            role: 'assistant',
            content: confirmation
          });

          return confirmation;
        }

        if (funcName === 'get_system_status') {
          const { data: allTasks } = await supabase
            .from('tasks')
            .select('id, title, status, course, due_date')
            .eq('archived', false)
            .order('due_date', { ascending: true });

          const queued = allTasks?.filter((t) => t.status === 'queued' || t.status === 'new').length || 0;
          const building = allTasks?.filter((t) => t.status === 'building' || t.status === 'claimed' || t.status === 'verifying').length || 0;
          const flagged = allTasks?.filter((t) => t.status === 'flagged').length || 0;
          const done = allTasks?.filter((t) => t.status === 'done').length || 0;

          let statusMsg =
            `📊 <b>Vicarius Academic System Status</b>\n\n` +
            `• ⏳ <b>Queued:</b> ${queued}\n` +
            `• 🔨 <b>In Progress:</b> ${building}\n` +
            `• ⚠️ <b>Flagged:</b> ${flagged}\n` +
            `• ✅ <b>Done:</b> ${done}\n\n`;

          if (allTasks && allTasks.length > 0) {
            statusMsg += `<b>Upcoming Coursework:</b>\n`;
            allTasks.slice(0, 5).forEach((t) => {
              const dueStr = t.due_date ? new Date(t.due_date).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'No deadline';
              statusMsg += `• [${t.status.toUpperCase()}] <b>${escapeHtml(t.title)}</b> (${escapeHtml(t.course || 'General')}) — Due: ${dueStr}\n`;
            });
          }

          await supabase.from('chat_messages').insert({
            chat_id: chatId,
            role: 'assistant',
            content: statusMsg
          });

          return statusMsg;
        }

        if (funcName === 'list_active_tasks') {
          let q = supabase.from('tasks').select('id, title, status, course, due_date').eq('archived', false);
          if (args.course) {
            q = q.ilike('course', `%${args.course}%`);
          }
          const { data: listTasks } = await q.order('due_date', { ascending: true });

          let listMsg = `📋 <b>Active Academic Tasks:</b>\n\n`;
          if (listTasks && listTasks.length > 0) {
            listTasks.forEach((t) => {
              const dueStr = t.due_date ? new Date(t.due_date).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'No deadline';
              listMsg += `• [${t.status.toUpperCase()}] <b>${escapeHtml(t.title)}</b> (${escapeHtml(t.course || 'General')}) — Due: ${dueStr}\n`;
            });
          } else {
            listMsg += `<i>No active tasks found matching criteria.</i>`;
          }

          await supabase.from('chat_messages').insert({
            chat_id: chatId,
            role: 'assistant',
            content: listMsg
          });

          return listMsg;
        }

        if (funcName === 'save_course_feedback') {
          const course = args.course || 'General';
          const feedback = args.feedback || '';
          const resultMsg = await rememberCourseCorrection(course, feedback);
          
          await supabase.from('chat_messages').insert({
            chat_id: chatId,
            role: 'assistant',
            content: resultMsg
          });
          
          return resultMsg;
        }
      }

      const aiText = message?.content || 'I processed your message.';

      // ─────────────────────────────────────────────────────────────────
      // Phase 1B: AI Safety-Net
      // If the model returned TEXT that looks like a task outline/content
      // without calling the create_academic_task tool, auto-intercept.
      // ─────────────────────────────────────────────────────────────────
      const looksLikeTaskOutline = (
        /slide\s*\d+|\d+\.\s+[A-Z]/i.test(aiText) ||
        /(introduction|overview|conclusion|summary|objectives|methodology)/i.test(aiText)
      ) && (
        /(create|build|make|generate|prepare|write|design)/i.test(userPrompt) ||
        /(ppt|presentation|slide|report|essay|research|code|project|app)/i.test(userPrompt)
      );

      if (looksLikeTaskOutline) {
        console.log('[AI-Safety-Net] Model returned outline instead of calling tool — auto-creating task.');
        try {
          const autoConfirmation = await createTaskFromTelegram(userPrompt);
          const safetyMsg = `⚡ <b>Auto-detected:</b> I noticed you want me to build something, so I've automatically queued it!\n\n${autoConfirmation}`;
          await supabase.from('chat_messages').insert({
            chat_id: chatId, role: 'assistant', content: safetyMsg
          });
          return safetyMsg;
        } catch (e) {
          // Fall through to return the AI text if auto-creation fails
        }
      }

      // Save assistant response to history
      await supabase.from('chat_messages').insert({
        chat_id: chatId,
        role: 'assistant',
        content: aiText
      });
      
      return aiText;
    } catch (err: any) {
      console.error('OpenRouter AI error:', err);
      return `❌ AI service error: ${escapeHtml(err.message)}`;
    }
  }

  return 'I am currently unable to answer (AI key not configured).';
}


/**
 * Phase 2A: Downloads and transcribes a Telegram voice message via Whisper.
 */
async function transcribeVoiceMessage(fileId: string): Promise<string> {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const openRouterKey = process.env.OPENROUTER_API_KEY;

  try {
    // Step 1: Get file path from Telegram
    const fileRes = await fetch(`${process.env.TELEGRAM_API_BASE || 'https://api.telegram.org/bot'}${token}/getFile?file_id=${fileId}`);
    if (!fileRes.ok) throw new Error('Failed to get file info from Telegram');
    const fileData = await fileRes.json();
    const filePath = fileData.result?.file_path;
    if (!filePath) throw new Error('No file_path in Telegram response');

    // Step 2: Download voice file
    const audioUrl = `${process.env.TELEGRAM_FILE_BASE || 'https://api.telegram.org/file/bot'}${token}/${filePath}`;
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) throw new Error('Failed to download voice file');
    const audioBuffer = await audioRes.arrayBuffer();

    // Step 3: Transcribe via OpenAI Whisper (using standard OpenAI endpoint if key available)
    const openAiKey = process.env.OPENAI_API_KEY;
    if (openAiKey) {
      const formData = new FormData();
      const audioBlob = new Blob([audioBuffer], { type: 'audio/ogg' });
      formData.append('file', audioBlob, 'voice.ogg');
      formData.append('model', 'whisper-1');
      formData.append('language', 'en');

      const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${openAiKey}` },
        body: formData,
      });
      if (whisperRes.ok) {
        const whisperData = await whisperRes.json();
        return whisperData.text || '';
      }
    }

    // Fallback: Use OpenRouter MiniMax (text-only fallback message)
    console.warn('[Whisper] OpenAI key not available, audio transcription skipped.');
    return '[Voice message received — transcription unavailable. Please type your request.]';
  } catch (err: any) {
    console.error('[Whisper] Transcription error:', err?.message);
    return '[Could not transcribe voice message. Please type your request.]';
  }
}


/**
 * Phase 2B: Extracts assignment requirements from a photo or PDF using AI vision.
 */
async function extractTaskFromImage(fileId: string, mimeType?: string): Promise<string> {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (!openRouterKey) return '';

  try {
    // Step 1: Get file download URL
    const fileRes = await fetch(`${process.env.TELEGRAM_API_BASE || 'https://api.telegram.org/bot'}${token}/getFile?file_id=${fileId}`);
    const fileData = await fileRes.json();
    const filePath = fileData.result?.file_path;
    if (!filePath) return '';
    const fileUrl = `${process.env.TELEGRAM_FILE_BASE || 'https://api.telegram.org/file/bot'}${token}/${filePath}`;

    // Step 2: Send to OpenRouter vision model for OCR + extraction
    const visionRes = await fetch(process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'minimax/minimax-m3:free',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: fileUrl },
              },
              {
                type: 'text',
                text: 'Extract all assignment requirements from this image/document. List: the assignment title, course name, due date, and all specific instructions or requirements. Return as plain text, structured clearly.',
              },
            ],
          },
        ],
        temperature: 0.1,
      }),
    });

    if (!visionRes.ok) {
      console.warn(`[Vision] OCR request failed: ${visionRes.status}`);
      return '';
    }
    const visionData = await visionRes.json();
    return visionData.choices?.[0]?.message?.content || '';
  } catch (err: any) {
    console.error('[Vision] Image extraction error:', err?.message);
    return '';
  }
}

/**
 * Handles incoming webhook updates from Telegram
 */
export async function handleTelegramWebhook(update: TelegramUpdate): Promise<{ handled: boolean; responseText?: string }> {
  const allowedChatId = (process.env.TELEGRAM_ALLOWED_CHAT_ID || '').replace(/['"\r\n\s]/g, '');
  const rawIncomingId = update.message?.chat.id || update.callback_query?.message?.chat.id || update.message?.from?.id;
  const incomingChatId = rawIncomingId ? String(rawIncomingId).replace(/['"\r\n\s]/g, '') : '';

  // Strict chat-ID authorization: silently ignore unauthorized senders (PRD Section 8 / CLAUDE.md)
  if (!incomingChatId) {
    return { handled: false };
  }
  if (allowedChatId && incomingChatId !== allowedChatId && !allowedChatId.includes(incomingChatId)) {
    console.warn(`Unauthorized Telegram sender: ${incomingChatId} (expected: ${allowedChatId})`);
    return { handled: false };
  }

  const reply = (msg: string, parseMode: 'Markdown' | 'HTML' = 'HTML') => sendTelegramMessage(msg, parseMode, incomingChatId);

  const supabase = getSupabaseAdmin();
  const text = update.message?.text?.trim() || update.message?.caption?.trim() || '';

  // ── Phase 2A: Voice Message → Transcription → AI ──
  if (update.message?.voice) {
    const voice = update.message.voice;
    await reply('🎤 <i>Voice message received — transcribing...</i>');
    const transcript = await transcribeVoiceMessage(voice.file_id);
    if (transcript && !transcript.startsWith('[')) {
      await reply(`🎤 <b>Heard:</b> "${escapeHtml(transcript)}"\n\n<i>Processing...</i>`);
      const aiResponse = await askAiAssistant(transcript, incomingChatId);
      await reply(aiResponse);
    } else {
      await reply(`🎤 ${escapeHtml(transcript)}`);
    }
    return { handled: true, responseText: 'Voice message processed' };
  }

  // ── Phase 2B: Photo → Vision OCR → Task Extraction ──
  if (update.message?.photo && update.message.photo.length > 0) {
    const photos = update.message.photo;
    const highestRes = photos[photos.length - 1]; // last = highest resolution
    await reply('📷 <i>Photo received — extracting assignment requirements...</i>');
    const caption = update.message.caption || '';
    const extracted = await extractTaskFromImage(highestRes.file_id);
    if (extracted) {
      const combinedPrompt = caption
        ? `${caption}\n\nExtracted from image:\n${extracted}`
        : `Assignment detected in photo:\n${extracted}`;
      await reply(`📋 <b>Extracted requirements:</b>\n${escapeHtml(extracted.slice(0, 400))}...\n\n<i>Creating task...</i>`);
      const aiResponse = await askAiAssistant(combinedPrompt, incomingChatId);
      await reply(aiResponse);
    } else {
      await reply('❌ Could not extract assignment details from the photo. Please type the requirements or send a clearer image.');
    }
    return { handled: true, responseText: 'Photo processed' };
  }

  // 1. Check if user attached a document/file
  if (update.message?.document) {
    const doc = update.message.document;
    const caption = text || doc.file_name || 'Academic Assignment Document';
    
    // Phase 2B: PDF vision extraction
    if (doc.mime_type === 'application/pdf') {
      await reply('📄 <i>PDF received — extracting assignment requirements with AI vision...</i>');
      const extracted = await extractTaskFromImage(doc.file_id, doc.mime_type);
      if (extracted) {
        const prompt = `Assignment from PDF "${doc.file_name || 'document'}": ${caption}\n\nExtracted content:\n${extracted}`;
        await reply(`📋 <b>Extracted from PDF:</b>\n${escapeHtml(extracted.slice(0, 400))}...\n\n<i>Creating task...</i>`);
        const aiResponse = await askAiAssistant(prompt, incomingChatId);
        await reply(aiResponse);
      } else {
        const prompt = `Attached PDF: ${doc.file_name || 'document'}\nInstructions: ${caption}`;
        try {
          const confirmation = await createTaskFromTelegram(prompt);
          await reply(confirmation);
        } catch (err: any) {
          await reply(`❌ Failed to create task: ${escapeHtml(err.message)}`);
        }
      }
      return { handled: true, responseText: 'PDF task created' };
    }
    
    const prompt = `Attached file: ${doc.file_name || 'document'}\nInstructions: ${caption}`;
    try {
      const confirmation = await createTaskFromTelegram(prompt);
      await reply(confirmation);
      return { handled: true, responseText: 'Task created from document' };
    } catch (err: any) {
      await reply(`❌ Failed to create task: ${escapeHtml(err.message)}`);
      return { handled: true };
    }
  }

  // 2. Reply-to-fix: user is replying to a flagged-task alert with a plain-language fix instruction.
  // Runs BEFORE the pending-question handler so fix instructions are never captured as question answers.
  // Detection is deliberately strict: the replied-to message must carry a task UUID AND flag markers,
  // AND the task must actually be flagged/failed — so replies to questions or confirmations fall through.
  const fixReplyTo = update.message?.reply_to_message;
  if (fixReplyTo?.text && text && !text.startsWith('/')) {
    const uuidMatch = fixReplyTo.text.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    const looksLikeFlag = fixReplyTo.text.includes('⚠️')
      || /couldn.?t finish|what went wrong|what i already tried|flagged/i.test(fixReplyTo.text);
    if (uuidMatch && looksLikeFlag) {
      const flaggedId = uuidMatch[1];
      const { data: flaggedTask } = await supabase
        .from('tasks')
        .select('id, status')
        .eq('id', flaggedId)
        .maybeSingle();
      if (flaggedTask && (flaggedTask.status === 'flagged' || flaggedTask.status === 'failed')) {
        await reply('🔧 <i>Understood — applying your fix and rebuilding...</i>');
        const fixMsg = await applyFixAndRequeue(flaggedId, text);
        await reply(fixMsg);
        return { handled: true, responseText: 'Fix applied and task re-queued' };
      }
    }
  }

  // 3. Check if user is replying to a pending question
  const replyTo = update.message?.reply_to_message;
  let pendingQuestion = null;

  if (replyTo) {
    const { data: q } = await supabase
      .from('questions')
      .select('*')
      .eq('status', 'pending')
      .order('asked_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    pendingQuestion = q;
  } else if (text && !text.startsWith('/')) {
    const { data: q } = await supabase
      .from('questions')
      .select('*')
      .eq('status', 'pending')
      .order('asked_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    pendingQuestion = q;
  }

  if (pendingQuestion && text) {
    let finalAnswer = text;
    const openRouterKey = process.env.OPENROUTER_API_KEY;
    if (openRouterKey) {
      try {
        const res = await fetch(process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openRouterKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'minimax/minimax-m3:free',
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
          })
        });
        
        if (!res.ok) {
          throw new Error(`OpenRouter API error: ${res.statusText}`);
        }
        
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content || '{}';
        const parsed = JSON.parse(content.replace(/```json/g, '').replace(/```/g, '').trim());
        if (parsed.confident && parsed.answer) {
          finalAnswer = parsed.answer;
        }
      } catch (err) {
        console.warn('OpenRouter answer parse error, using raw text:', err);
      }
    }

    await supabase.from('questions').update({
      answer_text: finalAnswer,
      status: 'answered',
      answered_at: new Date().toISOString(),
    }).eq('id', pendingQuestion.id);

    await reply(`✅ <b>Recorded answer:</b> "${escapeHtml(finalAnswer)}"\n\n<i>The build worker will proceed with your instructions.</i>`);
    return { handled: true, responseText: 'Question answered' };
  }

  const lower = text.toLowerCase();

  // 3a. Direct Google Classroom Query (Commands & Natural Language)
  const isClassroomQuery =
    lower.startsWith('/classroom') ||
    lower.startsWith('/announcements') ||
    lower.startsWith('/notices') ||
    /^(tell me|show me|what is|check|get|fetch)?\s*(the\s*)?(last|latest|recent|new)?\s*(message|messages|announcement|announcements|notice|notices|post|posts|update|updates)?\s*(of|from|in|on)?\s*(my\s*)?(google\s*)?(classroom|class room)/i.test(text) ||
    /(classroom|class room).*(last|latest|recent|message|announcement|notice|post)/i.test(text) ||
    /(last|latest|recent).*(message|notice|announcement).*(classroom|class room)/i.test(text);

  if (isClassroomQuery) {
    await reply('🔍 <i>Checking your Google Classroom for recent messages & announcements...</i>');
    const classroomMsg = await getLatestClassroomMessages(5);
    await reply(classroomMsg);
    await supabase.from('chat_messages').insert([
      { chat_id: incomingChatId, role: 'user', content: text },
      { chat_id: incomingChatId, role: 'assistant', content: classroomMsg }
    ]);
    return { handled: true };
  }

  // 3b. Direct Gmail Query (Commands & Natural Language)
  const isEmailQuery =
    lower.startsWith('/emails') ||
    lower.startsWith('/mail') ||
    lower.startsWith('/inbox') ||
    /^(tell me|show me|check|what are|get|fetch)?\s*(my\s*)?(recent|latest|new|unread)?\s*(emails|email|messages|mails|inbox)/i.test(text) ||
    /(gmail|email|inbox).*(check|latest|recent|new|messages)/i.test(text);

  if (isEmailQuery) {
    await reply('📬 <i>Checking your Gmail inbox for recent messages...</i>');
    const emailMsg = await getRecentGmailEmails(5);
    await reply(emailMsg);
    await supabase.from('chat_messages').insert([
      { chat_id: incomingChatId, role: 'user', content: text },
      { chat_id: incomingChatId, role: 'assistant', content: emailMsg }
    ]);
    return { handled: true };
  }

  // 3c. Direct Sync / Poll Command
  const isSyncQuery =
    lower.startsWith('/sync') ||
    lower.startsWith('/poll') ||
    /^(sync|poll|refresh)\s*(classroom|gmail|sources|tasks|assignments)?/i.test(text);

  if (isSyncQuery) {
    await reply('🔄 <i>Syncing Google Classroom & Gmail now...</i>');
    const syncMsg = await syncClassroomAndGmail();
    await reply(syncMsg);
    await supabase.from('chat_messages').insert([
      { chat_id: incomingChatId, role: 'user', content: text },
      { chat_id: incomingChatId, role: 'assistant', content: syncMsg }
    ]);
    return { handled: true };
  }

  // 3. Create Task Command: /task, /new, /add, /create
  if (
    lower.startsWith('/task') ||
    lower.startsWith('/new') ||
    lower.startsWith('/add') ||
    lower.startsWith('/create')
  ) {
    const prompt = text.replace(/^\/(task|new|add|create)\s*/i, '').trim();
    if (!prompt) {
      await reply(
        `📝 <b>How to create a task:</b>\n\n` +
        `Type: <code>/task &lt;your assignment details&gt;</code>\n\n` +
        `<b>Examples:</b>\n` +
        `• <code>/task CE-401 Machine Learning: 5-page lab report on Adam vs SGD with loss curves due Friday</code>\n` +
        `• <code>/task CE-502 Cloud: 10-slide presentation deck on Kubernetes Pod lifecycle</code>\n` +
        `• <code>/task CE-403 Web Tech: Full-stack Next.js task dashboard with README and UI screenshot</code>`
      );
      return { handled: true };
    }

    try {
      await reply('⏳ <i>Analyzing requirements and creating task...</i>');
      const confirmation = await createTaskFromTelegram(prompt);
      await reply(confirmation);
    } catch (e: any) {
      await reply(`❌ Failed to create task: ${escapeHtml(e.message)}`);
    }
    return { handled: true };
  }

  // 4. List Tasks Command: /tasks, /list
  if (lower === '/tasks' || lower === '/list') {
    const { data: tasks } = await supabase
      .from('tasks')
      .select('id, title, course, task_type, status, due_date')
      .eq('archived', false)
      .order('due_date', { ascending: true })
      .limit(15);

    if (!tasks || tasks.length === 0) {
      await reply('📋 <b>No active tasks in queue.</b>\n\nUse <code>/task &lt;details&gt;</code> to create one!');
      return { handled: true };
    }

    let msg = `📋 <b>Active Academic Tasks (${tasks.length})</b>\n\n`;
    tasks.forEach((t, idx) => {
      const dueStr = t.due_date ? new Date(t.due_date).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'No deadline';
      const badge = t.status === 'done' ? '✅ DONE' : t.status === 'building' ? '🔨 BUILDING' : t.status === 'queued' ? '⏳ QUEUED' : `⚠️ ${t.status.toUpperCase()}`;
      msg += `${idx + 1}. <b>${escapeHtml(t.title)}</b>\n`;
      msg += `   📚 ${escapeHtml(t.course || 'General')} | 🏷️ <code>${t.task_type}</code> | [${badge}]\n`;
      msg += `   ⏰ Due: ${dueStr} | 🆔 <code>${t.id}</code>\n\n`;
    });
    msg += `<i>Tip: Type <code>/details &lt;task_id&gt;</code> to view download links.</i>`;
    await reply(msg);
    return { handled: true };
  }

  // 5. Details Command: /details <task_id>, /info <task_id>
  if (lower.startsWith('/details') || lower.startsWith('/info')) {
    const parts = text.split(/\s+/);
    if (parts.length < 2) {
      await reply('Usage: <code>/details &lt;task_id&gt;</code>');
      return { handled: true };
    }
    const taskId = parts[1].trim();
    const { data: task } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .maybeSingle();

    if (!task) {
      await reply(`❌ Task not found: <code>${escapeHtml(taskId)}</code>`);
      return { handled: true };
    }

    const { data: delivs } = await supabase
      .from('deliverables')
      .select('*')
      .eq('task_id', taskId);

    let dMsg = `📌 <b>Task Details:</b> ${escapeHtml(task.title)}\n\n` +
      `📚 <b>Course:</b> ${escapeHtml(task.course || 'General')}\n` +
      `🏷️ <b>Type:</b> <code>${task.task_type}</code>\n` +
      `📊 <b>Status:</b> <code>${task.status.toUpperCase()}</code>\n` +
      `⏰ <b>Due:</b> ${task.due_date ? new Date(task.due_date).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A'}\n\n`;

    if (task.result_summary) {
      dMsg += `📝 <b>Summary:</b> ${escapeHtml(task.result_summary)}\n\n`;
    }

    if (delivs && delivs.length > 0) {
      dMsg += `📁 <b>Deliverables:</b>\n`;
      delivs.forEach(d => {
        if (d.drive_link) {
          dMsg += `• <a href="${d.drive_link}">${escapeHtml(d.file_name)}</a>\n`;
        } else {
          dMsg += `• <code>${escapeHtml(d.file_name)}</code>\n`;
        }
      });
    }

    await reply(dMsg);
    return { handled: true };
  }

  // 6. Delete / Cancel Command: /delete <task_id>, /cancel <task_id>
  if (lower.startsWith('/delete') || lower.startsWith('/cancel')) {
    const parts = text.split(/\s+/);
    if (parts.length > 1) {
      const taskId = parts[1].trim();
      const { error } = await supabase
        .from('tasks')
        .update({ archived: true, updated_at: new Date().toISOString() })
        .eq('id', taskId);

      if (!error) {
        await reply(`🗑️ Task <code>${escapeHtml(taskId)}</code> has been archived.`);
      } else {
        await reply(`❌ Could not delete task: ${escapeHtml(error.message)}`);
      }
      return { handled: true };
    }
  }

  // 7. Status Command
  if (
    lower === '/status' ||
    lower.includes('status') ||
    lower.includes('what is happening')
  ) {
    const { data: tasks } = await supabase
      .from('tasks')
      .select('id, title, course, status, due_date')
      .eq('archived', false)
      .order('due_date', { ascending: true })
      .limit(10);

    if (!tasks || tasks.length === 0) {
      await reply('📋 <b>No active tasks currently in queue.</b>');
      return { handled: true };
    }

    const counts: Record<string, number> = {};
    tasks.forEach((t) => {
      counts[t.status] = (counts[t.status] || 0) + 1;
    });

    let statusMsg = `📊 <b>Vicarius System Status</b>\n\n` +
      `• ⏳ Queued: <b>${counts['queued'] || 0}</b>\n` +
      `• 🔨 In Progress: <b>${(counts['claimed'] || 0) + (counts['building'] || 0) + (counts['verifying'] || 0)}</b>\n` +
      `• ⚠️ Flagged: <b>${counts['flagged'] || 0}</b>\n` +
      `• ✅ Done: <b>${counts['done'] || 0}</b>\n\n` +
      `<b>Upcoming Deadlines:</b>\n`;

    tasks.slice(0, 5).forEach((t) => {
      const dueStr = t.due_date ? new Date(t.due_date).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'No deadline';
      statusMsg += `• [${t.status.toUpperCase()}] <b>${escapeHtml(t.title)}</b> (${escapeHtml(t.course || 'General')}) — Due: ${dueStr}\n`;
    });

    await reply(statusMsg);
    return { handled: true };
  }

  // 8. Retry Command — `/retry <id>` re-queues as-is; `/retry <id> <instructions>` applies an AI fix first
  if (lower.startsWith('/retry')) {
    const parts = text.split(/\s+/);
    if (parts.length > 1) {
      const taskId = parts[1].trim();
      const instruction = text.replace(/^\/retry\s+\S+\s*/i, '').trim();

      if (instruction) {
        await reply('🔧 <i>Applying your fix and rebuilding...</i>');
        const fixMsg = await applyFixAndRequeue(taskId, instruction);
        await reply(fixMsg);
        return { handled: true };
      }

      const { error } = await supabase
        .from('tasks')
        .update({ status: 'queued', updated_at: new Date().toISOString() })
        .eq('id', taskId);

      if (!error) {
        await reply(`🔄 Task <code>${escapeHtml(taskId)}</code> requeued for build.\n\n<i>The background worker will pick it up on the next cycle. Tip: <code>/retry ${escapeHtml(taskId)} &lt;what to change&gt;</code> to fix it first.</i>`);
      } else {
        await reply(`❌ Could not retry task: ${escapeHtml(error.message)}`);
      }
      return { handled: true };
    }
  }

  // 8b. Fix Command — `/fix <id> <instructions>`: apply an AI patch to the task, then re-queue it
  if (lower.startsWith('/fix')) {
    const parts = text.split(/\s+/);
    const instruction = text.replace(/^\/fix\s+\S+\s*/i, '').trim();
    if (parts.length < 3 || !instruction) {
      await reply(
        'Usage: <code>/fix &lt;task_id&gt; &lt;what to change&gt;</code>\n\n' +
        'Example: <code>/fix 1234abcd-... make it 8 slides and add IEEE citations</code>\n\n' +
        '<i>Tip: you can also just reply to a flagged-task alert with your instruction — no command needed.</i>'
      );
      return { handled: true };
    }
    const taskId = parts[1].trim();
    await reply('🔧 <i>Applying your fix and rebuilding...</i>');
    const fixMsg = await applyFixAndRequeue(taskId, instruction);
    await reply(fixMsg);
    return { handled: true };
  }

  // Phase 3D: /ask Command — search past deliverables + AI Q&A
  if (lower.startsWith('/ask')) {
    const question = text.replace(/^\/ask\s*/i, '').trim();
    if (!question) {
      await reply(
        '🔍 <b>How to use /ask:</b>\n\n' +
        '<code>/ask what was my CIFAR-10 accuracy?</code>\n' +
        '<code>/ask show me links for ML lab report</code>\n' +
        '<code>/ask what is the deadline for CE-401?</code>'
      );
      return { handled: true };
    }

    // Search deliverables and tasks
    const keywords = question.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const { data: searchTasks } = await supabase
      .from('tasks')
      .select('id, title, course, status, due_date, result_summary')
      .eq('archived', false)
      .or(keywords.map(k => `title.ilike.%${k}%`).join(','))
      .limit(5);

    const { data: searchDelivs } = await supabase
      .from('deliverables')
      .select('task_id, file_name, file_type, drive_link, created_at')
      .or(keywords.map(k => `file_name.ilike.%${k}%`).join(','))
      .limit(5);

    if ((searchTasks && searchTasks.length > 0) || (searchDelivs && searchDelivs.length > 0)) {
      let resultMsg = `🔍 <b>Results for:</b> "${escapeHtml(question)}"\n\n`;

      if (searchTasks && searchTasks.length > 0) {
        resultMsg += `<b>📋 Matching Tasks:</b>\n`;
        searchTasks.forEach(t => {
          const dueStr = t.due_date ? new Date(t.due_date).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A';
          resultMsg += `• [${t.status.toUpperCase()}] <b>${escapeHtml(t.title)}</b> — Due: ${dueStr}\n`;
          if (t.result_summary) resultMsg += `  <i>${escapeHtml(t.result_summary.slice(0, 80))}</i>\n`;
        });
        resultMsg += '\n';
      }

      if (searchDelivs && searchDelivs.length > 0) {
        resultMsg += `<b>📁 Deliverable Files:</b>\n`;
        searchDelivs.forEach(d => {
          if (d.drive_link) {
            resultMsg += `• <a href="${d.drive_link}">${escapeHtml(d.file_name)}</a>\n`;
          } else {
            resultMsg += `• <code>${escapeHtml(d.file_name)}</code>\n`;
          }
        });
      }

      await reply(resultMsg);
    } else {
      // No DB results — ask AI assistant
      const aiAnswer = await askAiAssistant(question, incomingChatId);
      await reply(`🔍 <b>No records found.</b> Here's what the AI knows:\n\n${aiAnswer}`);
    }
    return { handled: true };
  }

  // 9. Help / Start Command
  if (lower === '/help' || lower === '/start') {
    const helpMsg =
      `🤖 <b>Vicarius Academic Assistant</b>\n\n` +
      `<b>📚 Live Classroom &amp; Email:</b>\n` +
      `• <code>/classroom</code> — View latest Google Classroom notices &amp; messages\n` +
      `• <code>/emails</code> — View recent Gmail messages &amp; academic alerts\n` +
      `• <code>/sync</code> — On-demand re-poll of Classroom and Gmail\n\n` +
      `<b>📝 Task Management:</b>\n` +
      `• <code>/task &lt;details&gt;</code> — Create &amp; queue task\n` +
      `• <code>/tasks</code> — View all active tasks\n` +
      `• <code>/details &lt;task_id&gt;</code> — View requirements &amp; download links\n` +
      `• <code>/retry &lt;task_id&gt;</code> — Requeue a flagged task as-is\n` +
      `• <code>/fix &lt;task_id&gt; &lt;change&gt;</code> — Fix &amp; rebuild a flagged task\n` +
      `• <code>/cancel &lt;task_id&gt;</code> — Archive / cancel a task\n\n` +
      `<b>🛠️ When a task gets flagged:</b>\n` +
      `• I'll message you in plain language explaining exactly what went wrong.\n` +
      `• <b>Just reply to that message</b> telling me what to change (e.g. "make it 8 slides") and I'll fix it and rebuild automatically — no command needed.\n\n` +
      `<b>🔍 Search &amp; Ask:</b>\n` +
      `• <code>/ask &lt;question&gt;</code> — Search past deliverables &amp; results\n` +
      `• <code>/status</code> — Live system telemetry\n\n` +
      `<b>🎙️ Natural Language Input:</b>\n` +
      `• <b>Ask naturally:</b> "Tell me last message of my classroom" → reads live announcements!\n` +
      `• <b>Build tasks:</b> "make me a 10-slide ppt on Cloud Computing" → auto-queued!\n` +
      `• <b>Voice notes:</b> 🎤 Send a voice message — I'll transcribe and process it\n` +
      `• <b>Photos:</b> 📷 Send a photo of an assignment sheet — I'll extract requirements\n` +
      `• <b>PDFs:</b> 📄 Attach a PDF — I'll read and auto-create the task\n\n` +
      `<b>💬 AI Chat:</b>\n` +
      `• Ask any academic concept question or just chat!`;
    await reply(helpMsg);
    return { handled: true };
  }

  // 10. Direct AI Model Brain (OpenRouter MiniMax with Native Tool Calling)
  try {
    const aiResponse = await askAiAssistant(text, incomingChatId);
    await reply(aiResponse);
  } catch (err: any) {
    await reply("I'm your Vicarius academic assistant. Ask me anything or tell me what assignment to create!");
  }

  return { handled: true };
}
