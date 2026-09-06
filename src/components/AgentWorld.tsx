'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Task, Deliverable } from '@/lib/types';
import {
  TelegramBrandIcon,
  GoogleClassroomBrandIcon,
  GmailBrandIcon,
  SupabaseBrandIcon,
  AnthropicClaudeBrandIcon,
  GoogleGeminiBrandIcon,
  OpenAIBrandIcon,
  DeepSeekBrandIcon,
  OpenRouterBrandIcon,
  GroqBrandIcon,
  PythonBrandIcon,
  PowerPointBrandIcon,
  WordBrandIcon,
  GoogleDriveBrandIcon,
  GoogleCalendarBrandIcon,
  LangChainBrandIcon,
  LangGraphBrandIcon,
  VercelBrandIcon,
  AppBrandBadge,
} from '@/components/AppBrandIcons';

export interface AgentWorldProps {
  tasks: Task[];
  selectedTask: Task | null;
  onSelectTask?: (task: Task) => void;
  onRefresh?: () => Promise<void>;
  onTriggerIngest?: () => Promise<void>;
  onRetryTask?: (taskId: string) => Promise<void>;
  loading?: boolean;
  ingesting?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export interface CampusLandmark {
  id: string;
  name: string;
  subtitle: string;
  x: number;
  y: number;
  stageName: string;
  langGraphNodes: string[];
  toolsUsed: string[];
  brandIcons: string[];
  description: string;
  iconType: string;
  color: string;
  inputSchema: string;
  outputSchema: string;
  metrics: { uptime: string; avgLatency: string; throughput: string };
}

export const CAMPUS_LANDMARKS: CampusLandmark[] = [
  {
    id: 'telegram_base',
    name: 'Student Command & Telegram Porch',
    subtitle: 'Directive Intake & Mobile Porch',
    x: 110,
    y: 360,
    stageName: 'START / Directive Intake',
    langGraphNodes: ['START', 'User Directive', 'END'],
    toolsUsed: ['Telegram Bot API', 'Supabase Webhooks', 'Mobile Push Notifications'],
    brandIcons: ['telegram'],
    description: 'Where student directives originate from Telegram chats, voice notes, and mobile push notifications. Vicarius rests here between missions.',
    iconType: 'telegram_base',
    color: '#229ED9',
    inputSchema: '{ "chat_id": 788628401, "message_text": "Need 17-slide pitch deck...", "attachments": [] }',
    outputSchema: '{ "directive_id": "dir_901a", "priority": "high", "raw_prompt": "...", "timestamp": "ISO-8601" }',
    metrics: { uptime: '100%', avgLatency: '120ms', throughput: '45 msgs/min' },
  },
  {
    id: 'classroom_ingest',
    name: 'Google Classroom & Ingest Hub',
    subtitle: 'Syllabus Ingestion & PDF Parser',
    x: 240,
    y: 190,
    stageName: 'Coursework & Material Ingestion',
    langGraphNodes: ['ingestor', 'email_scanner', 'pdf_extractor'],
    toolsUsed: ['Google Classroom API', 'Gmail API', 'pdf-parse', 'mammoth (docx)'],
    brandIcons: ['googleclassroom', 'gmail'],
    description: 'Automatically scans Google Classroom courses and Gmail announcements. Extracts syllabus PDFs, rubric constraints, and assignment due dates.',
    iconType: 'classroom_ingest',
    color: '#0F9D58',
    inputSchema: '{ "course_id": "CS-401", "assignment_id": "assign_77", "attachments": ["rubric.pdf"] }',
    outputSchema: '{ "extracted_text": "...", "rubric_criteria": ["17 slides", "IEEE citations"], "deadline": "IST" }',
    metrics: { uptime: '99.9%', avgLatency: '840ms', throughput: '12 docs/min' },
  },
  {
    id: 'supabase_hub',
    name: 'Supabase Intelligence Hub',
    subtitle: 'PostgreSQL Ledger & Realtime Bus',
    x: 390,
    y: 360,
    stageName: 'Task Persistence & Realtime Event',
    langGraphNodes: ['state_writer', 'event_bus', 'task_ledger'],
    toolsUsed: ['Supabase Postgres', 'Supabase Realtime (WebSocket)', 'Row-Level Security', 'Edge Functions'],
    brandIcons: ['supabase'],
    description: 'Central task ledger and ACID event bus. Commits directives to PostgreSQL, manages task status states, and broadcasts live WebSocket updates to the dashboard.',
    iconType: 'supabase_hub',
    color: '#3ECF8E',
    inputSchema: '{ "table": "tasks", "action": "INSERT", "data": { "title": "AI in Healthcare", "status": "new" } }',
    outputSchema: '{ "task_id": "f909bbf1-...", "status": "new", "realtime_broadcast": true }',
    metrics: { uptime: '99.98%', avgLatency: '45ms', throughput: '1,200 ev/sec' },
  },
  {
    id: 'langgraph_tower',
    name: 'LangGraph StateGraph Tower',
    subtitle: '9-Node Orchestrator & Checkpoints',
    x: 520,
    y: 190,
    stageName: 'State Transition & Graph Routing',
    langGraphNodes: ['state_graph_coordinator', 'checkpoint_manager', 'router_guard'],
    toolsUsed: ['LangGraph StateGraph', 'LangChain Core', 'MemoryCheckpointer', 'Conditional Edges'],
    brandIcons: ['langgraph', 'langchain'],
    description: 'The executive coordinator of Vicarius. Directs execution flow between all 9 graph nodes, enforcing state schemas, conditional branches, and checkpoint rollbacks.',
    iconType: 'langgraph_tower',
    color: '#00A67E',
    inputSchema: '{ "node": "ingestor", "state": { "task_id": "f909...", "retry_count": 0 } }',
    outputSchema: '{ "next_node": "planner", "branch": "standard_execution", "checkpoint_id": "chk_89" }',
    metrics: { uptime: '100%', avgLatency: '18ms', throughput: '240 nodes/min' },
  },
  {
    id: 'thinker_academy',
    name: 'Thinker & Research Academy',
    subtitle: 'Strategic Blueprint & Rubric Matrix',
    x: 660,
    y: 360,
    stageName: 'Planning & Deep Thinking',
    langGraphNodes: ['extractor', 'planner', 'thinker', 'rubric_matrix'],
    toolsUsed: ['Anthropic Claude 3.7 Sonnet', 'Google Gemini 2.5 Pro', 'Reflexion Prompts'],
    brandIcons: ['anthropic', 'googlegemini'],
    description: 'Formulates comprehensive execution strategies. Deconstructs assignment constraints into 17-slide outlines, citation rubrics, and structured Python build scripts.',
    iconType: 'thinker_academy',
    color: '#D97757',
    inputSchema: '{ "syllabus_text": "...", "target_deliverable": "pptx", "slide_count_required": 17 }',
    outputSchema: '{ "blueprint_slides": 17, "execution_plan": ["Title", "Problem", ...], "rubric_score_target": 100 }',
    metrics: { uptime: '99.9%', avgLatency: '3.2s', throughput: '35 tokens/s' },
  },
  {
    id: 'dispatch_nexus',
    name: 'Model Dispatch & Gateway Nexus',
    subtitle: 'AI Router & Low-Latency Gateway',
    x: 800,
    y: 190,
    stageName: 'LLM Routing & Token Budget',
    langGraphNodes: ['model_router', 'token_budget_guard', 'retry_oracle'],
    toolsUsed: ['OpenRouter API', 'Groq LPUs', 'DeepSeek R1', 'OpenAI GPT-4o'],
    brandIcons: ['openrouter', 'groq', 'deepseek', 'openai'],
    description: 'Directs prompts to the optimal LLM inference endpoint. Enforces token budgets, balances latency vs reasoning depth, and manages automatic fallback circuits.',
    iconType: 'dispatch_nexus',
    color: '#6366F1',
    inputSchema: '{ "prompt_type": "coding", "token_budget": 25000, "preferred_tier": "fast" }',
    outputSchema: '{ "provider": "Groq", "model": "llama-3.3-70b-versatile", "latency": "380ms" }',
    metrics: { uptime: '99.95%', avgLatency: '290ms', throughput: '480 req/min' },
  },
  {
    id: 'coder_foundry',
    name: "Nisarg's Foundry & GPU Workshop",
    subtitle: 'Local PC & CLI Deliverable Forge',
    x: 940,
    y: 360,
    stageName: 'Antigravity CLI Code Compilation',
    langGraphNodes: ['coder', 'worker.worker', 'task_work_dir'],
    toolsUsed: ['Antigravity CLI (agy)', 'Python 3.12', 'python-pptx', 'python-docx', 'work_dirs/'],
    brandIcons: ['python', 'microsoftpowerpoint', 'microsoftword'],
    description: 'Local execution engine on Nisarg\'s physical PC. Compiles standalone Python scripts, synthesizes master 17-slide decks, formats DOCX papers, and generates source assets.',
    iconType: 'coder_foundry',
    color: '#705728',
    inputSchema: '{ "script": "generate_deck.py", "output_format": "pptx", "target_slides": 17 }',
    outputSchema: '{ "file_created": "work_dirs/.../presentation.pptx", "size_bytes": 148290, "exit_code": 0 }',
    metrics: { uptime: '100%', avgLatency: '4.8s', throughput: '8 builds/min' },
  },
  {
    id: 'diagnostic_clinic',
    name: 'Self-Healing Diagnostic Hospital',
    subtitle: 'Root-Cause Analysis & Repair Clinic',
    x: 940,
    y: 530,
    stageName: 'Self-Healing & Surgical Patching',
    langGraphNodes: ['diagnoser', 'self_healing_loop', 'patch_synthesizer'],
    toolsUsed: ['LOOP_ENGINEERING Evaluator', 'Targeted Code Patching', 'MAX_FIX_ATTEMPTS = 4'],
    brandIcons: ['langgraph', 'anthropic'],
    description: 'The autonomous recovery bay from LOOP_ENGINEERING. When QA audits detect formatting failures or slide count mismatches, Diagnoser analyzes root causes and loops back for re-compilation.',
    iconType: 'diagnostic_clinic',
    color: '#E67E22',
    inputSchema: '{ "failure_reason": "Expected 17 slides, got 14", "attempt": 1, "max_attempts": 4 }',
    outputSchema: '{ "rca_summary": "Loop truncated prematurely", "patch_diff": "+ add missing 3 slides", "next": "coder" }',
    metrics: { uptime: '100%', avgLatency: '2.1s', throughput: '94% heal rate' },
  },
  {
    id: 'qa_observatory',
    name: 'Verification & Rubric Observatory',
    subtitle: 'Inspection Observatory & Audit Seal',
    x: 1090,
    y: 220,
    stageName: 'Slide Audit & Citation Liveness',
    langGraphNodes: ['verifier', 'slide_count_guard', 'citation_validator'],
    toolsUsed: ['python-pptx Inspector', 'HTTP HEAD Link Checker', 'PRD Section 6.4 Rubric'],
    brandIcons: ['python', 'vercel'],
    description: 'Inspects built deliverables: counts presentation slides (strictly verifying 17 slides), checks HTTP citation URLs, and evaluates rubric compliance before shipment.',
    iconType: 'qa_observatory',
    color: '#276A3C',
    inputSchema: '{ "deliverable_path": ".../deck.pptx", "expected_slides": 17, "check_links": true }',
    outputSchema: '{ "verified": true, "slide_count": 17, "live_citations": 8, "qa_seal": "APPROVED" }',
    metrics: { uptime: '99.99%', avgLatency: '1.4s', throughput: '30 audits/min' },
  },
  {
    id: 'shipping_port',
    name: 'Calendar Vault & Shipping Dock',
    subtitle: 'Google Drive Port & Calendar Bookings',
    x: 1140,
    y: 430,
    stageName: 'Packaging & Cloud Delivery Dispatch',
    langGraphNodes: ['deliverer', 'calendar_scheduler', 'END'],
    toolsUsed: ['Google Drive API v3', 'Google Calendar API (IST)', 'Telegram sendDocument'],
    brandIcons: ['googledrive', 'googlecalendar', 'telegram'],
    description: 'Packages ZIP archives, uploads finished presentations to Google Drive student folders, books deadline reminders on Google Calendar (IST), and alerts Telegram.',
    iconType: 'shipping_port',
    color: '#4285F4',
    inputSchema: '{ "files": ["deck.pptx"], "folder_id": "1A4z...", "calendar_event": "IST Deadline" }',
    outputSchema: '{ "drive_url": "https://drive.google.com/...", "telegram_sent": true, "task_state": "done" }',
    metrics: { uptime: '99.98%', avgLatency: '1.9s', throughput: '22 uploads/min' },
  },
];

export interface WaypointStep {
  fromIndex: number;
  toIndex: number;
  actionText: string;
  thought: string;
  isStationary: boolean;
  activeNode: string;
  activeModel: string;
  telemetry: {
    tokenUsage: string;
    slideProgress: string;
    attempt: string;
    status: 'idle' | 'running' | 'warning' | 'success';
  };
}

export interface SimulationScenario {
  id: string;
  title: string;
  subtitle: string;
  badge: string;
  steps: WaypointStep[];
}

export const SIMULATION_SCENARIOS: Record<string, SimulationScenario> = {
  standard: {
    id: 'standard',
    title: 'Standard 17-Slide Academic Delivery',
    subtitle: 'Happy path: Telegram directive intake to Google Drive shipment',
    badge: 'Standard Flow',
    steps: [
      {
        fromIndex: 0,
        toIndex: 0,
        actionText: 'Resting at Telegram Base',
        thought: 'Campus quiet. Listening on Telegram bot webhook and student coursework channels...',
        isStationary: true,
        activeNode: 'START',
        activeModel: 'Idle',
        telemetry: { tokenUsage: '0 / 25,000', slideProgress: '0 / 17', attempt: '1 / 4', status: 'idle' },
      },
      {
        fromIndex: 0,
        toIndex: 2,
        actionText: 'Commuting to Supabase Hub',
        thought: 'New academic directive received via Telegram! Committing task record to Supabase ledger...',
        isStationary: false,
        activeNode: 'state_writer',
        activeModel: 'Postgres ACID',
        telemetry: { tokenUsage: '120 / 25,000', slideProgress: '0 / 17', attempt: '1 / 4', status: 'running' },
      },
      {
        fromIndex: 2,
        toIndex: 2,
        actionText: 'Committing State in Supabase',
        thought: 'Task record inserted. Broadcasting task status updates over Realtime WebSocket channel...',
        isStationary: true,
        activeNode: 'event_bus',
        activeModel: 'Supabase Realtime',
        telemetry: { tokenUsage: '180 / 25,000', slideProgress: '0 / 17', attempt: '1 / 4', status: 'running' },
      },
      {
        fromIndex: 2,
        toIndex: 3,
        actionText: 'Walking to LangGraph Tower',
        thought: 'State committed! Entering LangGraph Control Tower to initialize execution graph...',
        isStationary: false,
        activeNode: 'state_graph_coordinator',
        activeModel: 'LangGraph 1.4',
        telemetry: { tokenUsage: '260 / 25,000', slideProgress: '0 / 17', attempt: '1 / 4', status: 'running' },
      },
      {
        fromIndex: 3,
        toIndex: 3,
        actionText: 'Configuring StateGraph Nodes',
        thought: 'Compiling 9-node graph with conditional diagnostic edges. Routing to Thinker Academy...',
        isStationary: true,
        activeNode: 'checkpoint_manager',
        activeModel: 'LangGraph Engine',
        telemetry: { tokenUsage: '340 / 25,000', slideProgress: '0 / 17', attempt: '1 / 4', status: 'running' },
      },
      {
        fromIndex: 3,
        toIndex: 4,
        actionText: 'Walking to Thinker Academy',
        thought: 'Heading into the library to formulate 17-slide strategic blueprint and grading rubrics...',
        isStationary: false,
        activeNode: 'extractor',
        activeModel: 'Claude 3.7 Sonnet',
        telemetry: { tokenUsage: '680 / 25,000', slideProgress: '0 / 17', attempt: '1 / 4', status: 'running' },
      },
      {
        fromIndex: 4,
        toIndex: 4,
        actionText: 'Formulating 17-Slide Plan',
        thought: 'Claude 3.7 Sonnet drafting slide-by-slide structure with IEEE citation criteria...',
        isStationary: true,
        activeNode: 'planner',
        activeModel: 'Claude 3.7 Sonnet',
        telemetry: { tokenUsage: '4,200 / 25,000', slideProgress: 'Blueprint Locked', attempt: '1 / 4', status: 'running' },
      },
      {
        fromIndex: 4,
        toIndex: 5,
        actionText: 'Walking to Model Dispatch Nexus',
        thought: 'Blueprint locked! Heading to Dispatch Nexus to route prompt to high-speed LPU inference...',
        isStationary: false,
        activeNode: 'model_router',
        activeModel: 'OpenRouter / Groq',
        telemetry: { tokenUsage: '4,650 / 25,000', slideProgress: 'Routing', attempt: '1 / 4', status: 'running' },
      },
      {
        fromIndex: 5,
        toIndex: 5,
        actionText: 'Routing Prompt via Groq LPU',
        thought: 'Dispatched prompt via Groq LPU at 480 tokens/sec. Compiling response payload...',
        isStationary: true,
        activeNode: 'token_budget_guard',
        activeModel: 'Groq Llama 3.3',
        telemetry: { tokenUsage: '7,800 / 25,000', slideProgress: 'Code Ready', attempt: '1 / 4', status: 'running' },
      },
      {
        fromIndex: 5,
        toIndex: 6,
        actionText: "Walking to Nisarg's Foundry",
        thought: 'Carrying generated python-pptx builder script to local PC for physical compilation...',
        isStationary: false,
        activeNode: 'coder',
        activeModel: 'Antigravity CLI (agy)',
        telemetry: { tokenUsage: '8,400 / 25,000', slideProgress: 'Compiling...', attempt: '1 / 4', status: 'running' },
      },
      {
        fromIndex: 6,
        toIndex: 6,
        actionText: 'Compiling 17 Slides via python-pptx',
        thought: 'Antigravity CLI running python-pptx compiler. Generating master corporate slide deck...',
        isStationary: true,
        activeNode: 'worker.worker',
        activeModel: 'Python 3.12 Local',
        telemetry: { tokenUsage: '8,400 / 25,000', slideProgress: '17 / 17 Generated', attempt: '1 / 4', status: 'running' },
      },
      {
        fromIndex: 6,
        toIndex: 8,
        actionText: 'Carrying Deck to QA Observatory',
        thought: 'Deck generated! Carrying master presentation to QA Observatory for rubric and link audits...',
        isStationary: false,
        activeNode: 'verifier',
        activeModel: 'QA Auditor',
        telemetry: { tokenUsage: '8,900 / 25,000', slideProgress: 'Auditing 17 slides', attempt: '1 / 4', status: 'running' },
      },
      {
        fromIndex: 8,
        toIndex: 8,
        actionText: 'Auditing Slide Count & Citations',
        thought: 'Slide count verified: exactly 17 slides! All 8 academic citations respond with HTTP 200.',
        isStationary: true,
        activeNode: 'slide_count_guard',
        activeModel: 'python-pptx Audit',
        telemetry: { tokenUsage: '8,900 / 25,000', slideProgress: '17 / 17 PASSED', attempt: '1 / 4', status: 'success' },
      },
      {
        fromIndex: 8,
        toIndex: 9,
        actionText: 'Walking to Shipping Dock',
        thought: 'Verification seal stamped! Carrying master files to Google Drive cloud shipping dock...',
        isStationary: false,
        activeNode: 'deliverer',
        activeModel: 'Google Drive API v3',
        telemetry: { tokenUsage: '9,200 / 25,000', slideProgress: '17 / 17 Verified', attempt: '1 / 4', status: 'running' },
      },
      {
        fromIndex: 9,
        toIndex: 9,
        actionText: 'Uploading to Drive & Telegram',
        thought: 'Google Drive upload complete. Google Calendar reminder set in IST. Telegram alert sent!',
        isStationary: true,
        activeNode: 'calendar_scheduler',
        activeModel: 'Drive + Telegram',
        telemetry: { tokenUsage: '9,450 / 25,000', slideProgress: '17 / 17 DELIVERED', attempt: '1 / 4', status: 'success' },
      },
      {
        fromIndex: 9,
        toIndex: 0,
        actionText: 'Mission Delivered. Journeying Home',
        thought: 'Academic directive 100% complete! Returning along the cobblestone avenue to rest.',
        isStationary: false,
        activeNode: 'END',
        activeModel: 'Vicarius Resting',
        telemetry: { tokenUsage: '9,450 / 25,000', slideProgress: 'Complete', attempt: '1 / 4 (Clean)', status: 'success' },
      },
    ],
  },
  self_healing: {
    id: 'self_healing',
    title: 'Self-Healing Diagnostic Recovery Loop',
    subtitle: 'QA slide count mismatch triggers Diagnoser hospital, repairs code, passes QA',
    badge: 'Self-Healing RCA',
    steps: [
      {
        fromIndex: 0,
        toIndex: 4,
        actionText: 'Planning & Building Initial Deck',
        thought: 'Directives received! Fast-tracking planning to generate initial presentation draft...',
        isStationary: false,
        activeNode: 'planner',
        activeModel: 'Claude 3.7 Sonnet',
        telemetry: { tokenUsage: '3,100 / 25,000', slideProgress: 'Initial Draft', attempt: '1 / 4', status: 'running' },
      },
      {
        fromIndex: 4,
        toIndex: 6,
        actionText: "Compiling Deck in Nisarg's Foundry",
        thought: 'Antigravity CLI synthesizes slides... loop encountered early termination in section 4.',
        isStationary: true,
        activeNode: 'coder',
        activeModel: 'Python 3.12',
        telemetry: { tokenUsage: '5,400 / 25,000', slideProgress: '14 Slides Built', attempt: '1 / 4', status: 'warning' },
      },
      {
        fromIndex: 6,
        toIndex: 8,
        actionText: 'Carrying Deck to QA Observatory',
        thought: 'Taking initial compilation to QA Observatory for slide count and rubric check...',
        isStationary: false,
        activeNode: 'verifier',
        activeModel: 'QA Gate',
        telemetry: { tokenUsage: '5,900 / 25,000', slideProgress: 'Checking...', attempt: '1 / 4', status: 'running' },
      },
      {
        fromIndex: 8,
        toIndex: 8,
        actionText: 'QA ALERT: Slide Count Mismatch (14/17)',
        thought: 'FAIL: PRD rubric specifies strictly 17 slides. Build only produced 14. Triggering self-healing...',
        isStationary: true,
        activeNode: 'verifier',
        activeModel: 'QA Gate Check',
        telemetry: { tokenUsage: '6,200 / 25,000', slideProgress: '14 / 17 (FAIL)', attempt: '1 / 4', status: 'warning' },
      },
      {
        fromIndex: 8,
        toIndex: 7,
        actionText: 'Rerouting to Self-Healing Clinic',
        thought: 'Emergency diversion to Self-Healing Diagnostic Hospital! Initializing Root-Cause Analysis...',
        isStationary: false,
        activeNode: 'diagnoser',
        activeModel: 'LOOP_ENGINEERING',
        telemetry: { tokenUsage: '6,800 / 25,000', slideProgress: 'Diagnostic Ingest', attempt: '2 / 4', status: 'warning' },
      },
      {
        fromIndex: 7,
        toIndex: 7,
        actionText: 'Diagnoser Performing Root-Cause Analysis',
        thought: 'RCA: Script loop index stopped at 14. Synthesizing surgical code patch to add missing 3 slides...',
        isStationary: true,
        activeNode: 'patch_synthesizer',
        activeModel: 'Diagnoser Node',
        telemetry: { tokenUsage: '9,100 / 25,000', slideProgress: 'Patch Synthesized', attempt: '2 / 4', status: 'warning' },
      },
      {
        fromIndex: 7,
        toIndex: 6,
        actionText: 'Carrying Surgical Patch to Foundry',
        thought: 'Patch synthesized! Walking back to Foundry for clean re-compilation (Attempt 2 of 4)...',
        isStationary: false,
        activeNode: 'coder',
        activeModel: 'Antigravity CLI',
        telemetry: { tokenUsage: '9,600 / 25,000', slideProgress: 'Applying Patch', attempt: '2 / 4', status: 'running' },
      },
      {
        fromIndex: 6,
        toIndex: 6,
        actionText: 'Recompiling with Self-Healed Patch',
        thought: 'Antigravity CLI re-executes with patch. All 17 slides generated with complete typography!',
        isStationary: true,
        activeNode: 'worker.worker',
        activeModel: 'Python 3.12 Local',
        telemetry: { tokenUsage: '11,200 / 25,000', slideProgress: '17 / 17 Generated', attempt: '2 / 4', status: 'running' },
      },
      {
        fromIndex: 6,
        toIndex: 8,
        actionText: 'Returning to QA Observatory',
        thought: 'Re-entering QA Observatory with healed 17-slide master presentation...',
        isStationary: false,
        activeNode: 'verifier',
        activeModel: 'QA Gate Re-check',
        telemetry: { tokenUsage: '11,600 / 25,000', slideProgress: 'Re-verifying', attempt: '2 / 4', status: 'running' },
      },
      {
        fromIndex: 8,
        toIndex: 8,
        actionText: 'QA Audit: PASSED 100%',
        thought: 'SUCCESS: Exactly 17 slides verified! Self-healing resolution verified in 1 retry attempt.',
        isStationary: true,
        activeNode: 'slide_count_guard',
        activeModel: 'QA Seal Approved',
        telemetry: { tokenUsage: '11,600 / 25,000', slideProgress: '17 / 17 PASSED', attempt: '2 / 4 (Healed)', status: 'success' },
      },
      {
        fromIndex: 8,
        toIndex: 9,
        actionText: 'Shipping Healed Presentation to Drive',
        thought: 'Uploading self-healed master deck to Google Drive and broadcasting Telegram completion payload.',
        isStationary: false,
        activeNode: 'deliverer',
        activeModel: 'Drive Upload',
        telemetry: { tokenUsage: '12,100 / 25,000', slideProgress: '17 / 17 DELIVERED', attempt: '2 / 4', status: 'success' },
      },
      {
        fromIndex: 9,
        toIndex: 0,
        actionText: 'Recovery Complete. Returning Home',
        thought: 'Delivered with self-healing audit trail intact! Returning home.',
        isStationary: false,
        activeNode: 'END',
        activeModel: 'Resting',
        telemetry: { tokenUsage: '12,100 / 25,000', slideProgress: 'Complete', attempt: '2 / 4 (Healed)', status: 'success' },
      },
    ],
  },
  classroom: {
    id: 'classroom',
    title: 'Google Classroom & Multi-Modal Ingest',
    subtitle: 'Coursework PDF extraction and dual PPTX + Word deliverable generation',
    badge: 'Multi-Modal Ingest',
    steps: [
      {
        fromIndex: 0,
        toIndex: 1,
        actionText: 'Checking Google Classroom & Gmail',
        thought: 'Scanning Google Classroom courseWork feed for CS-401 and parsing course syllabus announcements...',
        isStationary: false,
        activeNode: 'ingestor',
        activeModel: 'Classroom API',
        telemetry: { tokenUsage: '150 / 25,000', slideProgress: '0 / 17', attempt: '1 / 4', status: 'running' },
      },
      {
        fromIndex: 1,
        toIndex: 1,
        actionText: 'Extracting PDF Syllabus & Rubric',
        thought: 'Downloaded assignment attachment rubric.pdf. Parsing text constraints using pdf-parse engine...',
        isStationary: true,
        activeNode: 'pdf_extractor',
        activeModel: 'pdf-parse Local',
        telemetry: { tokenUsage: '650 / 25,000', slideProgress: 'PDF Extracted', attempt: '1 / 4', status: 'running' },
      },
      {
        fromIndex: 1,
        toIndex: 2,
        actionText: 'Committing Extracted Rubrics to Supabase',
        thought: 'Writing parsed grading rubrics to Supabase tasks table. Broadcasting realtime event...',
        isStationary: false,
        activeNode: 'state_writer',
        activeModel: 'Supabase Postgres',
        telemetry: { tokenUsage: '820 / 25,000', slideProgress: 'Rubric Saved', attempt: '1 / 4', status: 'running' },
      },
      {
        fromIndex: 2,
        toIndex: 4,
        actionText: 'Academy: Dual Deliverable Blueprint',
        thought: 'Thinker Academy designing dual blueprint: 17-slide corporate PPTX deck AND 8-page DOCX technical paper.',
        isStationary: true,
        activeNode: 'planner',
        activeModel: 'Gemini 2.5 Pro',
        telemetry: { tokenUsage: '4,500 / 25,000', slideProgress: 'Dual Blueprint', attempt: '1 / 4', status: 'running' },
      },
      {
        fromIndex: 4,
        toIndex: 6,
        actionText: "Foundry: Compiling PPTX and Word DOCX",
        thought: 'Antigravity CLI compiles both python-pptx presentation and python-docx report locally...',
        isStationary: true,
        activeNode: 'coder',
        activeModel: 'Python 3.12',
        telemetry: { tokenUsage: '8,200 / 25,000', slideProgress: 'Both Files Built', attempt: '1 / 4', status: 'running' },
      },
      {
        fromIndex: 6,
        toIndex: 8,
        actionText: 'QA Observatory: Multi-File Audit',
        thought: 'Verifying slide count = 17, DOCX page count = 8, and checking APA citation formatting...',
        isStationary: true,
        activeNode: 'verifier',
        activeModel: 'Multi-File QA',
        telemetry: { tokenUsage: '8,900 / 25,000', slideProgress: 'Both Verified', attempt: '1 / 4', status: 'success' },
      },
      {
        fromIndex: 8,
        toIndex: 9,
        actionText: 'Shipping Dual Package to Drive',
        thought: 'Uploading PPTX and DOCX to designated Google Drive folder. Booking submission calendar event!',
        isStationary: false,
        activeNode: 'deliverer',
        activeModel: 'Google Drive API v3',
        telemetry: { tokenUsage: '9,300 / 25,000', slideProgress: 'Uploaded 2 Files', attempt: '1 / 4', status: 'success' },
      },
      {
        fromIndex: 9,
        toIndex: 0,
        actionText: 'Coursework Complete. Returning Home',
        thought: 'Multi-modal assignment delivered! Vicarius returning to Telegram porch.',
        isStationary: false,
        activeNode: 'END',
        activeModel: 'Resting',
        telemetry: { tokenUsage: '9,300 / 25,000', slideProgress: 'Delivered', attempt: '1 / 4', status: 'success' },
      },
    ],
  },
};

// --- SVG Icons for Controls & UI (Zero Emojis) ---
const SvgPlayIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <polygon points="2,1 11,6 2,11" fill="currentColor" />
  </svg>
);

const SvgPauseIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <rect x="1.5" y="1.5" width="3" height="9" rx="1" fill="currentColor" />
    <rect x="7.5" y="1.5" width="3" height="9" rx="1" fill="currentColor" />
  </svg>
);

const SvgStepBackIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <rect x="1" y="1.5" width="1.8" height="9" rx="0.5" fill="currentColor" />
    <polygon points="11,1.5 4,6 11,10.5" fill="currentColor" />
  </svg>
);

const SvgStepForwardIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <polygon points="1,1.5 8,6 1,10.5" fill="currentColor" />
    <rect x="9.2" y="1.5" width="1.8" height="9" rx="0.5" fill="currentColor" />
  </svg>
);

const SvgResetIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path d="M 9.5 6 A 3.8 3.8 0 1 1 7.8 2.8" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    <polygon points="7,1 9.5,3.2 7,4" fill="currentColor" />
  </svg>
);

const SvgRefreshIcon = ({ spinning = false }: { spinning?: boolean }) => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 12 12"
    fill="none"
    style={{
      animation: spinning ? 'spin 1s linear infinite' : 'none',
      transformOrigin: 'center',
    }}
  >
    <path d="M 10 6 A 4 4 0 1 1 8.2 2.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    <polygon points="7,0.5 10,2.8 7,4" fill="currentColor" />
  </svg>
);

const SvgFullscreenIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path d="M1 4.5 V 1 H 4.5 M7.5 1 H 11 V 4.5 M11 7.5 V 11 H 7.5 M4.5 11 H 1 V 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const SvgSunIcon = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
    <circle cx="7" cy="7" r="3" stroke="currentColor" strokeWidth="1.4" />
    <line x1="7" y1="1" x2="7" y2="2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <line x1="7" y1="11.5" x2="7" y2="13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <line x1="1" y1="7" x2="2.5" y2="7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <line x1="11.5" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

const SvgMoonIcon = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
    <path d="M12 8.5 A 5.5 5.5 0 1 1 5.5 2 A 4.5 4.5 0 0 0 12 8.5 Z" stroke="currentColor" strokeWidth="1.3" fill="none" />
  </svg>
);

const SvgHeritageLampIcon = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
    <path d="M4 4 L10 4 L8.5 9 L5.5 9 Z" stroke="currentColor" strokeWidth="1.3" fill="none" />
    <line x1="7" y1="1" x2="7" y2="4" stroke="currentColor" strokeWidth="1.3" />
    <line x1="7" y1="9" x2="7" y2="13" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="7" cy="6.5" r="1.5" fill="currentColor" />
  </svg>
);

const SvgLivePulseIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="6" cy="6" r="2.2" fill="currentColor" />
  </svg>
);

const SvgCloseIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const SvgExternalLinkIcon = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
    <path d="M5 2 H2 A1 1 0 0 0 1 3 V10 A1 1 0 0 0 2 11 H9 A1 1 0 0 0 10 10 V7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <polyline points="7,1 11,1 11,5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="5" y1="7" x2="11" y2="1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

export function AgentWorld({
  tasks,
  selectedTask,
  onSelectTask,
  onRefresh,
  onTriggerIngest,
  onRetryTask,
  loading = false,
  ingesting = false,
  className = '',
  style = {},
}: AgentWorldProps) {
  // Default to live mode if real tasks exist in database
  const [mode, setMode] = useState<'live' | 'simulation'>('live');
  const [scenarioKey, setScenarioKey] = useState<string>('standard');
  const [simStepIndex, setSimStepIndex] = useState<number>(0);
  const [simProgress, setSimProgress] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [speedMultiplier, setSpeedMultiplier] = useState<number>(1);
  const [activeLandmarkDetail, setActiveLandmarkDetail] = useState<CampusLandmark | null>(null);
  const [ambience, setAmbience] = useState<'daylight' | 'heritage' | 'midnight'>('heritage');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [showInspector, setShowInspector] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-sync polling every 8s when in live mode
  useEffect(() => {
    if (mode === 'live' && onRefresh) {
      const interval = setInterval(() => {
        onRefresh();
      }, 8000);
      return () => clearInterval(interval);
    }
  }, [mode, onRefresh]);

  const handleManualRefresh = async () => {
    if (!onRefresh) return;
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  };

  const currentScenario = useMemo(() => {
    return SIMULATION_SCENARIOS[scenarioKey] || SIMULATION_SCENARIOS.standard;
  }, [scenarioKey]);

  // Derive active real task from selectedTask or pick the most active/recent task
  const activeTask = useMemo(() => {
    if (selectedTask) return selectedTask;
    const running = tasks.find((t) => ['claimed', 'building', 'verifying', 'extracting'].includes(t.status));
    if (running) return running;
    const queued = tasks.find((t) => t.status === 'queued' && !t.archived);
    if (queued) return queued;
    return tasks[0] || null;
  }, [tasks, selectedTask]);

  // Map the real task's actual database status to one of the 10 facilities
  const liveStageInfo = useMemo(() => {
    if (!activeTask) {
      return {
        landmarkIndex: 0,
        action: 'Idle at Telegram Base',
        thought: 'Campus quiet. Listening on Telegram bot webhook and student coursework channels...',
        node: 'START',
        model: 'Idle',
        status: 'idle' as const,
        deliverableCount: 0,
      };
    }

    const delivCount = activeTask.deliverables?.length || 0;

    switch (activeTask.status) {
      case 'done':
        return {
          landmarkIndex: 9, // Calendar Vault & Shipping Dock
          action: `Delivered: "${activeTask.title}"`,
          thought: delivCount > 0
            ? `All ${delivCount} deliverables uploaded to Google Drive with IST calendar reminders!`
            : `Task "${activeTask.title}" delivered to Google Drive and Telegram!`,
          node: 'deliverer',
          model: 'Google Drive v3 + Calendar API',
          status: 'success' as const,
          deliverableCount: delivCount,
        };
      case 'failed':
      case 'flagged':
        return {
          landmarkIndex: 7, // Self-Healing Diagnostic Hospital (Landmark 8)
          action: `Self-Healing Hospital: "${activeTask.title}"`,
          thought: activeTask.error_message
            ? `Failure diagnosed: "${activeTask.error_message.slice(0, 60)}...". Ready for surgical re-attempt.`
            : 'Directive flagged for diagnostic recovery. Click "Heal & Requeue" to dispatch fix.',
          node: 'diagnoser',
          model: 'LOOP_ENGINEERING RCA',
          status: 'warning' as const,
          deliverableCount: delivCount,
        };
      case 'building':
        return {
          landmarkIndex: 6, // Nisarg's Foundry & GPU Workshop (Landmark 7)
          action: `Foundry Compiling: "${activeTask.title}"`,
          thought: `Antigravity CLI executing (${activeTask.task_type || 'worker build'}). Synthesizing artifacts in work_dirs/...`,
          node: 'coder',
          model: 'Python 3.12 (Antigravity CLI)',
          status: 'running' as const,
          deliverableCount: delivCount,
        };
      case 'verifying':
        return {
          landmarkIndex: 8, // Verification Observatory (Landmark 9)
          action: `QA Observatory: "${activeTask.title}"`,
          thought: 'Auditing presentation slide counts, IEEE citation URLs, and format rubrics...',
          node: 'verifier',
          model: 'QA Gate Auditor',
          status: 'running' as const,
          deliverableCount: delivCount,
        };
      case 'claimed':
        return {
          landmarkIndex: 4, // Thinker & Research Academy (Landmark 5)
          action: `Academy Planning: "${activeTask.title}"`,
          thought: 'Claude 3.7 Sonnet deconstructing grading rubrics and drafting 17-slide execution blueprint...',
          node: 'planner',
          model: 'Claude 3.7 Sonnet',
          status: 'running' as const,
          deliverableCount: delivCount,
        };
      case 'queued':
        return {
          landmarkIndex: 2, // Supabase Hub (Landmark 3)
          action: `Queued in Supabase: "${activeTask.title}"`,
          thought: 'Directive committed to PostgreSQL ledger. Awaiting execution slot in worker build queue...',
          node: 'state_writer',
          model: 'Supabase Postgres',
          status: 'running' as const,
          deliverableCount: delivCount,
        };
      case 'extracting':
      case 'new':
        return {
          landmarkIndex: 1, // Google Classroom & Ingest Hub (Landmark 2)
          action: `Classroom Ingest: "${activeTask.title}"`,
          thought: 'Extracting assignment syllabus and PDF rubrics using pdf-parse engine...',
          node: 'ingestor',
          model: 'Classroom & Gmail Ingest',
          status: 'running' as const,
          deliverableCount: delivCount,
        };
      default:
        return {
          landmarkIndex: 0,
          action: `Resting: "${activeTask.title}"`,
          thought: 'Directive in resting queue. Ready for student instructions.',
          node: 'START',
          model: 'Idle',
          status: 'idle' as const,
          deliverableCount: delivCount,
        };
    }
  }, [activeTask]);

  // Simulation timer loop
  useEffect(() => {
    if (mode !== 'simulation' || !isPlaying) return;
    const intervalTime = 50 / speedMultiplier;
    const timer = setInterval(() => {
      setSimProgress((prev) => {
        const step = currentScenario.steps[simStepIndex];
        if (!step) return 0;
        const stepRate = step.isStationary ? 0.016 : 0.011;
        const next = prev + stepRate;
        if (next >= 1) {
          setSimStepIndex((currStep) => (currStep + 1) % currentScenario.steps.length);
          return 0;
        }
        return next;
      });
    }, intervalTime);
    return () => clearInterval(timer);
  }, [mode, isPlaying, simStepIndex, speedMultiplier, currentScenario]);

  // Reset progress when scenario changes
  const handleSelectScenario = (key: string) => {
    setScenarioKey(key);
    setSimStepIndex(0);
    setSimProgress(0);
    setIsPlaying(true);
  };

  const currentStep = useMemo(() => {
    return currentScenario.steps[simStepIndex] || currentScenario.steps[0];
  }, [currentScenario, simStepIndex]);

  // Agent character position along smooth Bézier curve
  const agentPos = useMemo(() => {
    let fromLm: CampusLandmark;
    let toLm: CampusLandmark;
    let t = 0;
    let isMoving = false;
    let facingLeft = false;

    if (mode === 'simulation') {
      fromLm = CAMPUS_LANDMARKS[currentStep.fromIndex];
      toLm = CAMPUS_LANDMARKS[currentStep.toIndex];
      t = simProgress;
      isMoving = !currentStep.isStationary;
      facingLeft = toLm.x < fromLm.x;
    } else {
      const lm = CAMPUS_LANDMARKS[liveStageInfo.landmarkIndex];
      fromLm = lm;
      toLm = lm;
      isMoving = false;
    }

    if (fromLm.id === toLm.id) {
      return { x: fromLm.x, y: fromLm.y + 48, isMoving, facingLeft };
    }

    const isLongReturn = (fromLm.id === 'shipping_port' || fromLm.id === 'qa_observatory') && toLm.id === 'telegram_base';
    const midX = (fromLm.x + toLm.x) / 2;
    const midY = isLongReturn ? 590 : (fromLm.y + toLm.y) / 2 - 35;
    const u = 1 - t;
    const x = u * u * fromLm.x + 2 * u * t * midX + t * t * toLm.x;
    const y = u * u * (fromLm.y + 48) + 2 * u * t * midY + t * t * (toLm.y + 48);
    return { x, y, isMoving, facingLeft };
  }, [mode, currentStep, simProgress, liveStageInfo]);

  const activeLandmarkId = mode === 'simulation'
    ? (currentStep.isStationary ? CAMPUS_LANDMARKS[currentStep.toIndex].id : null)
    : CAMPUS_LANDMARKS[liveStageInfo.landmarkIndex].id;

  const currentAction = mode === 'simulation' ? currentStep.actionText : liveStageInfo.action;
  const currentThought = mode === 'simulation' ? currentStep.thought : liveStageInfo.thought;
  const currentActiveNode = mode === 'simulation' ? currentStep.activeNode : liveStageInfo.node;
  const currentActiveModel = mode === 'simulation' ? currentStep.activeModel : liveStageInfo.model;

  // Cobblestone pathways connecting all 10 facilities in an academic quadrangle
  const campusPaths = [
    'M 110 360 C 140 280 180 200 240 190',
    'M 240 190 C 290 200 340 280 390 360',
    'M 390 360 C 430 280 470 200 520 190',
    'M 520 190 C 560 200 610 280 660 360',
    'M 660 360 C 700 280 750 200 800 190',
    'M 800 190 C 840 200 890 280 940 360',
    'M 940 360 C 990 300 1040 240 1090 220',
    'M 940 360 C 940 420 940 470 940 530',
    'M 1090 220 C 1080 380 1010 490 940 530',
    'M 1090 220 C 1110 290 1130 360 1140 430',
    'M 940 530 C 920 470 920 420 940 360',
    'M 1140 430 C 1000 600 400 610 110 360',
  ];

  // Ambience colors
  const ambienceStyles = {
    daylight: {
      bg: '#faf5ee',
      cardBg: 'linear-gradient(180deg, #fffcf8 0%, #fdf5ea 100%)',
      skyGradient: 'linear-gradient(to bottom, #f3f7fd 0%, #faefe1 100%)',
      pathStone: '#e3d7c5',
      pathHighlight: '#fdfaf5',
      waterColor: '#7ba9d8',
      treeColor: '#4d754f',
      textColor: '#231a0f',
      conduitColor: 'rgba(112, 87, 40, 0.45)',
    },
    heritage: {
      bg: '#f8efe3',
      cardBg: 'linear-gradient(180deg, #fffaf5 0%, #f7ebd9 100%)',
      skyGradient: 'linear-gradient(to bottom, #faf4ec 0%, #edd8bf 100%)',
      pathStone: '#d5c7b3',
      pathHighlight: '#f5ebe0',
      waterColor: '#5c8fb8',
      treeColor: '#5c5443',
      textColor: '#231a0f',
      conduitColor: 'var(--primary)',
    },
    midnight: {
      bg: '#14181f',
      cardBg: 'linear-gradient(180deg, #1b212b 0%, #11151c 100%)',
      skyGradient: 'linear-gradient(to bottom, #0d1219 0%, #17202d 100%)',
      pathStone: '#273142',
      pathHighlight: '#38465c',
      waterColor: '#2b5a84',
      treeColor: '#2d3d34',
      textColor: '#e8edf5',
      conduitColor: '#00e5ff',
    },
  }[ambience];

  // Render individual facility building
  const renderBuilding = (lm: CampusLandmark) => {
    const isActive = activeLandmarkId === lm.id;

    return (
      <g>
        {/* Pulsing Aura if active */}
        {isActive && (
          <ellipse
            cx="0"
            cy="10"
            rx="62"
            ry="48"
            fill={lm.color}
            opacity="0.32"
            className="landmark-active-aura"
          />
        )}

        {/* Ground Shadow */}
        <ellipse cx="0" cy="44" rx="46" ry="12" fill="#231a0f" opacity={ambience === 'midnight' ? 0.35 : 0.14} />

        {/* Building Foundation */}
        <rect
          x="-42"
          y="-14"
          width="84"
          height="54"
          rx="4"
          fill="url(#stoneWall)"
          stroke={isActive ? lm.color : 'var(--outline-variant)'}
          strokeWidth={isActive ? 2.2 : 1.4}
        />

        {/* Roof Structure */}
        {lm.id === 'telegram_base' && (
          <>
            <polygon points="-48,-14 0,-52 48,-14" fill="url(#roofBronze)" stroke="#5a4316" strokeWidth="1.5" />
            <rect x="22" y="-46" width="10" height="20" fill="#705728" />
            <ellipse cx="27" cy="-46" rx="5" ry="2" fill="#5a4316" />
            <circle cx="27" cy="-52" r="3" fill="#d1c5b6" opacity="0.5" />
          </>
        )}

        {lm.id === 'classroom_ingest' && (
          <>
            <polygon points="-46,-14 0,-48 46,-14" fill="#0F9D58" stroke="#0b6e3d" strokeWidth="1.5" />
            <rect x="-38" y="-12" width="76" height="4" fill="#ffdea9" />
          </>
        )}

        {lm.id === 'supabase_hub' && (
          <>
            <polygon points="0,-50 42,-26 42,26 0,50 -42,26 -42,-26" fill="url(#stoneWall)" stroke="#3ECF8E" strokeWidth="1.8" />
            <ellipse cx="0" cy="-62" rx="14" ry="4" fill="#3ECF8E" opacity="0.6" />
          </>
        )}

        {lm.id === 'langgraph_tower' && (
          <>
            <polygon points="-36,-14 -20,-58 20,-58 36,-14" fill="#00A67E" stroke="#007d5e" strokeWidth="1.5" />
            <line x1="0" y1="-58" x2="0" y2="-72" stroke="#00A67E" strokeWidth="2.5" />
            <circle cx="0" cy="-74" r="4" fill="#3ECF8E" />
          </>
        )}

        {lm.id === 'thinker_academy' && (
          <>
            <polygon points="-50,-14 0,-54 50,-14" fill="#D97757" stroke="#9e4c32" strokeWidth="1.5" />
            {[-32, -11, 11, 32].map((colX) => (
              <rect key={colX} x={colX} y="-12" width="5" height="52" fill="#fffaf5" stroke="#d1c5b6" strokeWidth="0.8" />
            ))}
          </>
        )}

        {lm.id === 'dispatch_nexus' && (
          <>
            <path d="M -36 -14 A 36 26 0 0 1 36 -14 Z" fill="#6366F1" stroke="#4338ca" strokeWidth="1.5" />
            <circle cx="0" cy="-34" r="6" fill="#818cf8" />
          </>
        )}

        {lm.id === 'coder_foundry' && (
          <>
            <polygon points="-48,-14 -38,-46 38,-46 48,-14" fill="#705728" stroke="#392f23" strokeWidth="1.5" />
            <rect x="-10" y="-54" width="20" height="8" rx="2" fill="#5a4316" />
          </>
        )}

        {lm.id === 'diagnostic_clinic' && (
          <>
            <polygon points="-46,-14 0,-48 46,-14" fill="#E67E22" stroke="#b45309" strokeWidth="1.5" />
            <rect x="-4" y="-38" width="8" height="18" fill="#fff" rx="1" />
            <rect x="-9" y="-33" width="18" height="8" fill="#fff" rx="1" />
          </>
        )}

        {lm.id === 'qa_observatory' && (
          <>
            <path d="M -34 -14 A 34 34 0 0 1 34 -14 Z" fill="#276A3C" stroke="#1b4929" strokeWidth="1.5" />
            <circle cx="0" cy="-36" r="8" fill="#4ade80" opacity="0.8" />
          </>
        )}

        {lm.id === 'shipping_port' && (
          <>
            <polygon points="-48,-14 0,-48 48,-14" fill="#4285F4" stroke="#1d4ed8" strokeWidth="1.5" />
            <line x1="0" y1="-48" x2="0" y2="-68" stroke="#1d4ed8" strokeWidth="2.5" />
            <circle cx="0" cy="-70" r="5" fill="#facc15" />
          </>
        )}

        {/* Windows & Doors */}
        <rect x="-10" y="14" width="20" height="26" rx="2" fill="#392f23" stroke="#231a0f" strokeWidth="1" />
        <circle cx="6" cy="27" r="1.5" fill="#ffdea9" />

        {/* Brand Icon Plaque (Authentic official brand vector inside clean white badge) */}
        <g transform="translate(0, -2)">
          <circle cx="0" cy="0" r="15" fill="#ffffff" stroke={lm.color} strokeWidth="1.8" filter="url(#shadowFilter)" />
          <g transform="translate(-9, -9)">
            <AppBrandBadge name={lm.brandIcons[0]} size={18} color={lm.color} />
          </g>
        </g>

        {/* Secondary brand badge for multi-tool facilities */}
        {lm.brandIcons.length > 1 && (
          <g transform="translate(22, 18)">
            <circle cx="0" cy="0" r="10" fill="#ffffff" stroke="var(--outline-variant)" strokeWidth="1.2" filter="url(#shadowFilter)" />
            <g transform="translate(-6, -6)">
              <AppBrandBadge name={lm.brandIcons[1]} size={12} />
            </g>
          </g>
        )}

        {/* Facility Title Tag under building */}
        <rect
          x="-58"
          y="50"
          width="116"
          height="20"
          rx="4"
          fill={ambience === 'midnight' ? '#1b2330' : '#fff8f4'}
          stroke={isActive ? lm.color : 'var(--outline-variant)'}
          strokeWidth={isActive ? 1.5 : 1}
        />
        <text
          x="0"
          y="64"
          textAnchor="middle"
          fontSize="9.2"
          fontWeight="700"
          fill={ambience === 'midnight' ? '#e2e8f0' : '#231a0f'}
          fontFamily="'Noto Serif', serif"
        >
          {lm.name.split(' ').slice(0, 2).join(' ')}
        </text>
      </g>
    );
  };

  return (
    <div
      ref={containerRef}
      className={`heritage-card ${className}`}
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: ambienceStyles.cardBg,
        border: '1px solid var(--outline-variant)',
        borderRadius: 12,
        padding: isFullscreen ? '32px 36px' : '24px 20px',
        boxShadow: 'var(--shadow-diffused)',
        transition: 'all 0.3s ease',
        ...style,
      }}
    >
      {/* ── Top Header & Command Deck ── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 16,
          marginBottom: 16,
          borderBottom: '1px solid var(--outline-variant)',
          paddingBottom: 16,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 6,
                background: 'linear-gradient(135deg, var(--primary) 0%, #8b6f3e 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                boxShadow: '0 2px 6px rgba(112, 87, 40, 0.25)',
              }}
            >
              <LangGraphBrandIcon size={18} color="#fff" />
            </div>
            <div>
              <h3
                style={{
                  fontFamily: "'Noto Serif', serif",
                  color: ambienceStyles.textColor,
                  margin: 0,
                  fontSize: '1.2rem',
                  fontWeight: 700,
                  letterSpacing: '-0.01em',
                }}
              >
                Living Agent Campus &mdash; Autonomous 10-Stage City
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 12,
                    background: mode === 'live' ? '#e2f0d9' : '#fff1e5',
                    color: mode === 'live' ? '#276a3c' : 'var(--primary)',
                    border: '1px solid currentColor',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  <SvgLivePulseIcon />
                  {mode === 'live' ? `Supabase Live Connected (${tasks.length} Directives)` : 'Scenario Simulation Tour'}
                </span>
                <span style={{ fontSize: '11px', color: 'var(--on-surface-variant)' }}>
                  10 Architectural Facilities &bull; Authentic Brand Tooling &bull; Zero Emojis
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Controls: Mode, Task Selector, Scenario, Ambience, Fullscreen */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Mode Switcher */}
          <div
            style={{
              display: 'inline-flex',
              background: 'var(--surface-container)',
              borderRadius: 6,
              padding: 3,
              border: '1px solid var(--outline-variant)',
            }}
          >
            <button
              type="button"
              onClick={() => setMode('live')}
              style={{
                padding: '6px 12px',
                border: 'none',
                borderRadius: 4,
                fontSize: '0.82rem',
                fontWeight: mode === 'live' ? 700 : 500,
                background: mode === 'live' ? 'var(--surface)' : 'transparent',
                color: mode === 'live' ? 'var(--primary)' : 'var(--on-surface-variant)',
                boxShadow: mode === 'live' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <SvgLivePulseIcon /> Live State
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('simulation');
                setIsPlaying(true);
              }}
              style={{
                padding: '6px 12px',
                border: 'none',
                borderRadius: 4,
                fontSize: '0.82rem',
                fontWeight: mode === 'simulation' ? 700 : 500,
                background: mode === 'simulation' ? 'var(--surface)' : 'transparent',
                color: mode === 'simulation' ? 'var(--primary)' : 'var(--on-surface-variant)',
                boxShadow: mode === 'simulation' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <SvgPlayIcon /> Tour Simulation
            </button>
          </div>

          {/* Real Task Selector Dropdown in Live Mode */}
          {mode === 'live' && tasks.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <select
                value={activeTask?.id || ''}
                onChange={(e) => {
                  const found = tasks.find((t) => t.id === e.target.value);
                  if (found && onSelectTask) onSelectTask(found);
                }}
                style={{
                  fontSize: '0.82rem',
                  padding: '6px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--outline-variant)',
                  background: 'var(--surface)',
                  color: 'var(--on-surface)',
                  fontWeight: 600,
                  cursor: 'pointer',
                  maxWidth: 240,
                }}
              >
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    [{t.status.toUpperCase()}] {t.title.slice(0, 24)}...
                  </option>
                ))}
              </select>

              {/* Sync Database Button */}
              {onRefresh && (
                <button
                  type="button"
                  onClick={handleManualRefresh}
                  disabled={loading || isRefreshing}
                  className="btn-heritage-secondary"
                  style={{ padding: '6px 10px', fontSize: '0.8rem', minHeight: 32 }}
                  title="Sync with Supabase tasks"
                >
                  <SvgRefreshIcon spinning={loading || isRefreshing} />
                  <span>{loading || isRefreshing ? 'Syncing...' : 'Sync'}</span>
                </button>
              )}

              {/* Ingest Button */}
              {onTriggerIngest && (
                <button
                  type="button"
                  onClick={onTriggerIngest}
                  disabled={ingesting}
                  className="btn-heritage-secondary"
                  style={{ padding: '6px 10px', fontSize: '0.8rem', minHeight: 32 }}
                  title="Scan Google Classroom & Gmail for new directives"
                >
                  <GoogleClassroomBrandIcon size={13} />
                  <span>{ingesting ? 'Scanning...' : 'Ingest'}</span>
                </button>
              )}
            </div>
          )}

          {/* Scenario Selector when in Simulation Mode */}
          {mode === 'simulation' && (
            <select
              value={scenarioKey}
              onChange={(e) => handleSelectScenario(e.target.value)}
              style={{
                fontSize: '0.82rem',
                padding: '6px 10px',
                borderRadius: 6,
                border: '1px solid var(--outline-variant)',
                background: 'var(--surface)',
                color: 'var(--on-surface)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <option value="standard">Scenario 1: Standard 17-Slide Delivery</option>
              <option value="self_healing">Scenario 2: Self-Healing & Diagnostic Loop</option>
              <option value="classroom">Scenario 3: Google Classroom & PDF Ingest</option>
            </select>
          )}

          {/* Ambience Lighting Mode Toggle */}
          <div
            style={{
              display: 'inline-flex',
              background: 'var(--surface-container-low)',
              borderRadius: 6,
              padding: 3,
              border: '1px solid var(--outline-variant)',
            }}
          >
            <button
              type="button"
              title="Daylight Academics"
              onClick={() => setAmbience('daylight')}
              style={{
                padding: '5px 8px',
                border: 'none',
                borderRadius: 4,
                background: ambience === 'daylight' ? 'var(--surface)' : 'transparent',
                color: ambience === 'daylight' ? 'var(--primary)' : 'var(--on-surface-variant)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <SvgSunIcon />
            </button>
            <button
              type="button"
              title="Cognitive Heritage (Evening)"
              onClick={() => setAmbience('heritage')}
              style={{
                padding: '5px 8px',
                border: 'none',
                borderRadius: 4,
                background: ambience === 'heritage' ? 'var(--surface)' : 'transparent',
                color: ambience === 'heritage' ? 'var(--primary)' : 'var(--on-surface-variant)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <SvgHeritageLampIcon />
            </button>
            <button
              type="button"
              title="Midnight Compute"
              onClick={() => setAmbience('midnight')}
              style={{
                padding: '5px 8px',
                border: 'none',
                borderRadius: 4,
                background: ambience === 'midnight' ? 'var(--surface)' : 'transparent',
                color: ambience === 'midnight' ? 'var(--primary)' : 'var(--on-surface-variant)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <SvgMoonIcon />
            </button>
          </div>

          {/* Fullscreen Expand Toggle */}
          <button
            type="button"
            title="Toggle Presentation View"
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="btn-heritage-secondary"
            style={{ padding: '6px 10px', fontSize: '0.8rem', minHeight: 32 }}
          >
            <SvgFullscreenIcon />
            <span style={{ fontSize: '11px', fontWeight: 600 }}>{isFullscreen ? 'Exit Full' : 'Present'}</span>
          </button>
        </div>
      </div>

      {/* ── Interactive Playback Bar (Simulation Mode) ── */}
      {mode === 'simulation' && (
        <div
          style={{
            background: 'var(--surface-container-low)',
            borderRadius: 8,
            border: '1px solid var(--outline-variant)',
            padding: '10px 14px',
            marginBottom: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                onClick={() => setIsPlaying(!isPlaying)}
                className="btn-heritage-primary"
                style={{ padding: '4px 12px', fontSize: '0.8rem', minHeight: 28, display: 'inline-flex', alignItems: 'center', gap: 5 }}
              >
                {isPlaying ? <SvgPauseIcon /> : <SvgPlayIcon />}
                <span>{isPlaying ? 'Pause' : 'Play'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSimStepIndex((curr) => (curr === 0 ? currentScenario.steps.length - 1 : curr - 1));
                  setSimProgress(0);
                }}
                className="btn-heritage-secondary"
                style={{ padding: '4px 8px', fontSize: '0.8rem', minHeight: 28 }}
                title="Previous Step"
              >
                <SvgStepBackIcon />
              </button>

              <button
                type="button"
                onClick={() => {
                  setSimStepIndex((curr) => (curr + 1) % currentScenario.steps.length);
                  setSimProgress(0);
                }}
                className="btn-heritage-secondary"
                style={{ padding: '4px 8px', fontSize: '0.8rem', minHeight: 28 }}
                title="Next Step"
              >
                <SvgStepForwardIcon />
              </button>

              <button
                type="button"
                onClick={() => {
                  setSimStepIndex(0);
                  setSimProgress(0);
                }}
                className="btn-heritage-secondary"
                style={{ padding: '4px 8px', fontSize: '0.8rem', minHeight: 28 }}
                title="Reset to Beginning"
              >
                <SvgResetIcon />
              </button>

              <div style={{ display: 'inline-flex', gap: 2, marginLeft: 6, background: 'var(--surface-container)', padding: 2, borderRadius: 4, border: '1px solid var(--outline-variant)' }}>
                {[0.5, 1, 2, 4].map((spd) => (
                  <button
                    key={spd}
                    type="button"
                    onClick={() => setSpeedMultiplier(spd)}
                    style={{
                      border: 'none',
                      padding: '2px 7px',
                      borderRadius: 3,
                      fontSize: '0.74rem',
                      fontWeight: speedMultiplier === spd ? 700 : 500,
                      background: speedMultiplier === spd ? 'var(--primary)' : 'transparent',
                      color: speedMultiplier === spd ? '#fff' : 'var(--on-surface-variant)',
                      cursor: 'pointer',
                    }}
                  >
                    {spd}x
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--on-surface-variant)', fontWeight: 600 }}>
                Step {simStepIndex + 1} of {currentScenario.steps.length} &mdash;{' '}
                <strong style={{ color: 'var(--on-surface)' }}>{currentScenario.title}</strong>
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 3, position: 'relative', marginTop: 2 }}>
            {currentScenario.steps.map((st, idx) => {
              const isPast = idx < simStepIndex;
              const isCurr = idx === simStepIndex;
              return (
                <div
                  key={idx}
                  onClick={() => {
                    setSimStepIndex(idx);
                    setSimProgress(0);
                  }}
                  title={`Step ${idx + 1}: ${st.actionText}`}
                  style={{
                    flex: 1,
                    height: 6,
                    borderRadius: 3,
                    background: isCurr
                      ? 'var(--primary)'
                      : isPast
                      ? 'var(--primary-container)'
                      : 'var(--outline-variant)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    position: 'relative',
                    opacity: isCurr ? 1 : isPast ? 0.8 : 0.4,
                  }}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* ── Live Quick Task Bar (Live Mode) ── */}
      {mode === 'live' && tasks.length > 0 && (
        <div
          style={{
            background: 'var(--surface-container-low)',
            borderRadius: 8,
            border: '1px solid var(--outline-variant)',
            padding: '8px 12px',
            marginBottom: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            overflowX: 'auto',
          }}
        >
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--primary)', flexShrink: 0 }}>
            Live Tasks:
          </span>
          {tasks.slice(0, 6).map((t) => {
            const isSel = activeTask?.id === t.id;
            const statusColor = t.status === 'done' ? '#276a3c' : t.status === 'failed' ? '#ba1a1a' : 'var(--primary)';
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onSelectTask && onSelectTask(t)}
                style={{
                  fontSize: '0.74rem',
                  padding: '3px 8px',
                  borderRadius: 4,
                  border: `1px solid ${isSel ? statusColor : 'var(--outline-variant)'}`,
                  background: isSel ? 'var(--surface)' : 'transparent',
                  color: isSel ? statusColor : 'var(--on-surface-variant)',
                  cursor: 'pointer',
                  fontWeight: isSel ? 700 : 500,
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  boxShadow: isSel ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, display: 'inline-block' }} />
                <span>{t.title.length > 22 ? t.title.slice(0, 20) + '...' : t.title}</span>
                {t.deliverables && t.deliverables.length > 0 && (
                  <span style={{ fontSize: '9px', background: 'var(--surface-container-high)', padding: '1px 4px', borderRadius: 4 }}>
                    {t.deliverables.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ── SVG Campus Map (10 Facilities Panoramic Canvas) ── */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          borderRadius: 8,
          border: '1px solid var(--outline-variant)',
          background: ambienceStyles.bg,
          backgroundImage: ambienceStyles.skyGradient,
          boxShadow: 'inset 0 2px 12px rgba(35, 26, 15, 0.08)',
          overflow: 'hidden',
        }}
      >
        <svg
          viewBox="0 0 1280 640"
          style={{ width: '100%', height: 'auto', display: 'block' }}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <linearGradient id="roofBronze" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#8b6f3e" />
              <stop offset="100%" stopColor="#5a4316" />
            </linearGradient>
            <linearGradient id="stoneWall" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={ambience === 'midnight' ? '#252f3f' : '#fff8f4'} />
              <stop offset="100%" stopColor={ambience === 'midnight' ? '#18202c' : '#ede1c8'} />
            </linearGradient>
            <radialGradient id="lampGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffdea9" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#e4c289" stopOpacity="0" />
            </radialGradient>
            <filter id="shadowFilter" x="-15%" y="-15%" width="130%" height="130%">
              <feDropShadow dx="0" dy="4" stdDeviation="5" floodColor="#231a0f" floodOpacity="0.14" />
            </filter>
            <filter id="agentGlow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur in="SourceAlpha" stdDeviation="4" result="blur" />
              <feFlood floodColor="#8b6f3e" floodOpacity="0.5" result="color" />
              <feComposite in="color" in2="blur" operator="in" result="glow" />
              <feMerge>
                <feMergeNode in="glow" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Ground Plaza / Academic Quadrangle Greens */}
          <ellipse cx="220" cy="270" rx="160" ry="70" fill={ambience === 'midnight' ? '#1c2533' : '#e8dec9'} opacity="0.45" />
          <ellipse cx="600" cy="280" rx="200" ry="85" fill={ambience === 'midnight' ? '#1c2533' : '#e8dec9'} opacity="0.45" />
          <ellipse cx="1020" cy="300" rx="180" ry="75" fill={ambience === 'midnight' ? '#1c2533' : '#e8dec9'} opacity="0.45" />
          <ellipse cx="640" cy="570" rx="460" ry="50" fill={ambience === 'midnight' ? '#17202c' : '#dfd2ba'} opacity="0.35" />

          {/* Central Knowledge Fountain in Courtyard */}
          <g transform="translate(640, 275)">
            <ellipse cx="0" cy="6" rx="36" ry="16" fill={ambienceStyles.waterColor} opacity="0.65" />
            <ellipse cx="0" cy="6" rx="42" ry="19" fill="none" stroke="var(--outline-variant)" strokeWidth="1.8" />
            <circle cx="0" cy="0" r="10" fill="url(#stoneWall)" stroke="var(--outline-variant)" strokeWidth="1" />
            <line x1="0" y1="0" x2="0" y2="-16" stroke={ambienceStyles.waterColor} strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="0" cy="-18" r="3" fill="#ffffff" opacity="0.8" />
          </g>

          {/* Heritage Trees & Garden Shrubs */}
          {[
            { cx: 60, cy: 260, r: 18 },
            { cx: 170, cy: 120, r: 16 },
            { cx: 330, cy: 220, r: 18 },
            { cx: 460, cy: 110, r: 17 },
            { cx: 720, cy: 120, r: 17 },
            { cx: 880, cy: 220, r: 18 },
            { cx: 1020, cy: 110, r: 18 },
            { cx: 1220, cy: 280, r: 22 },
            { cx: 330, cy: 510, r: 16 },
            { cx: 760, cy: 530, r: 18 },
            { cx: 1100, cy: 550, r: 16 },
          ].map((tree, idx) => (
            <g key={`tree-${idx}`} opacity="0.55">
              <ellipse cx={tree.cx} cy={tree.cy + tree.r} rx={tree.r * 0.8} ry={5} fill="#231a0f" opacity="0.12" />
              <circle cx={tree.cx} cy={tree.cy} r={tree.r} fill={ambienceStyles.treeColor} />
              <circle cx={tree.cx - 2} cy={tree.cy - 3} r={tree.r * 0.75} fill={ambience === 'midnight' ? '#3d5246' : '#7b735d'} opacity="0.38" />
            </g>
          ))}

          {/* Cobblestone Garden Walkways (Base road layer) */}
          {campusPaths.map((d, idx) => (
            <g key={`path-${idx}`}>
              <path d={d} fill="none" stroke={ambienceStyles.pathStone} strokeWidth="18" strokeLinecap="round" />
              <path d={d} fill="none" stroke={ambienceStyles.pathHighlight} strokeWidth="12" strokeLinecap="round" />
            </g>
          ))}

          {/* Animated Glowing Conduits (Signal pulses along active paths) */}
          {campusPaths.map((d, idx) => (
            <path
              key={`pulse-${idx}`}
              d={d}
              fill="none"
              stroke={ambienceStyles.conduitColor}
              strokeWidth="2.2"
              className="waypoint-active-path"
              opacity="0.6"
            />
          ))}

          {/* Heritage Street Lanterns */}
          {[
            { x: 190, y: 280 },
            { x: 320, y: 280 },
            { x: 450, y: 280 },
            { x: 590, y: 200 },
            { x: 730, y: 280 },
            { x: 870, y: 280 },
            { x: 1010, y: 280 },
            { x: 1020, y: 440 },
            { x: 500, y: 550 },
          ].map((lamp, idx) => (
            <g key={`lamp-${idx}`} transform={`translate(${lamp.x}, ${lamp.y})`}>
              <ellipse cx="0" cy="12" rx="4" ry="1.5" fill="#231a0f" opacity="0.15" />
              <line x1="0" y1="12" x2="0" y2="-12" stroke="#5a4316" strokeWidth="1.8" />
              <circle cx="0" cy="-14" r="3.5" fill="#ffd166" />
              <circle cx="0" cy="-14" r="10" fill="url(#lampGlow)" opacity={ambience === 'midnight' ? 0.9 : 0.4} />
            </g>
          ))}

          {/* Render All 10 Campus Landmark Facilities */}
          {CAMPUS_LANDMARKS.map((lm, idx) => (
            <g
              key={lm.id}
              transform={`translate(${lm.x}, ${lm.y})`}
              filter="url(#shadowFilter)"
              style={{ cursor: 'pointer' }}
              onClick={() => {
                setActiveLandmarkDetail(lm);
                setShowInspector(true);
              }}
            >
              {renderBuilding(lm)}
              <circle cx="-38" cy="-10" r="9" fill={lm.color} />
              <text x="-38" y="-7" textAnchor="middle" fontSize="9" fontWeight="800" fill="#fff" fontFamily="'Manrope', sans-serif">
                {idx + 1}
              </text>
            </g>
          ))}

          {/* Animated Agent Character (Vicarius in academic coat) */}
          <g transform={`translate(${agentPos.x}, ${agentPos.y})`} filter="url(#agentGlow)">
            {agentPos.isMoving && (
              <g opacity="0.6">
                <circle cx={agentPos.facingLeft ? 18 : -18} cy="8" r="3" fill="#d1c5b6" />
                <circle cx={agentPos.facingLeft ? 24 : -24} cy="5" r="2" fill="#d1c5b6" />
              </g>
            )}

            {/* Ground Shadow */}
            <ellipse cx="0" cy="13" rx="14" ry="4" fill="#231a0f" opacity="0.25" />

            {/* Character Body Structure */}
            <g transform={agentPos.facingLeft ? 'scale(-1, 1)' : 'scale(1, 1)'} className={agentPos.isMoving ? 'agent-walking' : 'agent-idle'}>
              {/* Legs */}
              <line x1="-4" y1="2" x2="-5" y2="10" stroke="#392f23" strokeWidth="3.5" strokeLinecap="round" />
              <rect x="-7" y="9" width="5" height="3" rx="1" fill="#231a0f" />
              <line x1="4" y1="2" x2="5" y2="10" stroke="#392f23" strokeWidth="3.5" strokeLinecap="round" />
              <rect x="3" y="9" width="5" height="3" rx="1" fill="#231a0f" />

              {/* Cognitive Heritage Coat */}
              <path d="M -10 -14 L -12 2 L 12 2 L 10 -14 Z" fill="#705728" stroke="#392f23" strokeWidth="1" />

              {/* Research Satchel */}
              <rect x="6" y="-8" width="8" height="10" rx="1" fill="#8b6f3e" stroke="#5a4316" strokeWidth="1" />
              <line x1="6" y1="-4" x2="14" y2="-4" stroke="#ffdea9" strokeWidth="0.8" />
              <line x1="-8" y1="-14" x2="6" y2="-4" stroke="#5a4316" strokeWidth="1.2" />

              {/* Shirt & Tie */}
              <polygon points="-4,-14 0,-9 4,-14" fill="#fff" />
              <polygon points="-2,-11 0,-6 2,-11" fill="#ba1a1a" />

              {/* Head & Glasses */}
              <circle cx="0" cy="-20" r="7" fill="#fcd7b6" />
              <rect x="-4" y="-22" width="3.5" height="3" rx="0.5" fill="none" stroke="#392f23" strokeWidth="0.8" />
              <rect x="0.5" y="-22" width="3.5" height="3" rx="0.5" fill="none" stroke="#392f23" strokeWidth="0.8" />
              <line x1="-0.5" y1="-21" x2="0.5" y2="-21" stroke="#392f23" strokeWidth="0.8" />

              {/* Academic Cap */}
              <polygon points="-9,-25 0,-30 9,-25 0,-21" fill="#231a0f" />
              <circle cx="0" cy="-30" r="1.5" fill="#e4c289" />
              <line x1="0" y1="-30" x2="7" y2="-25" stroke="#e4c289" strokeWidth="0.8" />
            </g>

            {/* Dynamic Thought Bubble above Vicarius */}
            <g transform="translate(0, -52)" className="agent-thought-bubble">
              <polygon points="-4,0 0,6 4,0" fill="#fff8f4" stroke="#d1c5b6" strokeWidth="1" />
              <line x1="-3" y1="0" x2="3" y2="0" stroke="#fff8f4" strokeWidth="2" />
              <rect
                x="-125"
                y="-34"
                width="250"
                height="34"
                rx="6"
                fill="#fff8f4"
                stroke="var(--primary)"
                strokeWidth="1.4"
                filter="url(#shadowFilter)"
              />
              <circle cx="-107" cy="-17" r="8" fill="var(--primary)" />
              <text x="-107" y="-14" textAnchor="middle" fontSize="9" fill="#fff" fontWeight="800">
                V
              </text>
              <text
                x="-93"
                y="-14"
                fontSize="9.5"
                fontWeight="700"
                fill="#231a0f"
                fontFamily="'Manrope', sans-serif"
              >
                {currentAction.length > 34 ? currentAction.slice(0, 32) + '...' : currentAction}
              </text>
            </g>
          </g>
        </svg>
      </div>

      {/* ── Live Telemetry & Diagnostics HUD ── */}
      <div
        style={{
          marginTop: 16,
          background: 'var(--surface-container-low)',
          border: '1px solid var(--outline-variant)',
          borderRadius: 8,
          padding: '14px 18px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 16,
          alignItems: 'center',
        }}
      >
        {/* Vicarius Agent Status & Streaming Thought */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: 'var(--primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                flexShrink: 0,
                boxShadow: '0 2px 6px rgba(112, 87, 40, 0.25)',
              }}
            >
              <LangChainBrandIcon size={20} color="#fff" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    fontSize: '0.94rem',
                    fontWeight: 700,
                    color: 'var(--on-surface)',
                    fontFamily: "'Noto Serif', serif",
                  }}
                >
                  Vicarius: {currentAction}
                </span>
                <span
                  style={{
                    fontSize: '10px',
                    padding: '2px 8px',
                    borderRadius: 10,
                    background: liveStageInfo.status === 'success' ? '#e2f0d9' : liveStageInfo.status === 'warning' ? '#ffebec' : '#fff1e5',
                    color: liveStageInfo.status === 'success' ? '#276a3c' : liveStageInfo.status === 'warning' ? '#ba1a1a' : 'var(--primary)',
                    fontWeight: 700,
                  }}
                >
                  {mode === 'live' ? `Live: ${activeTask?.status.toUpperCase() || 'IDLE'}` : (agentPos.isMoving ? 'In Transit' : 'At Facility')}
                </span>
              </div>
              <p
                style={{
                  fontSize: '0.84rem',
                  color: 'var(--on-surface-variant)',
                  margin: '2px 0 0 0',
                  fontStyle: 'italic',
                }}
              >
                &ldquo;{currentThought}&rdquo;
              </p>
            </div>
          </div>
        </div>

        {/* Live Execution Variables Pill Grid */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--outline-variant)',
              borderRadius: 6,
              padding: '4px 10px',
            }}
          >
            <span style={{ fontSize: '10px', color: 'var(--on-surface-variant)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              LangGraph Node
            </span>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, fontFamily: 'monospace', color: 'var(--primary)' }}>
              {currentActiveNode}
            </span>
          </div>

          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--outline-variant)',
              borderRadius: 6,
              padding: '4px 10px',
            }}
          >
            <span style={{ fontSize: '10px', color: 'var(--on-surface-variant)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Engine / Model
            </span>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--on-surface)' }}>
              {currentActiveModel}
            </span>
          </div>

          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--outline-variant)',
              borderRadius: 6,
              padding: '4px 10px',
            }}
          >
            <span style={{ fontSize: '10px', color: 'var(--on-surface-variant)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Deliverables
            </span>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#276a3c' }}>
              {mode === 'live' ? `${liveStageInfo.deliverableCount} Produced` : currentStep.telemetry.slideProgress}
            </span>
          </div>

          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--outline-variant)',
              borderRadius: 6,
              padding: '4px 10px',
            }}
          >
            <span style={{ fontSize: '10px', color: 'var(--on-surface-variant)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Sync Status
            </span>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: mode === 'live' ? '#276a3c' : 'var(--primary)' }}>
              {mode === 'live' ? 'Supabase Realtime' : 'Simulated'}
            </span>
          </div>

          {/* Action Button if live task failed */}
          {mode === 'live' && activeTask && (activeTask.status === 'failed' || activeTask.status === 'flagged') && onRetryTask && (
            <button
              type="button"
              onClick={() => onRetryTask(activeTask.id)}
              className="btn-heritage-primary"
              style={{ padding: '4px 12px', fontSize: '0.78rem', minHeight: 28 }}
            >
              Heal &amp; Requeue Task
            </button>
          )}
        </div>

        {/* Facility Quick Jump Buttons */}
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', gridColumn: '1 / -1', borderTop: '1px solid var(--outline-variant)', paddingTop: 10 }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--primary)', alignSelf: 'center', marginRight: 6 }}>
            Facilities:
          </span>
          {CAMPUS_LANDMARKS.map((lm, idx) => {
            const isCurr = activeLandmarkId === lm.id;
            return (
              <button
                key={lm.id}
                type="button"
                onClick={() => {
                  setActiveLandmarkDetail(lm);
                  setShowInspector(true);
                }}
                style={{
                  fontSize: '0.74rem',
                  padding: '3px 8px',
                  borderRadius: 4,
                  border: `1px solid ${isCurr ? lm.color : 'var(--outline-variant)'}`,
                  background: isCurr ? lm.color : 'var(--surface)',
                  color: isCurr ? '#fff' : 'var(--on-surface-variant)',
                  cursor: 'pointer',
                  fontWeight: isCurr ? 700 : 500,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  transition: 'all 0.15s ease',
                }}
              >
                <span style={{ fontSize: '9px', fontWeight: 800 }}>{idx + 1}</span>
                <span>{lm.name.split(' ')[0]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Landmark Deep-Dive Inspector Drawer ── */}
      {showInspector && activeLandmarkDetail && (
        <div
          style={{
            marginTop: 16,
            background: 'var(--surface)',
            border: '1px solid var(--outline)',
            borderRadius: 8,
            padding: '18px 22px',
            boxShadow: 'var(--shadow-modal)',
            animation: 'fadeIn 0.2s ease',
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 8,
                  background: 'var(--surface-container)',
                  border: `1.5px solid ${activeLandmarkDetail.color}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <AppBrandBadge name={activeLandmarkDetail.brandIcons[0]} size={24} color={activeLandmarkDetail.color} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <h4 style={{ fontFamily: "'Noto Serif', serif", margin: 0, color: 'var(--on-surface)', fontSize: '1.1rem', fontWeight: 700 }}>
                    {activeLandmarkDetail.name}
                  </h4>
                  <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: 10, background: 'var(--surface-container)', color: 'var(--primary)', fontWeight: 600 }}>
                    {activeLandmarkDetail.stageName}
                  </span>
                </div>
                <p style={{ fontSize: '0.86rem', color: 'var(--on-surface-variant)', margin: '3px 0 0 0' }}>
                  {activeLandmarkDetail.subtitle} &mdash; {activeLandmarkDetail.description}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowInspector(false)}
              style={{ background: 'none', border: 'none', color: 'var(--on-surface-variant)', cursor: 'pointer', padding: 6, display: 'flex', alignItems: 'center' }}
            >
              <SvgCloseIcon />
            </button>
          </div>

          {/* If a real task is active at this landmark in live mode, display its live dossier! */}
          {mode === 'live' && activeTask && activeLandmarkId === activeLandmarkDetail.id && (
            <div
              style={{
                background: 'var(--surface-container-high)',
                border: '1px solid var(--outline-variant)',
                borderRadius: 6,
                padding: '12px 14px',
                marginBottom: 14,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Live Active Task at this Facility
                </span>
                <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: '#276a3c', color: '#fff' }}>
                  {activeTask.status.toUpperCase()}
                </span>
              </div>
              <h5 style={{ margin: '0 0 4px 0', fontSize: '0.96rem', color: 'var(--on-surface)' }}>
                {activeTask.title}
              </h5>
              <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--on-surface-variant)' }}>
                Task Type: <strong>{activeTask.task_type}</strong> | Due Date: <strong>{activeTask.due_date || 'None'}</strong> | Posted: <strong>{activeTask.posted_date || 'Recent'}</strong>
              </p>

              {/* Real Deliverables List */}
              {activeTask.deliverables && activeTask.deliverables.length > 0 && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--outline-variant)' }}>
                  <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--on-surface-variant)' }}>
                    Live Deliverables ({activeTask.deliverables.length}):
                  </span>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                    {activeTask.deliverables.slice(0, 4).map((d: Deliverable) => (
                      <a
                        key={d.id}
                        href={d.drive_link || '#'}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          fontSize: '0.76rem',
                          padding: '2px 8px',
                          borderRadius: 4,
                          background: 'var(--surface)',
                          border: '1px solid var(--outline-variant)',
                          color: 'var(--primary)',
                          textDecoration: 'none',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <GoogleDriveBrandIcon size={12} />
                        <span>{d.file_name}</span>
                        <SvgExternalLinkIcon />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Operational Metrics Bar */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 10,
              padding: '10px 14px',
              background: 'var(--surface-container-low)',
              borderRadius: 6,
              border: '1px solid var(--outline-variant)',
              marginBottom: 14,
            }}
          >
            <div>
              <span style={{ fontSize: '10px', color: 'var(--on-surface-variant)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Service Uptime</span>
              <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#276a3c' }}>{activeLandmarkDetail.metrics.uptime}</div>
            </div>
            <div>
              <span style={{ fontSize: '10px', color: 'var(--on-surface-variant)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Average Latency</span>
              <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--primary)' }}>{activeLandmarkDetail.metrics.avgLatency}</div>
            </div>
            <div>
              <span style={{ fontSize: '10px', color: 'var(--on-surface-variant)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Operational Throughput</span>
              <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--on-surface)' }}>{activeLandmarkDetail.metrics.throughput}</div>
            </div>
          </div>

          {/* 4-Quadrant Technical Dossier */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14, borderTop: '1px solid var(--outline-variant)', paddingTop: 14 }}>
            <div>
              <span style={{ fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--primary)', display: 'block', marginBottom: 6 }}>
                LangGraph StateGraph Nodes
              </span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {activeLandmarkDetail.langGraphNodes.map((node) => (
                  <span key={node} style={{ fontSize: '0.78rem', fontFamily: 'monospace', background: 'var(--surface-container-high)', padding: '3px 8px', borderRadius: 4, color: 'var(--on-surface)', border: '1px solid var(--outline-variant)' }}>
                    {node}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <span style={{ fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--primary)', display: 'block', marginBottom: 6 }}>
                Official Integrated Tools & Brand APIs
              </span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {activeLandmarkDetail.toolsUsed.map((tool) => (
                  <span key={tool} style={{ fontSize: '0.78rem', background: '#fff', padding: '3px 8px', borderRadius: 4, color: 'var(--on-surface)', border: '1px solid var(--outline-variant)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <AppBrandBadge name={tool.split(' ')[0]} size={13} />
                    <span>{tool}</span>
                  </span>
                ))}
              </div>
            </div>

            <div>
              <span style={{ fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--primary)', display: 'block', marginBottom: 6 }}>
                Node Ingestion Contract (JSON)
              </span>
              <pre style={{ margin: 0, fontSize: '0.74rem', background: '#0d1117', color: '#58a6ff', padding: '8px 10px', borderRadius: 6, overflowX: 'auto', fontFamily: 'monospace' }}>
                {activeLandmarkDetail.inputSchema}
              </pre>
            </div>

            <div>
              <span style={{ fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--primary)', display: 'block', marginBottom: 6 }}>
                State Transition Payload (JSON)
              </span>
              <pre style={{ margin: 0, fontSize: '0.74rem', background: '#0d1117', color: '#7ee787', padding: '8px 10px', borderRadius: 6, overflowX: 'auto', fontFamily: 'monospace' }}>
                {activeLandmarkDetail.outputSchema}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
