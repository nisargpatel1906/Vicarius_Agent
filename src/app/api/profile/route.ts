import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { UserProfile } from '@/lib/types';
import { isRequestAuthorized } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/profile
 * Retrieves the student profile / user info row.
 */
export async function GET(req: NextRequest) {
  if (!isRequestAuthorized(req)) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from('profile').select('*').limit(1).maybeSingle();

    if (error || !data) {
      // Fallback baseline if table empty
      return NextResponse.json({
        success: true,
        data: {
          full_name: process.env.STUDENT_NAME || 'Nisarg Patel',
          preferred_name: 'Nisarg',
          university: process.env.STUDENT_UNIVERSITY || 'Academic Institution',
          department: 'Computer Engineering (AIML)',
          program: process.env.STUDENT_PROGRAM || 'B.Tech, Computer Engineering (AIML)',
          degree: 'B.Tech',
          current_semester: process.env.STUDENT_SEMESTER || 'Semester 4',
          graduation_year: '2026',
          telegram_id: process.env.TELEGRAM_ALLOWED_CHAT_ID || '123456789',
          default_citation_style: 'IEEE',
          academic_level_note: 'Comfortable with rigorous technical depth, distributed systems, machine learning architectures, and academic prose; avoids superficial generalizations.',
          writing_voice_sample: 'In distributed systems, ensuring high availability often necessitates trade-offs against immediate consistency, as characterized by the CAP theorem. Our evaluation demonstrates that leader-based consensus mechanisms such as Raft offer superior operational simplicity compared to traditional Paxos deployments without sacrificing fault tolerance.',
          bio: 'Undergraduate computer engineering student specializing in Artificial Intelligence and Machine Learning.',
          skills: ['Python', 'TypeScript', 'Next.js', 'LangGraph', 'PyTorch', 'Distributed Systems', 'PostgreSQL', 'Supabase'],
          research_interests: ['Distributed Consensus Algorithms', 'Autonomous Agent Orchestration', 'Large Language Model Reasoning', 'Fault-Tolerant Architecture'],
          custom_instructions: 'Always use the Cognitive Heritage design system for documents and interfaces. Deliver academic projects with rigorous mathematical proofs, comprehensive empirical evaluations, and standard APA/IEEE citations.',
          custom_attributes: { github: 'nisargpatel1906', preferred_timezone: 'Asia/Kolkata', primary_ide: 'Antigravity IDE' },
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
 * Updates the student profile / user info row (PRD Section 5 & 6.6)
 */
export async function POST(req: NextRequest) {
  if (!isRequestAuthorized(req)) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
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

    const updatePayload: Partial<UserProfile> = {
      full_name: body.full_name?.trim() || process.env.STUDENT_NAME || 'Nisarg Patel',
      preferred_name: body.preferred_name?.trim() || null,
      email: body.email?.trim() || null,
      phone: body.phone?.trim() || null,
      telegram_id: body.telegram_id?.trim() || process.env.TELEGRAM_ALLOWED_CHAT_ID || '123456789',
      enrollment_no: body.enrollment_no?.trim() || null,
      university: body.university?.trim() || process.env.STUDENT_UNIVERSITY || 'Academic Institution',
      department: body.department?.trim() || null,
      program: body.program?.trim() || process.env.STUDENT_PROGRAM || 'B.Tech, Computer Engineering (AIML)',
      degree: body.degree?.trim() || null,
      current_semester: body.current_semester?.trim() || process.env.STUDENT_SEMESTER || 'Semester 4',
      graduation_year: body.graduation_year?.trim() || null,
      cgpa_or_target_grade: body.cgpa_or_target_grade?.trim() || null,
      bio: body.bio?.trim() || null,
      skills: parseStringArray(body.skills),
      research_interests: parseStringArray(body.research_interests),
      custom_instructions: body.custom_instructions?.trim() || null,
      custom_attributes: parseCustomAttributes(body.custom_attributes),
      default_citation_style: body.default_citation_style?.trim() || 'IEEE',
      writing_voice_sample: body.writing_voice_sample?.trim() || null,
      academic_level_note: body.academic_level_note?.trim() || null,
      updated_at: new Date().toISOString(),
    };

    // Check if row exists
    const { data: existing } = await supabase.from('profile').select('id').limit(1).maybeSingle();

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
