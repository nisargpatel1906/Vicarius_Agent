// LangGraph Agentic Pipeline for Vicarius Agent
// Orchestrates multi-step reasoning, automated pre-retrieval RAG, semantic LLM intent routing, tool execution, and Telegram HTML delivery

import { Annotation, StateGraph, END, START } from '@langchain/langgraph';
import { BaseMessage, HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { getSupabaseAdmin, logSystemEvent } from './supabase';
import {
  retrieveRelevantKnowledge,
  getLatestClassroomMessages,
  getRecentGmailEmails,
  syncClassroomAndGmail,
  getDetailedPostInformation,
  createTaskFromTelegram,
} from './telegram';
import { rememberCourseCorrection } from './aethos';

const OPENROUTER_API_URL = process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Escapes characters for Telegram HTML formatting
 */
function escapeHtml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Converts common Markdown elements to Telegram HTML
 */
function markdownToTelegramHtml(text: string): string {
  if (!text) return '';
  let formatted = text;

  // Convert bold: **text** or __text__ -> <b>text</b>
  formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
  formatted = formatted.replace(/__(.*?)__/g, '<b>$1</b>');

  // Convert markdown links: [text](url) -> <a href="url">text</a>
  formatted = formatted.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');

  // Convert raw URLs into clickable links if not already wrapped in <a href=
  formatted = formatted.replace(/(?<!href=")(https?:\/\/[^\s<>)"]+)/g, '<a href="$1">$1</a>');

  // Convert inline code: `code` -> <code>code</code>
  formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Convert markdown bullet points: * or - at start of line -> •
  formatted = formatted.replace(/^[\*\-]\s+/gm, '• ');

  return formatted;
}

/**
 * State Definition for the LangGraph Agentic Pipeline
 */
export const AcademicAgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  chatId: Annotation<string>(),
  userPrompt: Annotation<string>(),
  groundedRecords: Annotation<string>(),
  taskContext: Annotation<string>(),
  intent: Annotation<string>({
    reducer: (_, y) => y,
    default: () => 'general_qa',
  }),
  intentConfidence: Annotation<number>({
    reducer: (_, y) => y,
    default: () => 0.5,
  }),
  actionTaken: Annotation<string | null>({
    reducer: (_, y) => y,
    default: () => null,
  }),
  finalResponse: Annotation<string>({
    reducer: (_, y) => y,
    default: () => '',
  }),
});

/**
 * Node 1: Pre-Retrieval RAG
 * Automatically queries Supabase knowledge_base and tasks to ground the agent before reasoning.
 */
