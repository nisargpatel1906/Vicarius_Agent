// Supabase Client & Helper Functions
// Sourced from PRD_academic_task_agent.md (Section 5 & 11)

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { EventLevel, SystemEvent, Task } from './types';

let adminClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (adminClient) return adminClient;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_WORKER_KEY;

  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY/SUPABASE_WORKER_KEY environment variables.');
  }

  adminClient = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return adminClient;
}

export async function logSystemEvent(
  level: EventLevel,
  component: string,
  message: string
): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from('system_events').insert({
      level,
      component,
      message,
    });
    if (error) {
      console.error(`[SystemEvent-Error] Failed to write event: ${error.message}`);
    }
  } catch (err: any) {
    console.error(`[SystemEvent-Exception] ${err?.message || err}`);
  }
}
