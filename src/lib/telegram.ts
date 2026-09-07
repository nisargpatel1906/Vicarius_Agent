// Telegram Bot Integration & Notifications
// Sourced from PRD_academic_task_agent.md (Section 8, Section 7)

import { getSupabaseAdmin, logSystemEvent } from './supabase';
import { getGmailClient, getClassroomClient } from './google-auth';
import { TaskType } from './types';
import { rememberCourseCorrection } from './aethos';

const TELEGRAM_API_BASE = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org/bot';
const TELEGRAM_FILE_BASE = process.env.TELEGRAM_FILE_BASE || 'https://api.telegram.org/file/bot';
const OPENROUTER_API_URL = process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'minimax/minimax-m3:free';
const GROQ_API_URL = process.env.GROQ_API_URL || 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GROQ_WHISPER_URL = process.env.GROQ_WHISPER_URL || 'https://api.groq.com/openai/v1/audio/transcriptions';
const OPENAI_WHISPER_URL = process.env.OPENAI_WHISPER_URL || 'https://api.openai.com/v1/audio/transcriptions';
const STUDENT_NAME = process.env.STUDENT_NAME || 'Nisarg Patel';
const STUDENT_UNIVERSITY = process.env.STUDENT_UNIVERSITY || 'Academic Institution';
const STUDENT_PROGRAM = process.env.STUDENT_PROGRAM || 'Computer Engineering / AI-ML';

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
export async function createTaskFromTelegram(promptText: string, attachmentMeta?: any): Promise<string> {
  const supabase = getSupabaseAdmin();
  const rawBody = promptText.trim();

  let parsed: any = null;
  const systemPrompt = `You are the Vicarius Academic Task Parser for a Computer Engineering / AI-ML student.
Extract the structured task details into strict JSON:
{
  "title": string (concise, descriptive academic title),
  "course": string (e.g. "CE-401 Machine Learning", "CE-502 Cloud Computing", "CE-403 Web Technologies", "CE-505 Information Security", "DLCV 2026", or "General"),
  "task_type": "document" | "presentation" | "code_project" | "ml_training" | "research" | "handwritten",
  "weight": "light" | "medium" | "heavy",
  "confidence": number (confidence score from 0.0 to 1.0; e.g. 0.95 for clear prompt, 0.50 if ambiguous),
  "due_date": string in ISO 8601 with Asia/Kolkata timezone offset (+05:30) (e.g. "2026-09-10T18:00:00+05:30". If not specified, default to 3 days from now at 18:00:00+05:30),
  "requirements": string[] (list of key instructions),
  "success_criteria": string (verification criteria),
  "build_spec": string (detailed prompt instructions for the build agent. If the task involves UI, web app, frontend, or presentation, MUST mandate using docx/DESIGN.md Cognitive Heritage design tokens: surface #fff8f4, primary #705728, on-surface #231a0f, typography Noto Serif + Manrope)
}`;

  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  // Row 4: Primary Model: OpenRouter (minimax/minimax-m3:free)
  if (openRouterKey) {
    try {
      const res = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openRouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.HTTP_REFERER || 'https://vicarius-agent.local',
          'X-Title': 'Vicarius Academic Agent',
        },
        body: JSON.stringify({
          model: OPENROUTER_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: rawBody },
          ],
          temperature: 0.1,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content || '{}';
        const candidate = JSON.parse(content.replace(/```json/g, '').replace(/```/g, '').trim());
        const conf = typeof candidate.confidence === 'number' ? candidate.confidence : 0.85;
        if (conf >= 0.70 && candidate.title) {
          parsed = candidate;
        } else {
          console.warn(`[Telegram:Classify] OpenRouter confidence (${conf}) < 0.70. Triggering Fallback 1 (Groq)...`);
        }
      } else {
        console.warn(`[Telegram:Classify] OpenRouter primary failed (${res.status}). Triggering Fallback 1 (Groq)...`);
      }
    } catch (err) {
      console.warn('[Telegram:Classify] OpenRouter primary error:', err);
    }
  }

  // Row 4: Fallback 1: OpenRouter Free Backups (google/gemini-2.0-flash-exp:free / meta-llama/llama-3.3-70b-instruct:free)
  if (!parsed && openRouterKey) {
    const candidateModels = [
      'google/gemini-2.0-flash-exp:free',
      'meta-llama/llama-3.3-70b-instruct:free',
      'meta-llama/llama-3.3-70b-instruct',
    ];
    for (const orModel of candidateModels) {
      try {
        const res = await fetch(OPENROUTER_API_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openRouterKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': process.env.HTTP_REFERER || 'https://vicarius-agent.local',
            'X-Title': 'Vicarius Academic Agent',
          },
          body: JSON.stringify({
            model: orModel,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: rawBody },
            ],
            temperature: 0.1,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const content = data.choices?.[0]?.message?.content || '{}';
          const candidate = JSON.parse(content.replace(/```json/g, '').replace(/```/g, '').trim());
          const conf = typeof candidate.confidence === 'number' ? candidate.confidence : 0.85;
          if (conf >= 0.70 && candidate.title) {
            parsed = candidate;
            console.log(`[Telegram:Classify] Recovered via OpenRouter Fallback (${orModel}).`);
            break;
          }
        }
      } catch (err) {
        console.warn(`[Telegram:Classify] OpenRouter backup model ${orModel} error:`, err);
      }
    }
  }

  // Row 4: Fallback 2: Google Gemini (gemini-3.6-flash / gemini-flash-latest)
  if (!parsed && geminiKey) {
    try {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(geminiKey);
      for (const gemModel of ['gemini-3.6-flash', 'gemini-flash-latest']) {
        try {
          const model = genAI.getGenerativeModel({ model: gemModel });
          const result = await model.generateContent([
            { text: `${systemPrompt}\n\nUser Prompt:\n${rawBody}` },
          ]);
          const text = result.response.text() || '';
          const candidate = JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());
          if (candidate.title) {
            parsed = candidate;
            console.log(`[Telegram:Classify] Recovered via Gemini Fallback (${gemModel}).`);
            break;
          }
        } catch (gemErr) {
          console.warn(`[Telegram:Classify] Gemini ${gemModel} error:`, gemErr);
        }
      }
    } catch (err) {
      console.warn('[Telegram:Classify] Gemini init error:', err);
    }
  }

  parsed = parsed || {};

  const title = parsed.title || rawBody.slice(0, 80) || 'Academic Assignment';
  const course = parsed.course || (rawBody.toLowerCase().includes('dlcv') ? 'Deep Learning with Computer Vision (DLCV 2026)' : 'General');
  
  let taskType: TaskType = parsed.task_type || 'document';
  const lower = rawBody.toLowerCase();
  
  // Explicit format declarations and domain-aware detection
  if (lower.includes('type: document') || lower.includes('type:document') || lower.includes('report') || lower.includes('essay') || lower.includes('paper')) {
    taskType = 'document';
  } else if (lower.includes('presentation') || lower.includes('slide') || lower.includes('deck') || lower.includes('.pptx')) {
    taskType = 'presentation';
  } else if (lower.includes('code') || lower.includes('react') || lower.includes('next.js') || lower.includes('python script') || lower.includes('web app') || lower.includes('gui') || lower.includes('opencv') || lower.includes('jupyter') || lower.includes('.ipynb')) {
    taskType = 'code_project';
  } else if (lower.includes('train') || lower.includes('epoch') || lower.includes('accuracy target') || lower.includes('val_acc') || lower.includes('dlcv') || lower.includes('deep learning') || lower.includes('fnn') || lower.includes('neural network') || lower.includes('cat and dog') || lower.includes('cat vs dog')) {
    taskType = 'ml_training';
  } else if (lower.includes('research') || lower.includes('citation') || lower.includes('literature review') || lower.includes('ieee') || lower.includes('survey')) {
    taskType = 'research';
  } else if (lower.includes('handwritten') || lower.includes('by hand') || lower.includes('copy-ready')) {
    taskType = 'handwritten';
  }

  // Weight Classification
  let weight: 'light' | 'medium' | 'heavy' = 'light';
  const isHeavy = /dlcv|deep\s+learning|computer\s+vision|neural\s+network|feed-?forward|mlp|cnn|fnn|opencv|model\s+weights|epochs?|cat\s*(?:and|vs)\s*dog|full-?stack|microservice|distributed|pipeline|large\s+dataset/i.test(rawBody) || /dlcv|deep\s+learning|computer\s+vision|neural|fnn|mlp|opencv/i.test(title);
  const isMedium = /jupyter\s+notebook|\.ipynb|research|citation|data\s+analysis|algorithm/i.test(rawBody);

  if (isHeavy || taskType === 'ml_training') {
    weight = 'heavy';
  } else if (isMedium || taskType === 'research' || taskType === 'code_project') {
    weight = 'medium';
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
    weight: weight,
    extracted_requirements: {
      summary: title,
      items: parsed.requirements || [rawBody],
      raw_text: rawBody,
      slide_count: slideCount,
      attachment: attachmentMeta || null,
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

  await logSystemEvent('info', 'telegram', `New task created from Telegram: '${title}' (ID: ${taskId}, Weight: ${weight})`);

  const displayDue = new Date(dueDate).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    `✅ <b>Task Created & Queued!</b>\n\n` +
    `📌 <b>Title:</b> ${escapeHtml(title)}\n` +
    `📚 <b>Course:</b> ${escapeHtml(course)}\n` +
    `🏷️ <b>Type:</b> <code>${taskType}</code>\n` +
    `⚖️ <b>Weight:</b> <code>${weight}</code>\n` +
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
      const res = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${openRouterKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OPENROUTER_MODEL,
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

  // Detect append/extend intent so the coder knows to open the existing file rather than recreate it.
  const isAppendIntent = /\b(?:add|append|additional|more|extend|extra|insert|include)\b.{0,40}\b(?:slide|slides|section|page|paragraph|topic)/i.test(instruction);
  const appendPrefix = isAppendIntent
    ? `[APPEND MODE — DO NOT CREATE A NEW FILE]: Open the existing deliverable and APPEND the following additions to it, do not start from scratch.\n\n`
    : ``;

  const newBuildSpec: string = (patch?.build_spec && String(patch.build_spec).trim())
    ? `${appendPrefix}${String(patch.build_spec)}`
    : `${appendPrefix}${task.build_spec || ''}\n\n[USER FIX]: ${instruction}`;
  const newSuccess: string = (patch?.success_criteria && String(patch.success_criteria).trim())
    ? String(patch.success_criteria)
    : task.success_criteria;
  const newItems: string[] = Array.isArray(patch?.requirements) && patch.requirements.length > 0
    ? patch.requirements
    : [...currentItems, instruction];

  let updatedTaskType = task.task_type;
  const instLower = instruction.toLowerCase();
  if (instLower.includes('document') || instLower.includes('report') || instLower.includes('paper')) {
    updatedTaskType = 'document';
  } else if (instLower.includes('presentation') || instLower.includes('slide') || instLower.includes('.pptx')) {
    updatedTaskType = 'presentation';
  } else if (instLower.includes('code') || instLower.includes('project')) {
    updatedTaskType = 'code_project';
  } else if (instLower.includes('ml') || instLower.includes('train')) {
    updatedTaskType = 'ml_training';
  }

  const { error } = await supabase.from('tasks').update({
    status: 'queued',
    task_type: updatedTaskType,
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
    `🔧 <b>What I changed:</b> ${escapeHtml(changeSummary)}\n` +
    (isAppendIntent ? `📎 <b>Mode:</b> <code>APPEND</code> — existing files will be extended, not replaced.\n` : '') +
    `\n<i>The worker will pick it up on its next cycle. I'll message you when it's done.</i>`
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
      id?: string;
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
            id: `ann_${ann.id}`,
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
            id: `cw_${cw.id}`,
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
    const topIds = top.map((m: any) => m.id).filter(Boolean);
    const supabase = getSupabaseAdmin();
    const { data: kbItems } = await supabase
      .from('knowledge_base')
      .select('external_id, title, content, metadata')
      .in('external_id', topIds);

    const kbMap = new Map((kbItems || []).map((k: any) => [k.external_id, k]));

    let output = `📢 <b>Latest Google Classroom Posts (${top.length}):</b>\n\n`;

    top.forEach((m: any, idx) => {
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

      const rawMatches: string[] = (m.text || '').match(/https?:\/\/[^\s<>)"]+/g) || [];
      const urlMatches: string[] = Array.from(new Set<string>(rawMatches));
      if (urlMatches.length > 0) {
        output += `   🔗 <b>Links:</b> ${urlMatches.slice(0, 3).map((u: string) => `<a href="${u}">${escapeHtml(u)}</a>`).join(', ')}\n`;
      }

      const kbItem: any = kbMap.get(m.id);
      const attachments = kbItem?.metadata?.attachments || [];
      if (attachments.length > 0) {
        attachments.forEach((att: any) => {
          output += `   📎 <b>Attached:</b> <code>${escapeHtml(att.name || 'File')}</code>\n`;
          const rawOcr = (att.extracted_text || '')
            .replace(/```markdown\s*/g, '')
            .replace(/```/g, '')
            .replace(/\s+/g, ' ')
            .trim();
          if (rawOcr) {
            const previewOcr = rawOcr.length > 180 ? rawOcr.slice(0, 180) + '...' : rawOcr;
            output += `   🖼️ <b>Extracted Details:</b> <i>${escapeHtml(previewOcr)}</i>\n`;
          }
        });
      }

      output += `   🕒 <i>${dateStr} IST</i>\n\n`;
    });

    output += `<i>💡 Tip: Reply with <b>"what was in 1"</b> or <b>/details 1</b> to see full extracted poster text, attachments & links.</i>`;

    return output;
  } catch (err: any) {
    console.error('Error fetching Classroom messages:', err);
    return `❌ Could not fetch Google Classroom messages: ${escapeHtml(err.message)}`;
  }
}

/**
 * Formats a Knowledge Base item with full attachments, drive links, and OCR text
 */
export function formatKnowledgeBaseItemDetails(item: any): string {
  const dateStr = item.created_at
    ? new Date(item.created_at).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Recent';

  let msg = `📌 <b>${escapeHtml(item.title || 'Academic Post Details')}</b>\n\n` +
    `📚 <b>Course:</b> ${escapeHtml(item.course || 'General')}\n` +
    `🕒 <b>Posted:</b> <i>${dateStr} IST</i>\n`;

  if (item.metadata?.author) {
    msg += `👤 <b>Author:</b> ${escapeHtml(item.metadata.author)}\n`;
  }
  if (item.metadata?.alternateLink) {
    msg += `🔗 <b>Classroom:</b> <a href="${item.metadata.alternateLink}">Open in Classroom</a>\n`;
  }
  msg += `\n`;

  // 1. Separate post body from any appended attachment text
  const fullContent = (item.content || '').trim();
  const attachmentSplit = fullContent.split(/\n+--- Attachment:\s+/i);
  let mainBody = attachmentSplit[0].trim();

  // Clean up repeated prefix if present
  if (mainBody.startsWith('Announcement:')) {
    mainBody = mainBody.replace(/^Announcement:\s*[^\n]+\n*/i, '').trim();
  }

  // 2. Extract and display all URLs prominently
  const rawUrls: string[] = fullContent.match(/https?:\/\/[^\s<>)"]+/g) || [];
  const allUrls: string[] = Array.from(new Set<string>(rawUrls));
  if (allUrls.length > 0) {
    msg += `🔗 <b>Links &amp; Registration URLs (${allUrls.length}):</b>\n`;
    allUrls.forEach((url: string) => {
      let label = url;
      if (url.includes('forms.gle') || url.includes('google.com/forms')) {
        label = `📝 Google Form: ${url}`;
      } else if (url.includes('allevents.in')) {
        label = `🎟️ Tickets / AllEvents: ${url}`;
      } else if (url.includes('instagram.com')) {
        label = `📸 Instagram: ${url}`;
      } else if (url.includes('tedx')) {
        label = `🌐 Website: ${url}`;
      }
      msg += `  • <a href="${url}">${escapeHtml(label)}</a>\n`;
    });
    msg += `\n`;
  }

  // 3. Attachments & Gemini Vision OCR
  const attachments = item.metadata?.attachments || [];
  if (attachments.length > 0) {
    msg += `📎 <b>Attachments (${attachments.length}):</b>\n`;
    attachments.forEach((att: any, i: number) => {
      const link = att.drive_url || att.url ? `<a href="${att.drive_url || att.url}">${escapeHtml(att.name || 'View File')}</a>` : `<code>${escapeHtml(att.name || 'File')}</code>`;
      msg += `  ${i + 1}. ${link}\n`;
      if (att.extracted_text) {
        const cleanOcr = att.extracted_text
          .replace(/```markdown\s*/gi, '')
          .replace(/```/g, '')
          .trim();
        const truncatedOcr = cleanOcr.length > 2500 ? cleanOcr.slice(0, 2500) + '... (truncated)' : cleanOcr;
        msg += `\n🖼️ <b>Extracted Poster / Document Content (Gemini Vision):</b>\n<i>${escapeHtml(truncatedOcr)}</i>\n\n`;
      }
    });
  }

  // 4. Main Body Text (if not empty)
  if (mainBody && mainBody !== item.title) {
    const previewContent = mainBody.length > 2500 ? mainBody.slice(0, 2500) + '... (truncated)' : mainBody;
    msg += `📝 <b>Full Announcement Text:</b>\n<i>${escapeHtml(previewContent)}</i>\n`;
  } else if (!attachments.length) {
    msg += `<i>No additional description was written in the post body.</i>\n`;
  }

  return msg;
}

/**
 * Searches and retrieves detailed post information and attachments from knowledge_base
 */
export async function getDetailedPostInformation(query: string, course?: string): Promise<string> {
  const supabase = getSupabaseAdmin();

  // 1. Try finding by exact external_id
  let { data: items } = await supabase
    .from('knowledge_base')
    .select('*')
    .eq('external_id', query)
    .limit(1);

  // 2. If not found by external_id, search by title or content
  if (!items || items.length === 0) {
    let q = supabase
      .from('knowledge_base')
      .select('*')
      .or(`title.ilike.%${query}%,content.ilike.%${query}%`);

    if (course) {
      q = q.ilike('course', `%${course.split(' ')[0]}%`);
    }

    const res = await q.order('created_at', { ascending: false }).limit(2);
    items = res.data;
  }

  // 3. Fallback: search anywhere in title or content without course filter
  if (!items || items.length === 0) {
    const { data: fallbackItems } = await supabase
      .from('knowledge_base')
      .select('*')
      .or(`title.ilike.%${query}%,content.ilike.%${query}%`)
      .order('created_at', { ascending: false })
      .limit(2);
    items = fallbackItems;
  }

  if (!items || items.length === 0) {
    return `🔍 <b>No details found matching:</b> "${escapeHtml(query)}".\n\n<i>Try typing <code>/classroom</code> to see the latest list of posts!</i>`;
  }

  return items.map(formatKnowledgeBaseItemDetails).join('\n───────────────\n\n');
}

/**
 * Resolves an ordinal reference like "1", "what was in 1", "#2" against the previous assistant message.
 */
export async function resolveOrdinalReference(
  text: string,
  chatId: string
): Promise<string | null> {
  const ordinalMatch = text.match(
    /^(?:what(?:'?s| was)? in|tell me (?:more )?(?:about|in)|show(?: me)?(?: details of)?|details of|expand on|about|info on|view)?\s*(?:item|announcement|post|assignment|task|#)?\s*([1-9])(?:\b|\?|$)/i
  );
  if (!ordinalMatch) return null;

  const targetIdx = parseInt(ordinalMatch[1], 10);
  const supabase = getSupabaseAdmin();

  const { data: lastMsgs } = await supabase
    .from('chat_messages')
    .select('content')
    .eq('chat_id', chatId)
    .eq('role', 'assistant')
    .order('created_at', { ascending: false })
    .limit(3);

  if (!lastMsgs || lastMsgs.length === 0) return null;

  for (const m of lastMsgs) {
    const content = m.content || '';

    // Check for Classroom posts list
    if (content.includes('Google Classroom Posts') || content.includes('[ANNOUNCEMENT]') || content.includes('[ASSIGNMENT]')) {
      const itemRegex = new RegExp(
        `(?:^|\\n)${targetIdx}\\.\\s*\\[(ANNOUNCEMENT|ASSIGNMENT)\\]\\s*(?:<b>)?([^\\n<]+)(?:<\\/b>)?([\\s\\S]*?)(?=(?:\\n\\d+\\.\\s*\\[)|$)`,
        'i'
      );
      const match = content.match(itemRegex);
      if (match) {
        const course = match[2].trim();
        const bodyBlock = match[3];

        const titleMatch = bodyBlock.match(/📌\s*(?:<b>)?([^<\n]+)(?:<\/b>)?/i);
        const textMatch = bodyBlock.match(/💬\s*([^\n]+)/i);
        const attMatch = bodyBlock.match(/<code>([^<]+)<\/code>/i);

        const candidateTitle = (titleMatch ? titleMatch[1] : (textMatch ? textMatch[1] : '')).trim();
        const candidateAtt = attMatch ? attMatch[1].trim() : '';

        // Query knowledge_base for this item
        let kbQuery = supabase
          .from('knowledge_base')
          .select('*')
          .ilike('course', `%${course.split(' ')[0]}%`);

        if (candidateTitle && candidateTitle !== '(No text)') {
          kbQuery = kbQuery.or(`title.ilike.%${candidateTitle}%,content.ilike.%${candidateTitle}%`);
        } else if (candidateAtt) {
          kbQuery = kbQuery.or(`title.ilike.%${candidateAtt}%,content.ilike.%${candidateAtt}%`);
        }

        const { data: kbResults } = await kbQuery.order('created_at', { ascending: false }).limit(1);
        if (kbResults && kbResults.length > 0) {
          return formatKnowledgeBaseItemDetails(kbResults[0]);
        }

        if (candidateTitle && candidateTitle !== '(No text)') {
          const { data: globalKb } = await supabase
            .from('knowledge_base')
            .select('*')
            .or(`title.ilike.%${candidateTitle}%,content.ilike.%${candidateTitle}%`)
            .order('created_at', { ascending: false })
            .limit(1);

          if (globalKb && globalKb.length > 0) {
            return formatKnowledgeBaseItemDetails(globalKb[0]);
          }
        }

        return `📌 <b>Item #${targetIdx} from Google Classroom</b>\n\n` +
          `📚 <b>Course:</b> ${escapeHtml(course)}\n` +
          `${bodyBlock.trim()}`;
      }
    }

    // Check for Active Academic Tasks list
    if (content.includes('Active Academic Tasks') || content.includes('Current Active Tasks')) {
      const taskRegex = new RegExp(
        `(?:^|\\n)${targetIdx}\\.\\s*(?:<b>)?([^<\\n]+)(?:<\\/b>)?[\\s\\S]*?🆔\\s*<code>([0-9a-f-]+)<\\/code>`,
        'i'
      );
      const match = content.match(taskRegex);
      if (match) {
        const taskId = match[2];
        const { data: task } = await supabase
          .from('tasks')
          .select('*')
          .eq('id', taskId)
          .maybeSingle();

        if (task) {
          const { data: delivs } = await supabase
            .from('deliverables')
            .select('*')
            .eq('task_id', task.id);

          let dMsg = `📌 <b>Task Details (#${targetIdx}):</b> ${escapeHtml(task.title)}\n\n` +
            `📚 <b>Course:</b> ${escapeHtml(task.course || 'General')}\n` +
            `🏷️ <b>Type:</b> <code>${task.task_type}</code>\n` +
            `📊 <b>Status:</b> <code>${task.status.toUpperCase()}</code>\n` +
            `⏰ <b>Due:</b> ${task.due_date ? new Date(task.due_date).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A'}\n\n`;

          if (task.result_summary) {
            dMsg += `📝 <b>Summary:</b> ${escapeHtml(task.result_summary)}\n\n`;
          }

          if (delivs && delivs.length > 0) {
            dMsg += `📁 <b>Deliverables:</b>\n`;
            delivs.forEach((d: any) => {
              if (d.drive_link) {
                dMsg += `• <a href="${d.drive_link}">${escapeHtml(d.file_name)}</a>\n`;
              } else {
                dMsg += `• <code>${escapeHtml(d.file_name)}</code>\n`;
              }
            });
          }

          return dMsg;
        }
      }
    }
  }

  return null;
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
 * Date Range Extractor: Parses human-typed dates into ISO date ranges.
 * Supports: "Sep 1", "1st September", "01/09", "yesterday", "today", "Sep 3", etc.
 */
export function extractDateRange(query: string): { start: string; end: string; label: string } | null {
  const q = query.toLowerCase();
  const months: Record<string, number> = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
    may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
    september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  };

  // 1. "today"
  if (/\btoday\b/i.test(q)) {
    const now = new Date();
    const y = now.getFullYear();
    const m = (now.getMonth() + 1).toString().padStart(2, '0');
    const d = now.getDate().toString().padStart(2, '0');
    return {
      start: `${y}-${m}-${d}T00:00:00.000Z`,
      end: `${y}-${m}-${d}T23:59:59.999Z`,
      label: `Today (${y}-${m}-${d})`
    };
  }

  // 2. "yesterday"
  if (/\byesterday\b/i.test(q)) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return {
      start: `${y}-${m}-${day}T00:00:00.000Z`,
      end: `${y}-${m}-${day}T23:59:59.999Z`,
      label: `Yesterday (${y}-${m}-${day})`
    };
  }

  // 3. Month Day: "Sep 1", "Sept 1st", "September 1", "Sep 01", "1 Sep", "1st September"
  const monthNames = Object.keys(months).join('|');
  const matchA = q.match(new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i'));
  const matchB = q.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthNames})\\b`, 'i'));

  let monthNum: number | null = null;
  let dayNum: number | null = null;

  if (matchA) {
    monthNum = months[matchA[1].toLowerCase()];
    dayNum = parseInt(matchA[2], 10);
  } else if (matchB) {
    monthNum = months[matchB[2].toLowerCase()];
    dayNum = parseInt(matchB[1], 10);
  }

  const matchC = q.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (!monthNum && matchC) {
    dayNum = parseInt(matchC[1], 10);
    monthNum = parseInt(matchC[2], 10);
  }

  if (monthNum && dayNum && dayNum >= 1 && dayNum <= 31) {
    const year = 2026;
    const mStr = monthNum.toString().padStart(2, '0');
    const dStr = dayNum.toString().padStart(2, '0');
    return {
      start: `${year}-${mStr}-${dStr}T00:00:00.000Z`,
      end: `${year}-${mStr}-${dStr}T23:59:59.999Z`,
      label: `${year}-${mStr}-${dStr}`
    };
  }

  return null;
}

/**
 * Intelligent Academic RAG Retriever: Searches the Supabase knowledge base for any student inquiry
 * using temporal date filtering, full-text phrase matching, and vector semantic similarity.
 */
export async function retrieveRelevantKnowledge(userQuery: string, limit: number = 8): Promise<any[]> {
  const supabase = getSupabaseAdmin();
  const results: any[] = [];
  const seenIds = new Set<string>();

  // 1. DATE-BASED TIMELINE RETRIEVAL:
  // If the user specifies or asks about a date (e.g. "Sep 1", "September 1", "today", "yesterday", "Sep 3")
  const dateRange = extractDateRange(userQuery);
  if (dateRange) {
    const { data: dateItems } = await supabase
      .from('knowledge_base')
      .select('id, title, course, content, metadata, posted_date, created_at')
      .gte('posted_date', dateRange.start)
      .lte('posted_date', dateRange.end)
      .order('posted_date', { ascending: false })
      .limit(15);

    // Prioritize direct classroom announcements and materials over duplicate email summaries
    const primaryItems = (dateItems || []).filter(item => 
      item.title.startsWith('Announcement:') || item.title.startsWith('New material:') || !item.title.startsWith('New announcement:')
    );
    const itemsToUse = primaryItems.length > 0 ? primaryItems : (dateItems || []);

    itemsToUse.forEach(item => {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        results.push(item);
      }
    });

    if (results.length > 0) {
      return results;
    }
  }

  // 2. GENERAL ANNOUNCEMENT / FEED QUERY:
  // If user asks for "announcements", "notices", "messages", "classroom updates" without a date
  if (/announc|notice|message|feed|update|post|new in class/i.test(userQuery)) {
    const { data: recentAnnouncements } = await supabase
      .from('knowledge_base')
      .select('id, title, course, content, metadata, posted_date, created_at')
      .ilike('title', 'Announcement:%')
      .order('posted_date', { ascending: false })
      .limit(limit);

    (recentAnnouncements || []).forEach(item => {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        results.push(item);
      }
    });
  }

  // 3. TYPO NORMALIZATION & PHRASE MATCHING:
  const cleanQuery = userQuery
    .replace(/annn+coument|annoucement|announcment/gi, 'announcement')
    .replace(/[?!.,;:"'()\[\]{}]/g, ' ')
    .trim();

  if (cleanQuery.length > 2) {
    const { data: phraseMatches } = await supabase
      .from('knowledge_base')
      .select('id, title, course, content, metadata, posted_date, created_at')
      .or(`title.ilike.%${cleanQuery}%,content.ilike.%${cleanQuery}%`)
      .order('posted_date', { ascending: false })
      .limit(limit);

    (phraseMatches || []).forEach(item => {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        results.push(item);
      }
    });
  }

  // 4. MEETING & REGISTRATION WORDS:
  if (/lecture|invite|join|session|zoom|meet|class|link|schedule|exam/i.test(userQuery)) {
    const { data: meetingPosts } = await supabase
      .from('knowledge_base')
      .select('id, title, course, content, metadata, posted_date, created_at')
      .or('content.ilike.%zoom.us%,content.ilike.%meet.google.com%,content.ilike.%forms.gle%')
      .order('posted_date', { ascending: false })
      .limit(limit);

    (meetingPosts || []).forEach(item => {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        results.push(item);
      }
    });
  }

  // 5. INDIVIDUAL SIGNIFICANT KEYWORDS (2+ characters to include course codes and short tokens):
  const stopWords = new Set(['the', 'this', 'that', 'with', 'from', 'done', 'been', 'tell', 'show', 'give', 'what', 'which', 'about', 'more', 'here', 'there', 'have', 'were', 'will']);
  const words = cleanQuery
    .split(/\s+/)
    .filter(w => w.length >= 2 && !stopWords.has(w.toLowerCase()));

  if (words.length > 0 && results.length < limit) {
    const orFilters = words.slice(0, 4).map(w => `title.ilike.%${w}%,content.ilike.%${w}%`).join(',');
    const { data: wordMatches } = await supabase
      .from('knowledge_base')
      .select('id, title, course, content, metadata, posted_date, created_at')
      .or(orFilters)
      .order('posted_date', { ascending: false })
      .limit(limit - results.length);

    (wordMatches || []).forEach(item => {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        results.push(item);
      }
    });
  }

  // 6. SEMANTIC VECTOR EMBEDDING SEARCH:
  // If fewer than 2 results found, query pgvector with semantic embeddings
  if (results.length < 2) {
    try {
      const { queryKnowledgeBase } = await import('./vector');
      const vectorMatches = await queryKnowledgeBase(userQuery, null, limit);
      (vectorMatches || []).forEach((item: any) => {
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id);
          results.push(item);
        }
      });
    } catch (ve) {
      console.warn('[RAG] Vector similarity search fallback error:', ve);
    }
  }

  return results;
}

/**
 * Intelligent Academic AI Assistant Chat on Telegram powered by LangGraph StateGraph
 */
export async function askAiAssistant(userPrompt: string, chatId: string): Promise<string> {
  const supabase = getSupabaseAdmin();
  
  // Save user's incoming message to history
  await supabase.from('chat_messages').insert({
    chat_id: chatId,
    role: 'user',
    content: userPrompt
  });

  try {
    const { runAcademicAgentGraph } = await import('./graph');
    const reply = await runAcademicAgentGraph(userPrompt, chatId);
    return reply;
  } catch (err: any) {
    console.error('LangGraph agent error:', err);
    return `❌ AI service error: ${escapeHtml(err.message)}`;
  }
}


/**
 * Phase 2A: Row 6 - Telegram Voice & Audio Notes
 * Primary: Groq Whisper (whisper-large-v3-turbo)
 * Fallback 1: OpenAI Whisper (whisper-1)
 * Fallback 2 / 3: Plain text notification asking user to type
 * Trigger: Audio transcription timeout (>15s) or API error
 */
async function transcribeVoiceMessage(fileId: string): Promise<string> {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const groqKey = process.env.GROQ_API_KEY;
  const openAiKey = process.env.OPENAI_API_KEY;

  try {
    // Step 1: Get file path from Telegram
    const fileRes = await fetch(`${TELEGRAM_API_BASE}${token}/getFile?file_id=${fileId}`);
    if (!fileRes.ok) throw new Error('Failed to get file info from Telegram');
    const fileData = await fileRes.json();
    const filePath = fileData.result?.file_path;
    if (!filePath) throw new Error('No file_path in Telegram response');

    // Step 2: Download voice file
    const audioUrl = `${TELEGRAM_FILE_BASE}${token}/${filePath}`;
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) throw new Error('Failed to download voice file');
    const audioBuffer = await audioRes.arrayBuffer();

    // Step 3: Primary Model: Groq Whisper (whisper-large-v3-turbo)
    if (groqKey) {
      try {
        const formData = new FormData();
        const audioBlob = new Blob([audioBuffer], { type: 'audio/ogg' });
        formData.append('file', audioBlob, 'voice.ogg');
        formData.append('model', 'whisper-large-v3-turbo');
        formData.append('language', 'en');

        const groqRes = await fetch(GROQ_WHISPER_URL, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${groqKey}` },
          body: formData,
          signal: AbortSignal.timeout(15000),
        });

        if (groqRes.ok) {
          const groqData = await groqRes.json();
          const text = (groqData.text || '').trim();
          if (text) {
            console.log('[Whisper:Primary] Successfully transcribed voice note via Groq whisper-large-v3-turbo.');
            return text;
          }
        } else {
          console.warn(`[Whisper:Primary] Groq Whisper failed (${groqRes.status}). Triggering Fallback 1 (OpenAI Whisper)...`);
        }
      } catch (groqErr: any) {
        console.warn(`[Whisper:Primary] Groq Whisper error (${groqErr?.message || groqErr}). Triggering Fallback 1...`);
      }
    }

    // Step 4: Fallback 1: OpenAI Whisper (whisper-1)
    if (openAiKey) {
      try {
        const formData = new FormData();
        const audioBlob = new Blob([audioBuffer], { type: 'audio/ogg' });
        formData.append('file', audioBlob, 'voice.ogg');
        formData.append('model', 'whisper-1');
        formData.append('language', 'en');

        const whisperRes = await fetch(OPENAI_WHISPER_URL, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${openAiKey}` },
          body: formData,
          signal: AbortSignal.timeout(15000),
        });

        if (whisperRes.ok) {
          const whisperData = await whisperRes.json();
          const text = (whisperData.text || '').trim();
          if (text) {
            console.log('[Whisper:Fallback 1] Successfully transcribed voice note via OpenAI whisper-1.');
            return text;
          }
        } else {
          console.warn(`[Whisper:Fallback 1] OpenAI Whisper failed (${whisperRes.status}). Triggering Fallback 2/3...`);
        }
      } catch (openAiErr: any) {
        console.warn(`[Whisper:Fallback 1] OpenAI Whisper error (${openAiErr?.message || openAiErr}). Triggering Fallback 2/3...`);
      }
    }

    // Step 5: Fallback 2 / 3: Plain text notification asking user to type
    console.warn('[Whisper:Fallback 2/3] Audio transcription timed out (>15s) or API error across providers.');
    return '[Voice message received — transcription unavailable. Please type your request.]';
  } catch (err: any) {
    console.error('[Whisper] Overall voice processing error:', err?.message || err);
    return '[Voice message received — transcription unavailable. Please type your request.]';
  }
}


/**
 * Phase 2B: Row 5 - Document & PDF Text Ingestion
 * Primary: Fast-path Local Extraction (pypdf / pdf-parse)
 * Fallback 1: Gemini Multimodal (gemini-2.0-flash -> gemini-1.5-flash -> gemini-1.5-pro)
 * Fallback 2 / 3: OpenRouter Vision (gemma-3-27b-it -> qwen-2.5-vl-72b)
 * Trigger: Scanned document / missing text stream in PDF (< 50 chars)
 */
async function extractTaskFromImage(fileId: string, mimeType?: string): Promise<string> {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) return '';

  try {
    // Step 1: Get file download URL
    const fileRes = await fetch(`${TELEGRAM_API_BASE}${token}/getFile?file_id=${fileId}`);
    const fileData = await fileRes.json();
    const filePath = fileData.result?.file_path;
    if (!filePath) return '';
    const fileUrl = `${TELEGRAM_FILE_BASE}${token}/${filePath}`;

    const isPdf = mimeType === 'application/pdf' || filePath.toLowerCase().endsWith('.pdf');

    if (isPdf) {
      try {
        const pdfRes = await fetch(fileUrl);
        if (pdfRes.ok) {
          const arrayBuf = await pdfRes.arrayBuffer();
          const buf = Buffer.from(arrayBuf);
          
          // Primary Model: Fast-path Local Extraction (pdf-parse)
          try {
            const { extractPdfText } = await import('./vector');
            const pdfText = await extractPdfText(buf);
            if (pdfText && pdfText.trim().length >= 50) {
              console.log(`[Document:Primary] Successfully extracted ${pdfText.length} characters via local pdf-parse.`);
              return pdfText.trim();
            }
          } catch (fastErr) {
            console.warn('[Document] Fast-path pdf-parse failed, triggering Fallback 1 (Gemini Multimodal):', fastErr);
          }

          // Fallback Trigger Condition: Scanned document / missing text stream in PDF (< 50 chars)
          console.log('[Document] Trigger condition met (low/empty text stream). Initiating Fallback 1 (Gemini Multimodal)...');

          // Fallback 1: Gemini Multimodal (gemini-2.0-flash -> gemini-1.5-flash -> gemini-1.5-pro)
          const geminiKey = process.env.GEMINI_API_KEY;
          if (geminiKey) {
            try {
              const { GoogleGenerativeAI } = await import('@google/generative-ai');
              const genAI = new GoogleGenerativeAI(geminiKey);
              for (const modelName of ['gemini-3.6-flash', 'gemini-flash-latest']) {
                try {
                  const model = genAI.getGenerativeModel({ model: modelName });
                  const aiRes = await model.generateContent([
                    {
                      inlineData: {
                        mimeType: 'application/pdf',
                        data: buf.toString('base64'),
                      },
                    },
                    {
                      text: 'Extract ALL assignment requirements, course title, due date, submission links, constraints, and all specific tasks from this PDF document verbatim. Return the complete, unabridged assignment text with all questions, instructions, and constraints.',
                    },
                  ]);
                  const text = aiRes?.response?.text();
                  if (text && text.trim().length >= 30) {
                    console.log(`[Document:Fallback 1] Successfully extracted text via Gemini Multimodal (${modelName}).`);
                    return text.trim();
                  }
                } catch (mErr) {
                  console.warn(`[Document:Fallback 1] Gemini ${modelName} failed:`, mErr);
                }
              }
            } catch (geminiErr) {
              console.warn('[Document:Fallback 1] Gemini Multimodal error:', geminiErr);
            }
          }

          // Fallback 2 / 3: OpenRouter Vision (gemma-3-27b-it -> qwen-2.5-vl-72b)
          const openRouterKey = process.env.OPENROUTER_API_KEY;
          if (openRouterKey) {
            const visionModels = ['google/gemma-3-27b-it', 'qwen/qwen-2.5-vl-72b-instruct:free', 'qwen/qwen-2.5-vl-72b-instruct'];
            const b64Pdf = buf.toString('base64');
            for (const vModel of visionModels) {
              try {
                const visionRes = await fetch(OPENROUTER_API_URL, {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${openRouterKey}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    model: vModel,
                    messages: [{
                      role: 'user',
                      content: [
                        { type: 'image_url', image_url: { url: `data:application/pdf;base64,${b64Pdf}` } },
                        { type: 'text', text: 'Extract all assignment requirements, instructions, and questions from this document verbatim.' },
                      ],
                    }],
                    temperature: 0.1,
                  }),
                });
                if (visionRes.ok) {
                  const visionData = await visionRes.json();
                  const content = visionData.choices?.[0]?.message?.content;
                  if (content && content.trim().length >= 30) {
                    console.log(`[Document:Fallback 2/3] Successfully extracted text via OpenRouter Vision (${vModel}).`);
                    return content.trim();
                  }
                }
              } catch (vErr) {
                console.warn(`[Document:Fallback 2/3] OpenRouter Vision ${vModel} error:`, vErr);
              }
            }
          }
        }
      } catch (pdfErr) {
        console.warn('[Document] Error reading PDF file:', pdfErr);
      }
      return '';
    }

    // Photo / Image Ingestion
    // Fallback 1: Gemini Multimodal (gemini-2.0-flash -> gemini-1.5-flash -> gemini-1.5-pro)
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      try {
        const imgRes = await fetch(fileUrl);
        if (imgRes.ok) {
          const imgBuf = Buffer.from(await imgRes.arrayBuffer());
          const { GoogleGenerativeAI } = await import('@google/generative-ai');
          const genAI = new GoogleGenerativeAI(geminiKey);
          for (const modelName of ['gemini-3.6-flash', 'gemini-flash-latest']) {
            try {
              const model = genAI.getGenerativeModel({ model: modelName });
              const aiRes = await model.generateContent([
                {
                  inlineData: {
                    mimeType: mimeType || 'image/jpeg',
                    data: imgBuf.toString('base64'),
                  },
                },
                {
                  text: 'Extract all assignment requirements, course title, due date, submission links, constraints, and all specific tasks from this image verbatim.',
                },
              ]);
              const text = aiRes?.response?.text();
              if (text && text.trim().length >= 20) {
                console.log(`[Vision:Fallback 1] Successfully extracted text via Gemini Multimodal (${modelName}).`);
                return text.trim();
              }
            } catch (mErr) {
              console.warn(`[Vision:Fallback 1] Gemini ${modelName} failed:`, mErr);
            }
          }
        }
      } catch (gemErr) {
        console.warn('[Vision:Fallback 1] Gemini extraction error:', gemErr);
      }
    }

    // Fallback 2 / 3: OpenRouter Vision (gemma-3-27b-it -> qwen-2.5-vl-72b)
    const openRouterKey = process.env.OPENROUTER_API_KEY;
    if (openRouterKey) {
      const visionModels = [
        'google/gemma-3-27b-it',
        'qwen/qwen-2.5-vl-72b-instruct:free',
        'qwen/qwen-2.5-vl-72b-instruct',
      ];

      for (const visionModel of visionModels) {
        try {
          const visionRes = await fetch(OPENROUTER_API_URL, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openRouterKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: visionModel,
              messages: [
                {
                  role: 'user',
                  content: [
                    { type: 'image_url', image_url: { url: fileUrl } },
                    { type: 'text', text: 'Extract all assignment requirements from this image. Return as plain text.' },
                  ],
                },
              ],
              temperature: 0.1,
            }),
          });

          if (visionRes.ok) {
            const visionData = await visionRes.json();
            const content = visionData.choices?.[0]?.message?.content;
            if (content && content.trim().length > 10) {
              console.log(`[Vision:Fallback 2/3] Successfully extracted text via OpenRouter Vision (${visionModel}).`);
              return content.trim();
            }
          }
        } catch (vErr) {
          console.warn(`[Vision:Fallback 2/3] Model ${visionModel} error:`, vErr);
        }
      }
    }
    return '';
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
    
    // Phase 2B: PDF extraction
    if (doc.mime_type === 'application/pdf' || (doc.file_name && doc.file_name.toLowerCase().endsWith('.pdf'))) {
      await reply('📄 <i>PDF received — extracting assignment requirements...</i>');
      const attachmentMeta = {
        file_id: doc.file_id,
        file_name: doc.file_name,
        file_size: doc.file_size,
        mime_type: doc.mime_type,
      };
      const extracted = await extractTaskFromImage(doc.file_id, 'application/pdf');
      if (extracted && extracted.trim().length > 20) {
        const prompt = `Assignment from PDF "${doc.file_name || 'document'}": ${caption}\n\n=== VERBATIM EXTRACTED PDF CONTENT ===\n${extracted}`;
        await reply(`📋 <b>Extracted from PDF:</b>\n${escapeHtml(extracted.slice(0, 400))}...\n\n<i>Creating task...</i>`);
        try {
          const confirmation = await createTaskFromTelegram(prompt, attachmentMeta);
          await reply(confirmation);
        } catch (taskErr: any) {
          const aiResponse = await askAiAssistant(prompt, incomingChatId);
          await reply(aiResponse);
        }
      } else {
        const prompt = `Attached PDF: ${doc.file_name || 'document'}\nInstructions: ${caption}\n[NOTE: Full PDF text will be extracted automatically by LangGraph worker from workspace/Telegram.]`;
        try {
          const confirmation = await createTaskFromTelegram(prompt, attachmentMeta);
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
  // 2. Reply-to-fix: user is replying to a task alert, completed message, or flagged alert with an instruction.
  // Runs BEFORE the pending-question handler so fix instructions are never captured as question answers.
  const fixReplyTo = update.message?.reply_to_message;
  if (fixReplyTo?.text && text && !text.startsWith('/')) {
    const uuidMatch = fixReplyTo.text.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    const looksLikeFlag = fixReplyTo.text.includes('⚠️')
      || fixReplyTo.text.includes('Review Required')
      || /couldn.?t finish|what went wrong|what i already tried|flagged|review required|auto-delivered/i.test(fixReplyTo.text);
    const looksLikeCompleted = /Task Completed:|Deliverables:|Google Drive/i.test(fixReplyTo.text);
    const looksLikeInstruction = text.length > 10 && /\b(?:add|append|fix|change|update|remove|include|more|slides?|section|page|modify|redo|rebuild|retry|extend|insert|adjust)\b/i.test(text);

    let targetTaskId: string | null = null;
    let targetTaskTitle: string | null = null;

    if (uuidMatch) {
      targetTaskId = uuidMatch[1];
    } else if (looksLikeCompleted || looksLikeFlag || looksLikeInstruction) {
      // Try to extract title from message like "Task Completed: <Title>" or "Title: <Title>"
      const titleMatch = fixReplyTo.text.match(/(?:Task Completed:|📌 Title:|Title:)\s*([^\n\r]+)/i);
      if (titleMatch && titleMatch[1]) {
        const queryTitle = titleMatch[1].replace(/<\/?[^>]+(>|$)/g, '').trim();
        const { data: matchedTask } = await supabase
          .from('tasks')
          .select('id, title, status')
          .ilike('title', `%${queryTitle.slice(0, 30)}%`)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (matchedTask) {
          targetTaskId = matchedTask.id;
          targetTaskTitle = matchedTask.title;
        }
      }
      // If still not found, pick the most recent task if the user message clearly looks like an instruction
      if (!targetTaskId && looksLikeInstruction) {
        const { data: latestTask } = await supabase
          .from('tasks')
          .select('id, title, status')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (latestTask) {
          targetTaskId = latestTask.id;
          targetTaskTitle = latestTask.title;
        }
      }
    }

    if (targetTaskId && (looksLikeFlag || looksLikeCompleted || looksLikeInstruction)) {
      const { data: targetTask } = await supabase
        .from('tasks')
        .select('id, title, status')
        .eq('id', targetTaskId)
        .maybeSingle();
      if (targetTask) {
        await reply(`🔧 <i>Understood — applying your instruction to "<b>${escapeHtml(targetTask.title)}</b>" and rebuilding...</i>`);
        const fixMsg = await applyFixAndRequeue(targetTaskId, text);
        await reply(fixMsg);
        return { handled: true, responseText: 'Fix applied and task re-queued via reply' };
      }
    }
  }

  // 2a-natural: Direct natural language task creation request (e.g. "Make a ppt on...", "Create a presentation about...", "Build me a deck for...")
  // Evaluated BEFORE free-text fix fallback (2b) so user requests for new deliverables are never hijacked as fixes to older failed tasks!
  const isNaturalLanguageTaskCreation = (() => {
    if (!text || text.startsWith('/') || fixReplyTo) return false;
    const clean = text.trim();
    // Guard: instructions like "make it 8 slides", "change it to dark", "update it" are modifications, not new creations
    if (/^(?:please\s+)?(?:make|change|turn|update|set|switch)\s+it\b/i.test(clean)) return false;

    // Pattern 1: Action verb + deliverable type (e.g., "Make a ppt on...", "Create a presentation about...", "Build a report on...")
    const verbNounPattern = /^(?:please\s+)?(?:make|create|build|generate|write|prepare|develop|code|design|draft)\s+(?:me\s+)?(?:a\s+|an\s+)?(?:\d+[\s-]*(?:slide|page|part)\s+)?(?:new\s+)?(?:ppt|presentation|powerpoint|deck|slides?|report|paper|project|doc|docx|document|notebook|app|script|calculator|assignment)\b/i;

    // Pattern 2: Action verb + topic preposition (e.g., "make a ppt about...", "create slides for...", "build something on...")
    const verbTopicPattern = /^(?:please\s+)?(?:make|create|prepare|generate|build|draft)\s+(?:me\s+)?(?:a\s+|an\s+)?.*?\b(?:on|about|for|regarding)\b/i;

    // Pattern 3: Deliverable type leading (e.g., "ppt on mobile gaming...", "presentation on AI...", "10 slide deck about...")
    const nounLeadingPattern = /^(?:(?:\d+[\s-]*(?:slide|page)\s+)?(?:ppt|presentation|deck|slides?|report|paper|project|document))\s+(?:on|about|for|regarding)\s+/i;

    return verbNounPattern.test(clean) || verbTopicPattern.test(clean) || nounLeadingPattern.test(clean);
  })();

  if (isNaturalLanguageTaskCreation) {
    try {
      await reply('⏳ <i>Analyzing requirements and creating task...</i>');
      const confirmation = await createTaskFromTelegram(text);
      await reply(confirmation);
    } catch (e: any) {
      await reply(`❌ Failed to create task: ${escapeHtml(e.message)}`);
    }
    return { handled: true, responseText: 'Task created from natural language prompt' };
  }

  // 2b. Free-text fallback: user typed an instruction WITHOUT using the Telegram "Reply" button.
  // We apply the instruction to whichever task is currently flagged/failed, or the most recent task
  // if the instruction clearly asks to extend/modify deliverables.
  if (text && !text.startsWith('/') && !fixReplyTo) {
    // Note: removed 'make' and 'create' so creation requests are never treated as fix instructions!
    const looksLikeInstruction = text.length > 15 && /\b(?:add|fix|change|update|remove|include|append|more|redo|rebuild|retry|modify|adjust)\b/i.test(text);
    if (looksLikeInstruction) {
      // First check flagged/failed tasks — MUST have been updated within the last 2 hours
      // to avoid hijacking stale tasks that failed days/weeks ago!
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const { data: activeFlaggedTask } = await supabase
        .from('tasks')
        .select('id, title, status')
        .in('status', ['flagged', 'failed'])
        .gt('updated_at', twoHoursAgo)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      const targetTask = activeFlaggedTask || (await (async () => {
        // If append/extend slides or sections is requested, grab the most recent task (within 24 hours)
        if (/\b(?:add|append|more|additional|extra)\b.{0,30}\b(?:slide|slides|page|section)\b/i.test(text)) {
          const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          const { data: recentTask } = await supabase
            .from('tasks')
            .select('id, title, status')
            .gt('updated_at', oneDayAgo)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          return recentTask;
        }
        return null;
      })());

      if (targetTask) {
        await reply(`🔧 <i>Applying your instruction to "<b>${escapeHtml(targetTask.title)}</b>" and rebuilding...</i>`);
        const fixMsg = await applyFixAndRequeue(targetTask.id, text);
        await reply(fixMsg);
        return { handled: true, responseText: 'Fix applied to task via free-text' };
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
        const res = await fetch(OPENROUTER_API_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openRouterKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: OPENROUTER_MODEL,
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

  // 3-ordinal. Check if user is referencing an item number from a recent list (e.g., "what was in 1", "tell me about 1", "details of #2")
  const resolvedOrdinal = await resolveOrdinalReference(text, incomingChatId);
  if (resolvedOrdinal) {
    await reply(resolvedOrdinal);
    await supabase.from('chat_messages').insert([
      { chat_id: incomingChatId, role: 'user', content: text },
      { chat_id: incomingChatId, role: 'assistant', content: resolvedOrdinal },
    ]);
    return { handled: true };
  }

  // 3-topic. Direct Event / Topic Inquiry (e.g. "tell me more in TEDxSilverOakUniversity", "tell me more about Kalpvruksh")
  const moreAboutMatch = text.match(/^(?:tell me (?:more )?(?:about|in)|details (?:of|about|on)|show(?: me)? (?:details of|about|more about)?|what is (?:the )?(?:details of|info on)?)\s+(.+)/i);
  if (moreAboutMatch) {
    const topic = moreAboutMatch[1].trim();
    if (!/^[1-9]$/.test(topic)) {
      const details = await getDetailedPostInformation(topic);
      if (details && !details.startsWith('🔍 <b>No details found')) {
        await reply(details);
        await supabase.from('chat_messages').insert([
          { chat_id: incomingChatId, role: 'user', content: text },
          { chat_id: incomingChatId, role: 'assistant', content: details },
        ]);
        return { handled: true };
      }
    }
  }

  // 3-link. Direct Link / Registration Inquiry (e.g. "give me link to register", "what is the link", "registration link")
  const isLinkInquiry = /^(?:give me|show me|send me|what is|where is)?\s*(?:the\s*)?(?:registration\s*link|register\s*link|ticket\s*link|tickets\s*link|form\s*link|registration\s*url|link\s*to\s*register|link\s*for\s*registration|links?\b)/i.test(text);
  if (isLinkInquiry) {
    const { data: recentMsgs } = await supabase
      .from('chat_messages')
      .select('content')
      .eq('chat_id', incomingChatId)
      .eq('role', 'assistant')
      .order('created_at', { ascending: false })
      .limit(3);

    let eventQuery = '';
    for (const rm of recentMsgs || []) {
      const c = rm.content || '';
      if (/tedx/i.test(c)) { eventQuery = 'TEDx'; break; }
      if (/kalpvruksh/i.test(c)) { eventQuery = 'KALPVRUKSH'; break; }
      if (/hackathon/i.test(c)) { eventQuery = 'Hackathon'; break; }
      if (/model-2/i.test(c)) { eventQuery = 'MODEL-2'; break; }
      if (/entangle/i.test(c)) { eventQuery = 'Entangle'; break; }
    }

    if (eventQuery) {
      const details = await getDetailedPostInformation(eventQuery);
      if (details && !details.startsWith('🔍 <b>No details found')) {
        await reply(details);
        await supabase.from('chat_messages').insert([
          { chat_id: incomingChatId, role: 'user', content: text },
          { chat_id: incomingChatId, role: 'assistant', content: details },
        ]);
        return { handled: true };
      }
    }
  }

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

  // 3. Create Task Command: /task, /new, /add, /create (or /task <uuid> to view task details)
  if (
    lower.startsWith('/task') ||
    lower.startsWith('/new') ||
    lower.startsWith('/add') ||
    lower.startsWith('/create')
  ) {
    const prompt = text.replace(/^\/(task|new|add|create)\s*/i, '').trim();
    if (!prompt) {
      await reply(
        `📝 <b>How to create or view a task:</b>\n\n` +
        `• <b>Create:</b> <code>/task &lt;your assignment details&gt;</code>\n` +
        `• <b>View Task:</b> <code>/task &lt;task_id&gt;</code>\n\n` +
        `<b>Examples:</b>\n` +
        `• <code>/task CE-401 Machine Learning: 5-page lab report on Adam vs SGD with loss curves due Friday</code>\n` +
        `• <code>/task CE-502 Cloud: 10-slide presentation deck on Kubernetes Pod lifecycle</code>`
      );
      return { handled: true };
    }

    // Check if the argument is an existing Task ID or UUID
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(prompt);
    if (isUuid) {
      const { data: task } = await supabase
        .from('tasks')
        .select('*')
        .eq('id', prompt)
        .maybeSingle();

      if (task) {
        const dueFormatted = task.due_date
          ? new Date(task.due_date).toLocaleString('en-IN', {
              timeZone: 'Asia/Kolkata',
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'No deadline';

        const { data: delivs } = await supabase
          .from('deliverables')
          .select('*')
          .eq('task_id', task.id);

        let dMsg = `📌 <b>Task Details:</b> ${escapeHtml(task.title)}\n\n` +
          `📚 <b>Course:</b> ${escapeHtml(task.course || 'General')}\n` +
          `🏷️ <b>Type:</b> <code>${task.task_type}</code>\n` +
          `📊 <b>Status:</b> <code>${task.status.toUpperCase()}</code>\n` +
          `⏰ <b>Due Date:</b> ${dueFormatted}\n\n`;

        if (delivs && delivs.length > 0) {
          dMsg += `<b>📦 Deliverables:</b>\n`;
          delivs.forEach((d: any) => {
            dMsg += `• ${escapeHtml(d.file_name)}: ${d.drive_link || 'Ready'}\n`;
          });
        } else {
          dMsg += `<i>Status: ${task.status.toUpperCase()} — in progress.</i>`;
        }
        await reply(dMsg);
        return { handled: true };
      } else {
        // UUID not found in active tasks
        const { data: activeTasks } = await supabase
          .from('tasks')
          .select('id, title, course, due_date, status')
          .eq('archived', false)
          .order('posted_date', { ascending: false });

        let notFoundMsg = `⚠️ <b>Task Not Found:</b> <code>${escapeHtml(prompt)}</code>\n\n` +
          `<i>This task ID does not exist in the active database (it was cleared during the database reset).</i>\n\n` +
          `<b>📋 Current Active Tasks:</b>\n`;

        if (activeTasks && activeTasks.length > 0) {
          activeTasks.forEach((at: any, i: number) => {
            const dueStr = at.due_date
              ? new Date(at.due_date).toLocaleString('en-IN', {
                  timeZone: 'Asia/Kolkata',
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : 'No deadline set';
            notFoundMsg += `${i + 1}. <b>${escapeHtml(at.title)}</b>\n   📚 ${escapeHtml(at.course || 'General')}\n   ⏰ Due: ${dueStr}\n   🆔 <code>${at.id}</code>\n\n`;
          });
        } else {
          notFoundMsg += `<i>No active tasks currently pending.</i>`;
        }
        await reply(notFoundMsg);
        return { handled: true };
      }
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
      const dueStr = t.due_date
        ? new Date(t.due_date).toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : 'No deadline';
      const badge = t.status === 'done' ? '✅ DONE' : t.status === 'building' ? '🔨 BUILDING' : t.status === 'queued' ? '⏳ QUEUED' : `⚠️ ${t.status.toUpperCase()}`;
      msg += `${idx + 1}. <b>${escapeHtml(t.title)}</b>\n`;
      msg += `   📚 ${escapeHtml(t.course || 'General')} | 🏷️ <code>${t.task_type}</code> | [${badge}]\n`;
      msg += `   ⏰ Due: ${dueStr} | 🆔 <code>${t.id}</code>\n\n`;
    });
    msg += `<i>Tip: Type <code>/details &lt;task_id&gt;</code> or <code>/task &lt;task_id&gt;</code> to view details.</i>`;
    await reply(msg);
    return { handled: true };
  }

  // 5. Details Command: /details <task_id>, /info <task_id>
  if (lower.startsWith('/details') || lower.startsWith('/info')) {
    const parts = text.split(/\s+/);
    if (parts.length < 2) {
      await reply('Usage: <code>/details &lt;task_id or item_number&gt;</code>');
      return { handled: true };
    }
    const arg = parts[1].trim();

    // Check if argument is a single digit item number (e.g., /details 1)
    if (/^[1-9]$/.test(arg)) {
      const ordinalResult = await resolveOrdinalReference(arg, incomingChatId);
      if (ordinalResult) {
        await reply(ordinalResult);
        await supabase.from('chat_messages').insert([
          { chat_id: incomingChatId, role: 'user', content: text },
          { chat_id: incomingChatId, role: 'assistant', content: ordinalResult },
        ]);
        return { handled: true };
      }
    }

    const taskId = arg;
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