async function preRetrieveNode(state: typeof AcademicAgentState.State) {
  const supabase = getSupabaseAdmin();
  const prompt = state.userPrompt || '';

  // 1. Fetch active tasks
  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, title, status, course, due_date')
    .eq('archived', false)
    .order('due_date', { ascending: true })
    .limit(10);

  const taskContext = (tasks || [])
    .map(
      (t) =>
        `- [${t.status.toUpperCase()}] ${t.title} (${t.course || 'General'}, Due: ${t.due_date || 'N/A'}, ID: ${t.id})`
    )
    .join('\n');

  // 2. Query Knowledge Base with automated hybrid matching & temporal date filtering
  const kbMatches = await retrieveRelevantKnowledge(prompt, 10);
  let groundedRecords = '';
  if (kbMatches.length > 0) {
    groundedRecords =
      `GROUNDED ACADEMIC KNOWLEDGE BASE RECORDS (Retrieved directly from Supabase Knowledge Base):\n` +
      kbMatches
        .map((item, idx) => {
          const full = (item.content || '').trim();
          const rawUrls: string[] = full.match(/https?:\/\/[^\s<>)"]+/g) || [];
          const urls = Array.from(new Set<string>(rawUrls));
          const urlStr = urls.length > 0 ? `\nExtracted Clickable Links: ${urls.join(', ')}` : '';
          const postedDate = item.posted_date ? ` | Posted Date: ${item.posted_date}` : '';
          return `[RECORD ${idx + 1}] Title: ${item.title} | Course: ${item.course || 'General'}${postedDate}\nContent:\n${full}${urlStr}`;
        })
        .join('\n\n-----------------------------------------\n\n');
  }

  return {
    taskContext: taskContext || 'No active tasks.',
    groundedRecords: groundedRecords || 'No specific knowledge base records matched.',
  };
}

/**
 * Node 2: Semantic Intent Router (LLM Powered)
 * Dynamically classifies user intent without brittle keyword/regex matching.
 */
async function semanticRouterNode(state: typeof AcademicAgentState.State) {
  const prompt = (state.userPrompt || '').trim();

  const routerSystemPrompt = `You are the Autonomous Intent Router for Vicarius Academic Agent (for a Computer Engineering student).
Analyze the user's prompt and recent context, then classify the user's goal into strict JSON:
{
  "intent": "create_task" | "classroom_feed" | "gmail_feed" | "sync_sources" | "system_status" | "list_tasks" | "course_correction" | "general_qa",
  "confidence": number // 0.0 to 1.0
}

INTENT DEFINITIONS:
- "create_task": User wants to build, create, write, code, implement, train, or schedule ANY project, assignment, calculator, app, web app, script, presentation, report, or notebook, OR mentions a deadline/due date.
- "classroom_feed": User wants announcements, posts, notices from Google Classroom.
- "gmail_feed": User wants recent emails, inbox messages, or academic alerts from Gmail.
- "sync_sources": User explicitly wants to re-poll, synchronize, or refresh data from Classroom/Gmail.
- "system_status": User wants system status, queues, progress telemetry, or agent health check.
- "list_tasks": User wants to view, list, or check pending or active coursework or tasks.
- "course_correction": User gives a rule, correction, or memory instruction for future coursework (e.g. "remember that for CE-401 use IEEE format").
- "general_qa": Questions about coursework, concepts, formulas, lecture links, syllabus, or conversational academic inquiries.`;

  let detectedIntent = 'general_qa';
  let detectedConfidence = 0.5;

  // Try OpenRouter Free Models first
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (openRouterKey) {
    const freeModels = ['inclusionai/ling-3.0-flash-fin:free', 'google/gemini-2.0-flash-exp:free', 'meta-llama/llama-3.3-70b-instruct:free'];
    for (const model of freeModels) {
      try {
        const res = await fetch(OPENROUTER_API_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${openRouterKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': process.env.HTTP_REFERER || 'https://vicarius-agent.local',
            'X-Title': 'Vicarius Academic Agent',
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: routerSystemPrompt },
              { role: 'user', content: prompt },
            ],
            temperature: 0.1,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const content = (data.choices?.[0]?.message?.content || '').replace(/```json/g, '').replace(/```/g, '').trim();
          const parsed = JSON.parse(content);
          if (parsed.intent) {
            detectedIntent = parsed.intent;
            detectedConfidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.9;
            break;
          }
        }
      } catch (err: any) {
        console.warn(`[LangGraph Router] OpenRouter (${model}) error:`, err?.message || err);
      }
    }
  }

  // Fallback to Google Gemini (gemini-3.6-flash / gemini-flash-latest) if OpenRouter failed
  if (detectedConfidence < 0.7 && process.env.GEMINI_API_KEY) {
    for (const gemModel of ['gemini-3.6-flash', 'gemini-flash-latest']) {
      try {
        const model = new ChatGoogleGenerativeAI({
          model: gemModel,
          apiKey: process.env.GEMINI_API_KEY,
          temperature: 0.1,
        });
        const res = await model.invoke([
          new SystemMessage(routerSystemPrompt),
          new HumanMessage(prompt),
        ]);
        const text = (typeof res.content === 'string' ? res.content : JSON.stringify(res.content))
          .replace(/```json/g, '')
          .replace(/```/g, '')
          .trim();
        const parsed = JSON.parse(text);
        if (parsed.intent) {
          detectedIntent = parsed.intent;
          detectedConfidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.9;
          break;
        }
      } catch (gemErr: any) {
        console.warn(`[LangGraph Router] Gemini (${gemModel}) error:`, gemErr?.message || gemErr);
      }
    }
  }

  // Fallback heuristic if LLMs were unreachable
  if (detectedConfidence < 0.6) {
    if (/(create|build|generate|make|prepare|write|train|develop|implement|code)\s+/i.test(prompt) || /\b(due|deadline)\b/i.test(prompt)) {
      detectedIntent = 'create_task';
    } else if (/(classroom|notices|announcements)/i.test(prompt)) {
      detectedIntent = 'classroom_feed';
    } else if (/(email|emails|gmail|inbox)/i.test(prompt)) {
      detectedIntent = 'gmail_feed';
    } else if (/(sync|refresh|poll)/i.test(prompt)) {
      detectedIntent = 'sync_sources';
    } else if (/(status|telemetry)/i.test(prompt)) {
      detectedIntent = 'system_status';
    } else if (/(list|show|what are).*(tasks|assignments)/i.test(prompt)) {
      detectedIntent = 'list_tasks';
    }
  }

  console.log(`[LangGraph Router] Intent: ${detectedIntent} (conf: ${detectedConfidence}) for prompt: "${prompt.slice(0, 60)}"`);

  return {
    intent: detectedIntent,
    intentConfidence: detectedConfidence,
  };
}

