// Telegram Bot Integration & Notifications
// Sourced from PRD_academic_task_agent.md (Section 8, Section 7)

import { getSupabaseAdmin, logSystemEvent } from './supabase';
import { getGmailClient } from './google-auth';
import { TaskType } from './types';

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name?: string; username?: string };
    chat: { id: number; type: string };
    date: number;
    text?: string;
    caption?: string;
    document?: {
      file_id: string;
      file_name?: string;
      mime_type?: string;
      file_size?: number;
    };
    photo?: Array<{
      file_id: string;
      width: number;
      height: number;
    }>;
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
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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

  return (
    `✅ <b>Task Created & Queued!</b>\n\n` +
    `📌 <b>Title:</b> ${escapeHtml(title)}\n` +
    `📚 <b>Course:</b> ${escapeHtml(course)}\n` +
    `🏷️ <b>Type:</b> <code>${taskType}</code>\n` +
    `⏰ <b>Due Date:</b> ${new Date(dueDate).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\n` +
    `🆔 <b>Task ID:</b> <code>${taskId}</code>\n\n` +
    `<i>The local worker will claim and build your deliverables automatically.</i>`
  );
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
You manage coursework, research papers, presentations, lab reports, ML models, and programming assignments.

Current Active Tasks in System:
${taskContext || 'No active tasks.'}

Instructions:
1. You have direct tool access to create academic tasks, check system status, list tasks, and look up details.
2. If the student asks you to do, create, build, generate, write, or train an assignment or project, ALWAYS call the 'create_academic_task' tool!
3. If the student asks for status or what tasks exist, call 'get_system_status' or 'list_active_tasks'.
4. If the student asks academic questions or converses naturally, respond directly with rich technical depth and clarity.
5. Format your replies in clean, valid HTML (<b>bold</b>, <i>italic</i>, <code>code</code>, bullet points •). Do NOT use markdown asterisks.`;

  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (openRouterKey) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
      }

      const aiText = message?.content || 'I processed your message.';
      
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

  // 1. Check if user attached a document/file
  if (update.message?.document) {
    const doc = update.message.document;
    const caption = text || doc.file_name || 'Academic Assignment Document';
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

  // 2. Check if user is replying to a pending question
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
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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

  // 8. Retry Command
  if (lower.startsWith('/retry')) {
    const parts = text.split(/\s+/);
    if (parts.length > 1) {
      const taskId = parts[1].trim();
      const { error } = await supabase
        .from('tasks')
        .update({ status: 'queued', updated_at: new Date().toISOString() })
        .eq('id', taskId);

      if (!error) {
        await reply(`🔄 Task <code>${escapeHtml(taskId)}</code> requeued for build.`);
      } else {
        await reply(`❌ Could not retry task: ${escapeHtml(error.message)}`);
      }
      return { handled: true };
    }
  }

  // 9. Help / Start Command
  if (lower === '/help' || lower === '/start') {
    const helpMsg =
      `🤖 <b>Vicarius Academic Assistant Commands</b>\n\n` +
      `<b>Task Management:</b>\n` +
      `• <code>/task &lt;details&gt;</code> — Create & queue a new academic task\n` +
      `• <code>/tasks</code> or <code>/list</code> — View all active tasks\n` +
      `• <code>/details &lt;task_id&gt;</code> — View requirements & download links\n` +
      `• <code>/retry &lt;task_id&gt;</code> — Requeue a flagged or failed task\n` +
      `• <code>/cancel &lt;task_id&gt;</code> — Archive / cancel a task\n\n` +
      `<b>System:</b>\n` +
      `• <code>/status</code> — System telemetry & queue state\n` +
      `• <code>/help</code> — Show this command menu\n\n` +
      `<b>Interactive AI Chat & Ingestion:</b>\n` +
      `• <b>Direct Chat:</b> Ask any questions about your courses, concepts, or schedule.\n` +
      `• <b>Document Upload:</b> Send any <code>.pdf</code> or <code>.docx</code> assignment brief to auto-create a task!\n` +
      `• <b>Clarifications:</b> Reply to any question alert from the bot to guide the build worker.`;
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
