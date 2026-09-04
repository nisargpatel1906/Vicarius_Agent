import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { logSystemEvent } from './supabase';

let _aethosClient: SupabaseClient | null = null;

export function getAethosClient(): SupabaseClient | null {
  if (!_aethosClient) {
    const url = process.env.AETHOS_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const key = process.env.AETHOS_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
    
    if (!url || !key) {
      return null;
    }
    
    _aethosClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _aethosClient;
}

export function getAethosUserId(): string {
  return process.env.AETHOS_USER_ID || '';
}

/**
 * Generate 768-dim vector embedding using Gemini text-embedding-004
 */
export async function getEmbedding(text: string): Promise<number[]> {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) return Array(768).fill(0);

  try {
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
    const result = await model.embedContent(text);
    return result.embedding.values;
  } catch (e) {
    console.warn('Gemini embedding generation failed, using zero-vector fallback:', e);
    return Array(768).fill(0);
  }
}

/**
 * Recalls standing preferences and notes for a course from Aethos Memory
 */
export async function queryAethosCourseNotes(courseName: string): Promise<string[]> {
  try {
    const client = getAethosClient();
    if (!client) return [];
    const userId = getAethosUserId();
    const embedding = await getEmbedding(courseName);

    // 1. Try vector RPC match_memories on Aethos DB
    const { data: rpcData, error: rpcError } = await client.rpc('match_memories', {
      p_user_id: userId,
      p_project: courseName,
      query_embedding: embedding,
      match_threshold: 0.45,
      match_count: 5,
    });

    if (!rpcError && rpcData && rpcData.length > 0) {
      return rpcData.map((row: any) => row.content);
    }

    // 2. Direct query on memories table by project and global preferences
    const { data: directData } = await client
      .from('memories')
      .select('content, project, created_at')
      .eq('user_id', userId)
      .or(`project.ilike.%${courseName}%,project.eq.global`)
      .order('created_at', { ascending: false })
      .limit(6);

    if (directData && directData.length > 0) {
      return directData.map((row: any) => row.content);
    }

    return [];
  } catch (err: any) {
    console.warn('Aethos Memory recall failed:', err?.message || err);
    return [];
  }
}

/**
 * Saves a student's feedback or correction for a course into Aethos Memory
 */
export async function rememberCourseCorrection(courseName: string, feedback: string): Promise<string> {
  try {
    const client = getAethosClient();
    if (!client) {
      return '⚠️ Aethos Memory client is not configured.';
    }
    const userId = getAethosUserId();
    const embedding = await getEmbedding(feedback);

    const { data, error } = await client.from('memories').insert({
      user_id: userId,
      project: courseName,
      content: feedback,
      embedding: embedding,
      category: 'decision',
      importance: 4,
      tags: ['course_correction', courseName],
      source_tool: 'Vicarius Agent Telegram',
    }).select('id');

    if (error) {
      throw error;
    }

    const insertedId = data?.[0]?.id || 'saved';
    await logSystemEvent('info', 'aethos', `Saved course correction to Aethos for '${courseName}' (Memory ID: ${insertedId})`);
    return `✅ <b>Saved to Aethos Memory:</b>\nCourse: <code>${courseName}</code>\nNote: <i>"${feedback}"</i>\n\nI will remember and apply this instruction to all future assignments for this course!`;
  } catch (err: any) {
    console.error('Aethos Memory remember failed:', err);
    await logSystemEvent('error', 'aethos', `Failed to save memory: ${err?.message || err}`);
    return `❌ Failed to save to Aethos Memory: ${err?.message || err}`;
  }
}
