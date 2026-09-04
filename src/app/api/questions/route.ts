// POST /api/questions
// Dashboard Question Reply Endpoint
// Sourced from PRD_academic_task_agent.md (Section 6.6)

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, logSystemEvent } from '@/lib/supabase';
import { ApiResponse } from '@/lib/types';
import { isRequestAuthorized } from '@/lib/auth';

export async function POST(req: NextRequest) {
  if (!isRequestAuthorized(req)) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const body = await req.json();
    const { questionId, answer } = body;

    if (!questionId || !answer) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: { code: 'INVALID_INPUT', message: 'questionId and answer are required' },
        },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('questions')
      .update({
        answer_text: answer.trim(),
        status: 'answered',
        answered_at: new Date().toISOString(),
      })
      .eq('id', questionId)
      .select()
      .single();

    if (error) throw error;

    await logSystemEvent('info', 'dashboard', `Question ${questionId} answered via dashboard.`);

    return NextResponse.json<ApiResponse>({
      success: true,
      data,
    });
  } catch (err: any) {
    console.error('Error answering question:', err);
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: { code: 'ANSWER_QUESTION_ERROR', message: err?.message || 'Failed to submit answer' },
      },
      { status: 500 }
    );
  }
}
