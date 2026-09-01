// GET /api/tasks & PATCH /api/tasks
// API for Dashboard Task Operations
// Sourced from PRD_academic_task_agent.md (Section 6.6, Section 11)

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, logSystemEvent } from '@/lib/supabase';
import { ApiResponse, Task } from '@/lib/types';

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const url = new URL(req.url);
    const includeArchived = url.searchParams.get('archived') === 'true';
    const status = url.searchParams.get('status');
    const course = url.searchParams.get('course');
    const taskType = url.searchParams.get('task_type');

    let query = supabase
      .from('tasks')
      .select(`
        *,
        questions (*),
        deliverables (*)
      `)
      .order('due_date', { ascending: true, nullsFirst: false });

    if (!includeArchived) {
      query = query.eq('archived', false);
    }
    if (status) {
      query = query.eq('status', status);
    }
    if (course) {
      query = query.eq('course', course);
    }
    if (taskType) {
      query = query.eq('task_type', taskType);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    return NextResponse.json<ApiResponse<Task[]>>({
      success: true,
      data: data || [],
    });
  } catch (err: any) {
    console.error('Error fetching tasks:', err);
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'FETCH_TASKS_ERROR',
          message: err?.message || 'Failed to fetch tasks',
        },
      },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const body = await req.json();
    const { id, action, ...updates } = body;

    if (!id) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: { code: 'MISSING_ID', message: 'Task ID is required' } },
        { status: 400 }
      );
    }

    if (action === 'retry') {
      // Requeue a flagged or failed task (PRD Section 6.6)
      const { data, error } = await supabase
        .from('tasks')
        .update({
          status: 'queued',
          worker_id: null,
          claimed_at: null,
          result_summary: 'Manually requeued from dashboard.',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      await logSystemEvent('info', 'dashboard', `Task ${id} requeued from dashboard.`);

      return NextResponse.json<ApiResponse>({ success: true, data });
    }

    if (action === 'toggle_archive') {
      const { archived } = updates;
      const { data, error } = await supabase
        .from('tasks')
        .update({
          archived: typeof archived === 'boolean' ? archived : true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json<ApiResponse>({ success: true, data });
    }

    // Generic update
    const { data, error } = await supabase
      .from('tasks')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json<ApiResponse>({ success: true, data });
  } catch (err: any) {
    console.error('Task update error:', err);
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: { code: 'UPDATE_TASK_ERROR', message: err?.message || 'Failed to update task' },
      },
      { status: 500 }
    );
  }
}
