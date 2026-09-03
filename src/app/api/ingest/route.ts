// POST /api/ingest
// Endpoint triggered by GitHub Actions or manual run
// Sourced from PRD_academic_task_agent.md (Section 6.1, Section 11)

import { NextRequest, NextResponse } from 'next/server';
import { runIngestion } from '@/lib/ingest';
import { processNewTasks } from '@/lib/classify';
import { logSystemEvent } from '@/lib/supabase';
import { ApiResponse } from '@/lib/types';
import { getGmailClient } from '@/lib/google-auth';

export async function POST(req: NextRequest) {
  try {
    const expectedToken = process.env.INGEST_SECRET_TOKEN;
    if (!expectedToken) {
      console.error('CRITICAL: INGEST_SECRET_TOKEN is not configured.');
      return NextResponse.json<ApiResponse>(
        { success: false, error: { code: 'CONFIG_ERROR', message: 'Server configuration error' } },
        { status: 500 }
      );
    }
    
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
    if (token !== expectedToken) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or missing bearer token' } },
        { status: 401 }
      );
    }

    // Renew Gmail Watch Subscription (expires every 7 days)
    try {
      const gmail = getGmailClient();
      await gmail.users.watch({
        userId: 'me',
        requestBody: {
          labelIds: ['INBOX'],
          labelFilterAction: 'include',
          // Note: In production, the topic name should come from env var
          topicName: process.env.GOOGLE_PUBSUB_TOPIC || 'projects/YOUR_PROJECT_ID/topics/vicarius-ingest'
        }
      });
      await logSystemEvent('info', 'ingestion', 'Successfully renewed Gmail Pub/Sub watch subscription');
    } catch (watchErr: any) {
      console.error('Failed to renew Gmail watch:', watchErr);
      await logSystemEvent('warning', 'ingestion', `Failed to renew Gmail watch: ${watchErr?.message || watchErr}`);
    }

    // Run ingestion (fallback batch sync)
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