/**
 * Node 3: Action Execution
 * Executes deterministic academic tools when classified by the semantic router.
 */
async function executeActionNode(state: typeof AcademicAgentState.State) {
  const prompt = (state.userPrompt || '').trim();
  const intent = state.intent;
  const supabase = getSupabaseAdmin();

  let actionResult = '';

  try {
    switch (intent) {
      case 'create_task': {
        actionResult = await createTaskFromTelegram(prompt);
        break;
      }
      case 'classroom_feed': {
        actionResult = await getLatestClassroomMessages(5);
        break;
      }
      case 'gmail_feed': {
        actionResult = await getRecentGmailEmails(5);
        break;
      }
      case 'sync_sources': {
        actionResult = await syncClassroomAndGmail();
        break;
      }
      case 'system_status': {
        const { data: allTasks } = await supabase
          .from('tasks')
          .select('id, title, status, course, due_date')
          .eq('archived', false)
          .order('due_date', { ascending: true });

        const queued = allTasks?.filter((t) => t.status === 'queued' || t.status === 'new').length || 0;
        const building =
          allTasks?.filter(
            (t) => t.status === 'building' || t.status === 'claimed' || t.status === 'verifying'
          ).length || 0;
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
            const dueStr = t.due_date
              ? new Date(t.due_date).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })
              : 'No deadline';
            statusMsg += `• [${t.status.toUpperCase()}] <b>${escapeHtml(t.title)}</b> (${escapeHtml(t.course || 'General')}) — Due: ${dueStr}\n`;
          });
        }
        actionResult = statusMsg;
        break;
      }
      case 'list_tasks': {
        const { data: listTasks } = await supabase
          .from('tasks')
          .select('id, title, status, course, due_date')
          .eq('archived', false)
          .order('due_date', { ascending: true });

        let listMsg = `📋 <b>Active Academic Tasks:</b>\n\n`;
        if (listTasks && listTasks.length > 0) {
          listTasks.forEach((t) => {
            const dueStr = t.due_date
              ? new Date(t.due_date).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })
              : 'No deadline';
            listMsg += `• [${t.status.toUpperCase()}] <b>${escapeHtml(t.title)}</b> (${escapeHtml(t.course || 'General')}) — Due: ${dueStr}\n`;
          });
        } else {
          listMsg += `<i>No active tasks found matching criteria.</i>`;
        }
        actionResult = listMsg;
        break;
      }
      case 'course_correction': {
        const match = prompt.match(/(?:for|in)\s+([A-Za-z0-9\-]+)/i);
        const course = match ? match[1] : 'General';
        actionResult = await rememberCourseCorrection(course, prompt);
        break;
      }
      default:
        actionResult = '';
    }
  } catch (err: any) {
    console.error(`[LangGraph Action] Error executing action for intent '${intent}':`, err);
    actionResult = `❌ Action error: ${escapeHtml(err.message)}`;
  }

  return {
    actionTaken: actionResult || null,
    finalResponse: actionResult || '',
  };
}

