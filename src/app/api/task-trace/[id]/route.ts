// GET /api/task-trace/[id]
// Returns a full enriched pipeline trace for a single task:
// task record + extracted_requirements + deliverables + questions + system_events
// Used by the Task Flow dashboard tab.

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { ApiResponse } from '@/lib/types';
import { isRequestAuthorized } from '@/lib/auth';

export interface TaskTrace {
  task: Record<string, any>;
  deliverables: Array<{
    id: string;
    file_name: string;
    drive_link: string | null;
    file_type: string | null;
    delivered_via: string | null;
    delivered_at: string;
  }>;
  questions: Array<{
    id: string;
    question_text: string;
    answer_text: string | null;
    status: string;
    asked_at: string;
    answered_at: string | null;
  }>;
  systemEvents: Array<{
    id: string;
    level: string;
    component: string;
    message: string;
    created_at: string;
  }>;
  pipelineNodes: PipelineNodeTrace[];
}

export interface PipelineNodeTrace {
  id: string;
  name: string;
  subtitle: string;
  status: 'done' | 'active' | 'pending' | 'retry' | 'skipped' | 'error';
  detail: string;
  retryCount?: number;
  qualityScore?: number;
  attemptCount?: number;
  order: number;
}

function inferPipelineNodes(task: Record<string, any>): PipelineNodeTrace[] {
  const status = task.status as string;
  const req = task.extracted_requirements || {};

  // Determine which stage is active/done based on task status
  const stageOrder = [
    'ingest',
    'extractor',
    'planner',
    'thinker',
    'thinker_validator',
    'coder',
    'verifier',
    'deliverer',
    'escalator',
  ];

  const stageByStatus: Record<string, number> = {
    new: 0,
    extracting: 1,
    queued: 2,
    claimed: 3,
    building: 5,
    verifying: 6,
    done: 7,
    failed: 8,
    flagged: 8,
  };

  const activeStageIdx = stageByStatus[status] ?? 0;

  const thinkerRetries = req.thinker_retries ?? 0;
  const thinkerScore = req.thinker_quality_score ?? null;
  const verificationScore = req.verification_score ?? null;
  const verificationPassed = req.verification_passed ?? null;
  const attempt = req.attempt ?? 1;
  const maxAttempts = req.max_attempts ?? 4;

  const nodes: PipelineNodeTrace[] = [
    {
      order: 0,
      id: 'ingest',
      name: 'Telegram / Gmail Ingest',
      subtitle: 'API Webhook → Supabase tasks table',
      status: activeStageIdx >= 0 ? 'done' : 'pending',
      detail:
        activeStageIdx >= 0
          ? `Task ingested from ${task.source?.toUpperCase() ?? 'source'}. External ID: ${task.external_id ?? 'N/A'}.`
          : 'Awaiting ingest.',
    },
    {
      order: 1,
      id: 'extractor',
      name: 'Extractor Node',
      subtitle: 'PDF download, text extraction, weight re-evaluation',
      status:
        activeStageIdx > 1 ? 'done' : activeStageIdx === 1 ? 'active' : 'pending',
      detail:
        activeStageIdx > 1
          ? req.raw_text
            ? `Extracted ${req.raw_text.length.toLocaleString()} characters from attachments. Task type: ${task.task_type}. Weight: ${task.weight}.`
            : `Requirements extracted. Task type: ${task.task_type}. Weight: ${task.weight}.`
          : activeStageIdx === 1
          ? task.progress_note || 'Downloading attachments and extracting text...'
          : 'Waiting for prior stage.',
    },
    {
      order: 2,
      id: 'planner',
      name: 'Planner Node',
      subtitle: 'Execution plan — deliverable files, steps, acceptance criteria',
      status:
        activeStageIdx > 2 ? 'done' : activeStageIdx === 2 ? 'active' : 'pending',
      detail:
        activeStageIdx > 2
          ? task.build_spec
            ? `Build spec generated (${task.build_spec.length} chars). Success criteria defined.`
            : 'Execution plan complete.'
          : activeStageIdx === 2
          ? task.progress_note || 'Formulating step-by-step execution plan...'
          : 'Waiting for prior stage.',
    },
    {
      order: 3,
      id: 'thinker',
      name: 'Thinker Node',
      subtitle: 'Pre-prompt deep reasoning (Claude 3.7 / Gemini 2.5)',
      status:
        activeStageIdx > 4
          ? thinkerRetries > 0
            ? 'retry'
            : 'done'
          : activeStageIdx >= 3 && activeStageIdx <= 4
          ? 'active'
          : 'pending',
      detail:
        activeStageIdx > 4
          ? `Deep reasoning complete.${thinkerRetries > 0 ? ` Quality retry loop ran ${thinkerRetries}x.` : ''}`
          : activeStageIdx >= 3 && activeStageIdx <= 4
          ? task.progress_note || 'Running deep reasoning loop...'
          : 'Waiting for prior stage.',
      retryCount: thinkerRetries,
      qualityScore: thinkerScore,
    },
    {
      order: 4,
      id: 'thinker_validator',
      name: 'Thinker Validator',
      subtitle: 'Quality gate: score ≥ 0.85 required to proceed',
      status:
        activeStageIdx > 4 ? 'done' : activeStageIdx === 4 ? 'active' : 'pending',
      detail:
        activeStageIdx > 4
          ? thinkerScore !== null
            ? `Quality score: ${(thinkerScore * 100).toFixed(0)}% — ${thinkerScore >= 0.85 ? 'Passed' : 'Threshold met after retries'}.`
            : 'Validation passed.'
          : activeStageIdx === 4
          ? task.progress_note || 'Scoring reasoning quality...'
          : 'Waiting for prior stage.',
      qualityScore: thinkerScore,
    },
    {
      order: 5,
      id: 'coder',
      name: 'Coder Node — Antigravity CLI',
      subtitle: `agy CLI on Local Worker + fallback ReAct tool loop`,
      status:
        activeStageIdx > 5
          ? attempt > 1
            ? 'retry'
            : 'done'
          : activeStageIdx === 5
          ? 'active'
          : 'pending',
      detail:
        activeStageIdx > 5
          ? `Deliverables compiled.${attempt > 1 ? ` Took ${attempt} attempt(s) of ${maxAttempts} max.` : ''} ${task.result_summary ? task.result_summary.slice(0, 120) : ''}`
          : activeStageIdx === 5
          ? task.progress_note || `Running Antigravity CLI... Attempt ${attempt} of ${maxAttempts}.`
          : 'Waiting for prior stage.',
      attemptCount: attempt,
    },
    {
      order: 6,
      id: 'verifier',
      name: 'Verifier Node',
      subtitle: 'Slide count, citation HTTP checks, format audit',
      status:
        activeStageIdx > 6
          ? verificationPassed === false
            ? 'error'
            : 'done'
          : activeStageIdx === 6
          ? 'active'
          : activeStageIdx === 5 && attempt > 1
          ? 'retry'
          : 'pending',
      detail:
        activeStageIdx > 6
          ? verificationScore !== null
            ? `Verification score: ${(verificationScore * 100).toFixed(0)}% — ${verificationPassed ? 'Passed' : 'Failed (sent to Diagnoser)'}.`
            : verificationPassed
            ? 'Verification passed.'
            : 'Verification ran.'
          : activeStageIdx === 6
          ? task.progress_note || 'Running rubric checks and citation validation...'
          : activeStageIdx === 5 && attempt > 1
          ? `Previous verification score: ${(verificationScore ? verificationScore * 100 : 0).toFixed(0)}% (Attempt ${attempt - 1} triggered self-healing retry).`
          : 'Waiting for prior stage.',
      qualityScore: verificationScore,
    },
    {
      order: 7,
      id: 'deliverer',
      name: 'Deliverer Node',
      subtitle: 'Google Drive upload + Telegram sendDocument notification',
      status:
        status === 'done'
          ? 'done'
          : status === 'flagged' || status === 'failed'
          ? 'skipped'
          : activeStageIdx === 7
          ? 'active'
          : 'pending',
      detail:
        status === 'done'
          ? `Task delivered successfully. ${task.result_summary ? task.result_summary.slice(0, 120) : 'Check deliverables panel for Drive links.'}`
          : activeStageIdx === 7
          ? task.progress_note || 'Uploading to Google Drive and notifying via Telegram...'
          : 'Waiting for verification to pass.',
    },
    {
      order: 8,
      id: 'escalator',
      name: 'Escalator Node',
      subtitle: 'Human escalation — triggered when max attempts exceeded',
      status:
        status === 'flagged' || status === 'failed'
          ? 'error'
          : status === 'done'
          ? 'skipped'
          : 'pending',
      detail:
        status === 'flagged'
          ? `Task escalated for your review. Max attempts (${maxAttempts}) may have been reached or task was manually flagged.`
          : status === 'failed'
          ? 'Task failed and was escalated.'
          : status === 'done'
          ? 'Not needed — task delivered successfully.'
          : 'Only triggered if all self-correction attempts fail.',
    },
  ];

  return nodes;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await isRequestAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  if (!id || id.length < 10) {
    return NextResponse.json<ApiResponse>(
      { success: false, error: { code: 'INVALID_ID', message: 'Valid task ID required' } },
      { status: 400 }
    );
  }

  try {
    const supabase = getSupabaseAdmin();

    // Fetch all data in parallel
    const [taskRes, delRes, qRes, eventsRes] = await Promise.all([
      supabase.from('tasks').select('*').eq('id', id).single(),
      supabase
        .from('deliverables')
        .select('*')
        .eq('task_id', id)
        .order('delivered_at', { ascending: false }),
      supabase
        .from('questions')
        .select('*')
        .eq('task_id', id)
        .order('asked_at', { ascending: true }),
      supabase
        .from('system_events')
        .select('*')
        .ilike('message', `%${id}%`)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    if (taskRes.error) throw taskRes.error;
    if (!taskRes.data) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: { code: 'NOT_FOUND', message: 'Task not found' } },
        { status: 404 }
      );
    }

    const task = taskRes.data;
    const pipelineNodes = inferPipelineNodes(task);

    const trace: TaskTrace = {
      task,
      deliverables: delRes.data || [],
      questions: qRes.data || [],
      systemEvents: eventsRes.data || [],
      pipelineNodes,
    };

    return NextResponse.json<ApiResponse<TaskTrace>>({
      success: true,
      data: trace,
    });
  } catch (err: any) {
    console.error('Task trace error:', err);
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: { code: 'TRACE_ERROR', message: err?.message || 'Failed to fetch task trace' },
      },
      { status: 500 }
    );
  }
}
