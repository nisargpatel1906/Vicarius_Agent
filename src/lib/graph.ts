// LangGraph Agentic Pipeline for Vicarius Agent
// Orchestrates multi-step reasoning, automated pre-retrieval RAG, tool execution, and Telegram HTML delivery

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

const STUDENT_NAME = process.env.STUDENT_NAME || 'Nisarg Patel';
const STUDENT_UNIVERSITY = process.env.STUDENT_UNIVERSITY || 'Academic Institution';
const STUDENT_PROGRAM = process.env.STUDENT_PROGRAM || 'Computer Engineering / AI-ML';
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
  // (Handled carefully to avoid double-wrapping)
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
  actionTaken: Annotation<string | null>(),
  finalResponse: Annotation<string>(),
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
 * Node 2: Intent & Action Execution
 * Checks if the message requires executing a direct academic action.
 */
async function actionRouterNode(state: typeof AcademicAgentState.State) {
  const prompt = (state.userPrompt || '').trim();
  const supabase = getSupabaseAdmin();

  // 1. Direct task creation requested
  const isTaskRequest =
    /(create|build|generate|make|prepare|write|train|develop|implement|code)\s+(me\s+)?(a\s+|an\s+)?(assignment|task|project|ppt|presentation|report|slide|essay|code|calculator|calculater|app|application|website|web\s*app|script|program|model|system|notebook|dashboard|bot|api)/i.test(
      prompt
    ) ||
    /^(make|build|create|develop|code)\s+.+\s+(due|deadline)\b/i.test(prompt) ||
    /\b(due\s+(?:on|by|before|date)|deadline\s*(?:is|:))\b/i.test(prompt);

  if (isTaskRequest) {
    const confirmation = await createTaskFromTelegram(prompt);
    return {
      actionTaken: confirmation,
      finalResponse: confirmation,
    };
  }

  // 2. Specific request for classroom feed without specific dates or filters
  if (
    /^(show|give|get|view)\s+(me\s+)?(the\s+)?(last|latest|recent|new)\s+(message|announcement|post|notice).*classroom$/i.test(
      prompt
    )
  ) {
    const classroomMsg = await getLatestClassroomMessages(5);
    return {
      actionTaken: classroomMsg,
      finalResponse: classroomMsg,
    };
  }

  // 3. Specific request for Gmail
  if (
    /(recent|latest|unread)\s+(email|emails|mail|gmail)|check\s+(my\s+)?(gmail|inbox)/i.test(prompt)
  ) {
    const emailMsg = await getRecentGmailEmails(5);
    return {
      actionTaken: emailMsg,
      finalResponse: emailMsg,
    };
  }

  // 4. Synchronization
  if (/^(sync|synchronize)(\s+(all|classroom|gmail))?$/i.test(prompt)) {
    const syncMsg = await syncClassroomAndGmail();
    return {
      actionTaken: syncMsg,
      finalResponse: syncMsg,
    };
  }

  // 5. System Status
  if (/(system\s+status|telemetry|queue\s+count|how\s+many\s+tasks)/i.test(prompt)) {
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

    return {
      actionTaken: statusMsg,
      finalResponse: statusMsg,
    };
  }

  // 6. List active tasks
  if (/(list|show|what\s+are)\s+(active|all|pending|my)\s+tasks/i.test(prompt)) {
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

    return {
      actionTaken: listMsg,
      finalResponse: listMsg,
    };
  }

  // 7. Feedback / Course correction
  if (/(remember|note\s+that|teacher\s+said|feedback|rule\s+for)\s+(CE|IT|CSE|[A-Z]{2,4}-\d{3})/i.test(prompt)) {
    const match = prompt.match(/(?:for|in)\s+([A-Za-z0-9\-]+)/i);
    const course = match ? match[1] : 'General';
    const resultMsg = await rememberCourseCorrection(course, prompt);
    return {
      actionTaken: resultMsg,
      finalResponse: resultMsg,
    };
  }

  return { actionTaken: null };
}