/**
 * Node 4: LangGraph Grounded Reasoner
 * Formulates an intelligent, grounded answer for academic concepts, questions, and open-ended queries.
 */
async function generateReasoningNode(state: typeof AcademicAgentState.State) {
  if (state.actionTaken) {
    return { finalResponse: state.actionTaken };
  }

  let studentName = 'Student';
  let studentUniv = 'Academic Institution';
  let studentProg = 'Undergraduate Degree';
  try {
    const supabase = getSupabaseAdmin();
    const { data: prof } = await supabase
      .from('profile')
      .select('full_name, preferred_name, university, program')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (prof) {
      studentName = prof.preferred_name || prof.full_name || studentName;
      studentUniv = prof.university || studentUniv;
      studentProg = prof.program || studentProg;
    }
  } catch {}

  const systemInstruction = `You are Vicarius Agent, a world-class autonomous academic intelligence assistant built for ${studentName} at ${studentUniv} (${studentProg}).
You are powered by a LangGraph StateGraph engine with live Supabase database grounding.

CURRENT ACTIVE TASKS:
${state.taskContext}

${state.groundedRecords}

CRITICAL RULES:
1. ALWAYS GROUND YOUR ANSWERS IN THE KNOWLEDGE BASE RECORDS: If relevant records are provided in 'GROUNDED ACADEMIC KNOWLEDGE BASE RECORDS', you MUST use their verbatim text, dates, meeting IDs, and links to answer immediately!
   • If the student asks for a lecture link, Zoom link, or today's session link, extract the Zoom/Meet URL (e.g. https://zoom.us/j/...), Meeting ID, and Passcode directly from the records and output them clearly. NEVER say it was cut off or ask "want me to fetch it?" — you already have the full details!
   • If the student asks about "Red Hat Academy" or any course/program, provide the exact registration form link (e.g. https://forms.gle/...) and details immediately! NEVER say it wasn't found or ask "want me to search your knowledge base?" — the records are right above!
   • TIMELINE & DATE-BASED QUERIES: If the student asks about announcements, posts, materials, or events from a specific date (e.g. "Sep 1", "September 1", "today", "yesterday", "Sep 3"), you MUST review all grounded records from that date. List and summarize all announcements, notices, room updates, and new materials posted on that date! Include the course, author/faculty, key updates, and clickable links.
   • Format all URLs as clickable HTML (<a href="...">...</a>).
2. Format all text replies in clean, valid HTML (<b>bold</b>, <i>italic</i>, <code>code</code>, bullet points •, <a href="url">link text</a>). Do NOT use markdown asterisks (*).`;

  let responseContent = '';

  // Primary: OpenRouter Free Models (inclusionai/ling-3.0-flash-fin:free -> google/gemini-2.0-flash-exp:free -> meta-llama/llama-3.3-70b-instruct:free)
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (openRouterKey) {
    const freeModels = [
      'inclusionai/ling-3.0-flash-fin:free',
      'google/gemini-2.0-flash-exp:free',
      'meta-llama/llama-3.3-70b-instruct:free',
    ];
    for (const model of freeModels) {
      try {
        const historyMsgs = (state.messages || []).map((m) => ({
          role: m._getType() === 'human' ? 'user' : 'assistant',
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        }));

        const res = await fetch(OPENROUTER_API_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${openRouterKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': process.env.HTTP_REFERER || 'https://vicarius-agent.local',
            'X-Title': 'Vicarius Academic Agent',
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemInstruction },
              ...historyMsgs,
              { role: 'user', content: state.userPrompt },
            ],
            temperature: 0.2,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const content = data.choices?.[0]?.message?.content;
          if (content && content.trim()) {
            responseContent = content.trim();
            break;
          }
        }
      } catch (err: any) {
        console.warn(`[LangGraph Reasoner] OpenRouter (${model}) error:`, err?.message || err);
      }
    }
  }

  // Fallback: Google Gemini (gemini-3.6-flash / gemini-flash-latest)
  if (!responseContent && process.env.GEMINI_API_KEY) {
    for (const gemModel of ['gemini-3.6-flash', 'gemini-flash-latest']) {
      try {
        const model = new ChatGoogleGenerativeAI({
          model: gemModel,
          apiKey: process.env.GEMINI_API_KEY,
          temperature: 0.2,
        });

        const messages: BaseMessage[] = [
          new SystemMessage(systemInstruction),
          ...state.messages,
          new HumanMessage(state.userPrompt),
        ];

        const result = await model.invoke(messages);
        const text = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
        if (text && text.trim()) {
          responseContent = text.trim();
          break;
        }
      } catch (geminiError: any) {
        console.warn(`[LangGraph Reasoner] Gemini (${gemModel}) error:`, geminiError?.message || geminiError);
      }
    }
  }

  if (!responseContent) {
    responseContent = `⚠️ I received your inquiry, but the reasoning engine is momentarily busy. Please try asking again.`;
  }

  // Convert markdown to clean Telegram HTML
  const formattedHtml = markdownToTelegramHtml(responseContent);

  return {
    finalResponse: formattedHtml,
  };
}

