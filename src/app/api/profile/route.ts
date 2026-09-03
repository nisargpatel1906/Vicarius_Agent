import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { UserProfile } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/profile
 * Retrieves the single student profile row.
 */
export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from('profile').select('*').limit(1).single();

    if (error) {
      // If table empty, return standard fallback
      return NextResponse.json({
        success: true,
        data: {
          full_name: 'Nisarg Patel',
          university: 'Academic Institution',
          program: 'B.Tech, Computer Engineering (AIML)',
          current_semester: 'Semester 4',
          default_citation_style: 'IEEE',
          academic_level_note: 'Comfortable with rigorous technical depth, distributed systems, machine learning architectures, and academic prose; avoids superficial generalizations.',
          writing_voice_sample: 'In distributed systems, ensuring high availability often necessitates trade-offs against immediate consistency, as characterized by the CAP theorem. Our evaluation demonstrates that leader-based consensus mechanisms such as Raft offer superior operational simplicity compared to traditional Paxos deployments without sacrificing fault tolerance.',
        },
      });
    }

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: { code: 'PROFILE_FETCH_FAILED', message: err?.message || 'Failed to fetch profile' } },
      { status: 500 }
    );
  }
}

/**
 * POST /api/profile
 * Updates the student profile row (PRD Section 5 & 6.6)
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const supabase = getSupabaseAdmin();

    const updatePayload: Partial<UserProfile> = {
      full_name: body.full_name?.trim() || 'Nisarg Patel',
      university: body.university?.trim() || 'Academic Institution',
      program: body.program?.trim() || 'B.Tech, Computer Engineering (AIML)',
      current_semester: body.current_semester?.trim() || 'Semester 4',
      default_citation_style: body.default_citation_style?.trim() || 'IEEE',
      writing_voice_sample: body.writing_voice_sample?.trim() || null,
      academic_level_note: body.academic_level_note?.trim() || null,
      updated_at: new Date().toISOString(),
    };

    // Check if row exists
    const { data: existing } = await supabase.from('profile').select('id').limit(1).single();

    let resultData;
    if (existing?.id) {
      const { data, error } = await supabase
        .from('profile')
        .update(updatePayload)
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw error;
      resultData = data;
    } else {
      const { data, error } = await supabase
        .from('profile')
        .insert([updatePayload])
        .select()
        .single();
      if (error) throw error;
      resultData = data;
    }

    return NextResponse.json({ success: true, data: resultData });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: { code: 'PROFILE_UPDATE_FAILED', message: err?.message || 'Failed to update profile' } },
      { status: 500 }
    );
  }
}
