import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { UserProfile } from '@/lib/types';
import { requireOwner } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/profile
 * Retrieves the profile row strictly for the authenticated owner.
 * Returns null data if no profile exists yet (prompting the setup wizard).
 */
export async function GET(req: NextRequest) {
  const user = await requireOwner(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('profile')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true, data: data || null });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: { code: 'PROFILE_FETCH_FAILED', message: err?.message || 'Failed to fetch profile' } },
      { status: 500 }
    );
  }
}

/**
 * POST /api/profile
 * Upserts the student profile row for the authenticated owner.
 */
export async function POST(req: NextRequest) {
  const user = await requireOwner(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const supabase = getSupabaseAdmin();

    const parseStringArray = (val: any): string[] => {
      if (Array.isArray(val)) return val.map((s) => String(s).trim()).filter(Boolean);
      if (typeof val === 'string') return val.split(',').map((s) => s.trim()).filter(Boolean);
      return [];
    };

    const parseCustomAttributes = (val: any): Record<string, any> => {
      if (typeof val === 'object' && val !== null && !Array.isArray(val)) return val;
      if (typeof val === 'string') {
        try {
          const parsed = JSON.parse(val);
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed;
        } catch {}
      }
      return {};
    };

    const payload: Partial<UserProfile> & { user_id: string; setup_completed?: boolean } = {
      user_id: user.id,
      full_name: body.full_name?.trim() || user.user_metadata?.full_name || 'Student',
      preferred_name: body.preferred_name?.trim() || null,
      email: body.email?.trim() || user.email || null,
      phone: body.phone?.trim() || null,
      telegram_id: body.telegram_id?.trim() || null,
      enrollment_no: body.enrollment_no?.trim() || null,
      university: body.university?.trim() || '',
      department: body.department?.trim() || null,
      program: body.program?.trim() || '',
      degree: body.degree?.trim() || null,
      current_semester: body.current_semester?.trim() || '',
      graduation_year: body.graduation_year?.trim() || null,
      cgpa_or_target_grade: body.cgpa_or_target_grade?.trim() || null,
      bio: body.bio?.trim() || null,
      skills: parseStringArray(body.skills),
      research_interests: parseStringArray(body.research_interests),
      writing_voice_sample: body.writing_voice_sample?.trim() || null,
      academic_level_note: body.academic_level_note?.trim() || null,
      default_citation_style: body.default_citation_style?.trim() || 'IEEE',
      custom_instructions: body.custom_instructions?.trim() || null,
      custom_attributes: parseCustomAttributes(body.custom_attributes),
      setup_completed: body.setup_completed !== undefined ? Boolean(body.setup_completed) : true,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('profile')
      .upsert(payload, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: { code: 'PROFILE_UPDATE_FAILED', message: err?.message || 'Failed to update profile' } },
      { status: 500 }
    );
  }
}