/**
 * Node 5: Persistence & Finalization
 * Logs the assistant response to Supabase chat_messages.
 */
async function persistNode(state: typeof AcademicAgentState.State) {
  const supabase = getSupabaseAdmin();
  const chatId = state.chatId;
  const reply = state.finalResponse || 'Processed.';

  if (chatId) {
    try {
      await supabase.from('chat_messages').insert({
        chat_id: chatId,
        role: 'assistant',
        content: reply,
      });
    } catch (dbErr) {
      console.error('[LangGraph] Failed to persist chat message:', dbErr);
    }
  }

  return {
    finalResponse: reply,
  };
}

/**
 * Conditional Edge: Route after Semantic Router
 */
function routeAfterSemanticRouter(state: typeof AcademicAgentState.State) {
  if (state.intent && state.intent !== 'general_qa') {
    return 'executeAction';
  }
  return 'generateReasoning';
}

/**
 * Conditional Edge: Route after Action Execution
 */
function routeAfterActionExecution(state: typeof AcademicAgentState.State) {
  if (state.actionTaken) {
    return 'persist';
  }
  return 'generateReasoning';
}

/**
 * Build and Compile the Academic Agent StateGraph
 */
export const academicAgentGraph = new StateGraph(AcademicAgentState)
  .addNode('preRetrieve', preRetrieveNode)
  .addNode('semanticRouter', semanticRouterNode)
  .addNode('executeAction', executeActionNode)
  .addNode('generateReasoning', generateReasoningNode)
  .addNode('persist', persistNode)
  .addEdge(START, 'preRetrieve')
  .addEdge('preRetrieve', 'semanticRouter')
  .addConditionalEdges('semanticRouter', routeAfterSemanticRouter, {
    executeAction: 'executeAction',
    generateReasoning: 'generateReasoning',
  })
  .addConditionalEdges('executeAction', routeAfterActionExecution, {
    persist: 'persist',
    generateReasoning: 'generateReasoning',
  })
  .addEdge('generateReasoning', 'persist')
  .addEdge('persist', END)
  .compile();

/**
 * Public execution interface for Telegram
 */
export async function runAcademicAgentGraph(
  userPrompt: string,
  chatId: string
): Promise<string> {
  const supabase = getSupabaseAdmin();

  // Load recent history (last 4 messages)
  const { data: history } = await supabase
    .from('chat_messages')
    .select('role, content')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false })
    .limit(4);

  const historyMessages: BaseMessage[] = (history || [])
    .reverse()
    .map((h) =>
      h.role === 'user' ? new HumanMessage(h.content) : new AIMessage(h.content)
    );

  const result = await academicAgentGraph.invoke({
    userPrompt,
    chatId,
    messages: historyMessages,
  });

  return result.finalResponse;
}
