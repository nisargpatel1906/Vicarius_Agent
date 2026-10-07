// GET /api/health
// System Health & Free-tier Usage API Endpoint
// Sourced from PRD_academic_task_agent.md (Section 6.6)

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { ApiResponse } from '@/lib/types';
import { requireOwner, isOperatorAuthorized } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const user = await requireOwner(req);
  const isOperator = isOperatorAuthorized(req);
  if (!user && !isOperator) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();

    // 1. Fetch recent system events
    let eventsQuery = supabase
      .from('system_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);

    if (user?.id) {
      eventsQuery = eventsQuery.eq('user_id', user.id);
    }

    const { data: events } = await eventsQuery;

    // 2. Determine last ingestion timestamp
    const lastIngestEvent = (events || []).find((e) => e.component === 'ingestion');
    const lastIngestTime = lastIngestEvent ? lastIngestEvent.created_at : null;

    // 3. Determine last worker check-in timestamp
    const lastWorkerEvent = (events || []).find((e) => e.component === 'worker');

    let latestTaskQuery = supabase
      .from('tasks')
      .select('updated_at, claimed_at')
      .order('updated_at', { ascending: false })
      .limit(1);

    if (user?.id) {
      latestTaskQuery = latestTaskQuery.eq('user_id', user.id);
    }

    const { data: latestTask } = await latestTaskQuery.maybeSingle();
    const lastWorkerTime = lastWorkerEvent?.created_at || latestTask?.updated_at || null;

    // 4. Compute rough usage stats from tasks
    let tasksQuery = supabase
      .from('tasks')
      .select('id, task_type, status, created_at');

    if (user?.id) {
      tasksQuery = tasksQuery.eq('user_id', user.id);
    }

    const { data: allTasks } = await tasksQuery;

    const totalTasks = allTasks?.length || 0;
    const completedTasks = allTasks?.filter((t) => t.status === 'done').length || 0;

    const groqDailyLimit = parseInt(process.env.GROQ_DAILY_LIMIT || '14400', 10);
    const geminiDailyLimit = parseInt(process.env.GEMINI_DAILY_LIMIT || '1500', 10);

    const usage = {
      groq: {
        estimatedCalls: totalTasks * 2,
        dailyLimit: groqDailyLimit,
        usagePercent: Math.min(100, Math.round(((totalTasks * 2) / groqDailyLimit) * 100)),
      },
      gemini: {
        estimatedCalls: totalTasks,
        dailyLimit: geminiDailyLimit,
        usagePercent: Math.min(100, Math.round((totalTasks / geminiDailyLimit) * 100)),
      },
      openrouter: {
        estimatedCalls: 0,
        status: process.env.OPENROUTER_STATUS || 'Active Fallback',
      },
      antigravity: {
        totalRuns: completedTasks,
        status: process.env.ANTIGRAVITY_STATUS || 'Local Engine Active',
      },
    };

    return NextResponse.json<ApiResponse>({
      success: true,
      data: {
        lastIngestion: lastIngestTime,
        lastWorkerCheckin: lastWorkerTime,
        events: events || [],
        usage,
        stats: {
          totalTasks,
          completedTasks,
        },
      },
    });
  } catch (err: any) {
    console.error('Health API error:', err);
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: { code: 'HEALTH_CHECK_FAILED', message: err?.message || 'Error fetching health status' },
      },
      { status: 500 }
    );
  }
}