/**
 * Node 3: LangGraph Gemini Reasoner
 * Generates an intelligent, grounded response using ChatGoogleGenerativeAI (gemini-3.6-flash).
 */
async function generateReasoningNode(state: typeof AcademicAgentState.State) {
  if (state.actionTaken) {
    return { finalResponse: state.actionTaken };
  }

  const systemInstruction = `You are Vicarius Agent, a world-class autonomous academic intelligence assistant built for ${STUDENT_NAME} at ${STUDENT_UNIVERSITY} (${STUDENT_PROGRAM}).
You are powered by a LangGraph StateGraph engine with live Supabase database grounding.

CURRENT ACTIVE TASKS:
${state.taskContext}

${state.groundedRecords}

CRITICAL RULES:
1. ALWAYS GROUND YOUR ANSWERS IN THE KNOWLEDGE BASE RECORDS: If relevant records are provided in 'GROUNDED ACADEMIC KNOWLEDGE BASE RECORDS', you MUST use their verbatim text, dates, meeting IDs, and links to answer immediately!
   • If the student asks for a lecture link, Zoom link, or today's session link, extract the Zoom/Meet URL (e.g. https://zoom.us/j/...), Meeting ID, and Passcode directly from the records and output them clearly. NEVER say it was cut off or ask "want me to fetch it?" — you already have the full details!
   • If the student asks about "Red Hat Academy" or any course/program, provide the exact registration form link (e.g. https://forms.gle/...) and details immediately! NEVER say it wasn't found or ask "want me to search your knowledge base?" — the records are right above!
   • TIMELINE & DATE-BASED QUERIES: If the student asks about announcements, posts, materials, or events from a specific date (e.g. "Sep 1", "September 1", "today", "yesterday", "Sep 3"), you MUST review all grounded records from that date. List and summarize all announcements, notices, room updates, and new materials posted on that date! Include the course, author/faculty, key updates, and clickable links. NEVER claim that no announcements were posted on that date if grounded records exist!
   • Format all URLs as clickable HTML (<a href="...">...</a>).
2. NEVER say you don't have access to academic information. All current announcements, meeting links, and coursework are stored in your grounded context above.
3. Format all text replies in clean, valid HTML (<b>bold</b>, <i>italic</i>, <code>code</code>, bullet points •, <a href="url">link text</a>). Do NOT use markdown asterisks (*).`;

  let responseContent = '';

  // Primary Attempt: OpenRouter Free Models (minimax/minimax-m3:free -> google/gemini-2.0-flash-exp:free -> meta-llama/llama-3.3-70b-instruct:free)
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (openRouterKey) {
    const freeModels = [
      'minimax/minimax-m3:free',
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
        console.warn(`[LangGraph] OpenRouter (${model}) error:`, err?.message || err);
      }
    }
  }

  // Fallback: Google Gemini (gemini-3.6-flash / gemini-flash-latest)
  if (!responseContent) {
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      for (const gemModel of ['gemini-3.6-flash', 'gemini-flash-latest']) {
        try {
          const model = new ChatGoogleGenerativeAI({
            model: gemModel,
            apiKey: geminiKey,
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
          console.warn(`[LangGraph] Gemini (${gemModel}) error:`, geminiError?.message || geminiError);
        }
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
 * Node 4: Persistence & Finalization
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
 * Conditional Edge: Decide whether action was handled or if Gemini reasoning is needed
 */
function routeAfterAction(state: typeof AcademicAgentState.State) {
  if (state.actionTaken) {
    return 'persist';
  }
  return 'generate';
}

/**
 * Build and Compile the Academic Agent StateGraph
 */
export const academicAgentGraph = new StateGraph(AcademicAgentState)
  .addNode('preRetrieve', preRetrieveNode)
  .addNode('actionRouter', actionRouterNode)
  .addNode('generate', generateReasoningNode)
  .addNode('persist', persistNode)
  .addEdge(START, 'preRetrieve')
  .addEdge('preRetrieve', 'actionRouter')
  .addConditionalEdges('actionRouter', routeAfterAction, {
    persist: 'persist',
    generate: 'generate',
  })
  .addEdge('generate', 'persist')
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
