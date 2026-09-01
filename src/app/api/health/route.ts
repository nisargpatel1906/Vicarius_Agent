// GET /api/health
// System Health & Free-tier Usage API Endpoint
// Sourced from PRD_academic_task_agent.md (Section 6.6)

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { ApiResponse, SystemEvent } from '@/lib/types';

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();

    // 1. Fetch recent system events
    const { data: events } = await supabase
      .from('system_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);

    // 2. Determine last ingestion timestamp
    const lastIngestEvent = (events || []).find((e) => e.component === 'ingestion');
    const lastIngestTime = lastIngestEvent ? lastIngestEvent.created_at : null;

    // 3. Determine last worker check-in timestamp
    const lastWorkerEvent = (events || []).find((e) => e.component === 'worker');
    const { data: latestTask } = await supabase
      .from('tasks')
      .select('updated_at, claimed_at')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const lastWorkerTime = lastWorkerEvent?.created_at || latestTask?.updated_at || null;

    // 4. Compute rough usage stats from tasks
    const { data: allTasks } = await supabase
      .from('tasks')
      .select('id, task_type, status, created_at');

    const totalTasks = allTasks?.length || 0;
    const completedTasks = allTasks?.filter((t) => t.status === 'done').length || 0;

    const usage = {
      groq: {
        estimatedCalls: totalTasks * 2, // classification + answer parsing
        dailyLimit: 14400, // Groq free tier standard
        usagePercent: Math.min(100, Math.round(((totalTasks * 2) / 14400) * 100)),
      },
      gemini: {
        estimatedCalls: totalTasks,
        dailyLimit: 1500, // Gemini Flash free tier RPM/RPD
        usagePercent: Math.min(100, Math.round((totalTasks / 1500) * 100)),
      },
      openrouter: {
        estimatedCalls: 0,
        status: 'Active Fallback',
      },
      antigravity: {
        totalRuns: completedTasks,
        status: 'Local Engine Active',
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
