// POST /api/ingest
// Endpoint triggered by GitHub Actions or manual run
// Sourced from PRD_academic_task_agent.md (Section 6.1, Section 11)

import { NextRequest, NextResponse } from 'next/server';
import { runIngestion } from '@/lib/ingest';
import { processNewTasks } from '@/lib/classify';
import { logSystemEvent } from '@/lib/supabase';
import { ApiResponse } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    // Verify optional secret token if configured
    const expectedToken = process.env.INGEST_SECRET_TOKEN;
    if (expectedToken) {
      const authHeader = req.headers.get('authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
      if (token !== expectedToken) {
        return NextResponse.json<ApiResponse>(
          {
            success: false,
            error: {
              code: 'UNAUTHORIZED',
              message: 'Invalid or missing bearer token',
            },
          },
          { status: 401 }
        );
      }
    }

    // Run ingestion
    const ingestionResult = await runIngestion();

    // Automatically trigger classification on any newly ingested tasks
    let classifyResult = null;
    try {
      classifyResult = await processNewTasks();
    } catch (classifyErr: any) {
      console.error('Auto-classification error following ingestion:', classifyErr);
      await logSystemEvent(
        'warning',
        'classify',
        `Auto-classification failed after ingestion: ${classifyErr?.message || classifyErr}`
      );
    }

    return NextResponse.json<ApiResponse>({
      success: true,
      data: {
        ingestion: ingestionResult,
        classification: classifyResult,
      },
    });
  } catch (err: any) {
    const errorMsg = err?.message || 'Unknown ingestion error';
    console.error('Ingestion endpoint failure:', err);
    await logSystemEvent('error', 'ingestion', `Ingestion endpoint error: ${errorMsg}`);

    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'INGESTION_FAILED',
          message: errorMsg,
        },
      },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
