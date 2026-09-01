// Ingestion Pipeline: Gmail & Google Classroom
// Sourced from PRD_academic_task_agent.md (Section 6.1, Section 7)

import { getGmailClient, getClassroomClient } from './google-auth';
import { getSupabaseAdmin, logSystemEvent } from './supabase';
import { NormalizedRawItem, TaskSource } from './types';

export interface IngestionResult {
  gmailCount: number;
  classroomCount: number;
  upsertedCount: number;
  errors: string[];
}

/**
 * Polls Gmail for recent academic/assignment messages
 */
export async function pollGmail(): Promise<NormalizedRawItem[]> {
  const items: NormalizedRawItem[] = [];
  try {
    const gmail = getGmailClient();
    // Query recent messages from inbox or specific academic labels/keywords
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: 'newer_than:7d (assignment OR project OR homework OR submission OR "due date" OR classroom OR coursework)',
      maxResults: 25,
    });

    const messages = res.data.messages || [];
    for (const msg of messages) {
      if (!msg.id) continue;
      try {
        const detail = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'full',
        });

        const headers = detail.data.payload?.headers || [];
        const subject = headers.find((h) => h.name?.toLowerCase() === 'subject')?.value || 'Untitled Email Task';
        const from = headers.find((h) => h.name?.toLowerCase() === 'from')?.value || '';
        const dateHeader = headers.find((h) => h.name?.toLowerCase() === 'date')?.value || '';

        // Extract body text
        let body = '';
        if (detail.data.snippet) {
          body = detail.data.snippet;
        }
        
        // Extract attachment references
        const attachments: Array<{ name: string; mimeType?: string; driveFileId?: string }> = [];
        const parts = detail.data.payload?.parts || [];
        for (const part of parts) {
          if (part.filename && part.body?.attachmentId) {
            attachments.push({
              name: part.filename,
              mimeType: part.mimeType || undefined,
            });
          }
        }

        items.push({
          source: 'gmail',
          external_id: `gmail_${msg.id}`,
          course: from ? from.split('<')[0].trim() : null,
          title: subject,
          raw_body: `From: ${from}\nDate: ${dateHeader}\nSubject: ${subject}\n\n${body}`,
          attachments,
          posted_date: dateHeader ? new Date(dateHeader).toISOString() : new Date().toISOString(),
        });
      } catch (err: any) {
        console.error(`Error processing Gmail message ${msg.id}:`, err?.message || err);
      }
    }
  } catch (err: any) {
    const msg = `Gmail polling failed: ${err?.message || err}`;
    console.error(msg);
    await logSystemEvent('warning', 'ingestion', msg);
    throw err;
  }
  return items;
}

/**
 * Polls Google Classroom across all active courses
 */
export async function pollGoogleClassroom(): Promise<NormalizedRawItem[]> {
  const items: NormalizedRawItem[] = [];
  try {
    const classroom = getClassroomClient();
    
    // Dynamically re-fetch active courses to capture additions/drops (PRD Section 7)
    const coursesRes = await classroom.courses.list({
      courseStates: ['ACTIVE'],
    });

    const courses = coursesRes.data.courses || [];
    for (const course of courses) {
      if (!course.id) continue;
      const courseName = course.name || `Course ${course.id}`;

      // 1. Fetch CourseWork (Assignments)
      try {
        const workRes = await classroom.courses.courseWork.list({
          courseId: course.id,
          courseWorkStates: ['PUBLISHED'],
        });
        const courseWorkList = workRes.data.courseWork || [];

        for (const cw of courseWorkList) {
          if (!cw.id) continue;

          // Format due date if present
          let dueDateIso: string | null = null;
          if (cw.dueDate) {
            const year = cw.dueDate.year || new Date().getFullYear();
            const month = (cw.dueDate.month || 1).toString().padStart(2, '0');
            const day = (cw.dueDate.day || 1).toString().padStart(2, '0');
            const hour = (cw.dueTime?.hours || 23).toString().padStart(2, '0');
            const minute = (cw.dueTime?.minutes || 59).toString().padStart(2, '0');
            dueDateIso = new Date(`${year}-${month}-${day}T${hour}:${minute}:00Z`).toISOString();
          }

          // Extract materials/attachments
          const attachments: Array<{ name: string; driveFileId?: string; mimeType?: string }> = [];
          if (cw.materials) {
            for (const mat of cw.materials) {
              if (mat.driveFile?.driveFile) {
                attachments.push({
                  name: mat.driveFile.driveFile.title || 'Classroom Attachment',
                  driveFileId: mat.driveFile.driveFile.id || undefined,
                  mimeType: mat.driveFile.driveFile.alternateLink ? 'application/drive' : undefined,
                });
              } else if (mat.link) {
                attachments.push({
                  name: mat.link.title || mat.link.url || 'Link',
                  mimeType: 'text/url',
                });
              }
            }
          }

          items.push({
            source: 'classroom',
            external_id: `cw_${cw.id}`,
            course: courseName,
            title: cw.title || 'Untitled Classroom Assignment',
            raw_body: cw.description || cw.title || '',
            attachments,
            posted_date: cw.creationTime || new Date().toISOString(),
            due_date: dueDateIso,
          });
        }
      } catch (cwErr: any) {
        console.warn(`Classroom courseWork error for course ${course.id}:`, cwErr?.message || cwErr);
      }

      // 2. Fetch Announcements
      try {
        const annRes = await classroom.courses.announcements.list({
          courseId: course.id,
          announcementStates: ['PUBLISHED'],
        });
        const announcements = annRes.data.announcements || [];

        for (const ann of announcements) {
          if (!ann.id) continue;
          items.push({
            source: 'classroom',
            external_id: `ann_${ann.id}`,
            course: courseName,
            title: `Announcement: ${(ann.text || 'Notice').slice(0, 60)}...`,
            raw_body: ann.text || '',
            posted_date: ann.creationTime || new Date().toISOString(),
          });
        }
      } catch (annErr: any) {
        console.warn(`Classroom announcements error for course ${course.id}:`, annErr?.message || annErr);
      }
    }
  } catch (err: any) {
    const msg = `Classroom polling failed: ${err?.message || err}`;
    console.error(msg);
    await logSystemEvent('warning', 'ingestion', msg);
    throw err;
  }
  return items;
}

/**
 * Runs full ingestion pass with independent fault isolation
 */
export async function runIngestion(): Promise<IngestionResult> {
  const result: IngestionResult = {
    gmailCount: 0,
    classroomCount: 0,
    upsertedCount: 0,
    errors: [],
  };

  const rawItems: NormalizedRawItem[] = [];

  // Gmail poll (isolated)
  try {
    const gmailItems = await pollGmail();
    result.gmailCount = gmailItems.length;
    rawItems.push(...gmailItems);
  } catch (err: any) {
    result.errors.push(`Gmail: ${err?.message || err}`);
  }

  // Classroom poll (isolated)
  try {
    const classroomItems = await pollGoogleClassroom();
    result.classroomCount = classroomItems.length;
    rawItems.push(...classroomItems);
  } catch (err: any) {
    result.errors.push(`Classroom: ${err?.message || err}`);
  }

  if (rawItems.length === 0) {
    await logSystemEvent(
      result.errors.length > 0 ? 'warning' : 'info',
      'ingestion',
      `Ingestion completed. 0 items found. Errors: ${result.errors.join('; ') || 'None'}`
    );
    return result;
  }

  const supabase = getSupabaseAdmin();

  // Upsert items into tasks table using (source, external_id) dedupe key
  for (const item of rawItems) {
    try {
      // Check if task already exists
      const { data: existing } = await supabase
        .from('tasks')
        .select('id, status')
        .eq('source', item.source)
        .eq('external_id', item.external_id)
        .maybeSingle();

      if (!existing) {
        // Insert new task in 'new' status
        const { error: insertErr } = await supabase.from('tasks').insert({
          source: item.source,
          external_id: item.external_id,
          course: item.course,
          title: item.title,
          task_type: 'document', // Default initially before Groq classification
          status: 'new',
          due_date: item.due_date || null,
          extracted_requirements: {
            raw_body: item.raw_body,
            attachments: item.attachments || [],
            posted_date: item.posted_date,
          },
        });

        if (insertErr) {
          console.error(`Failed to insert task ${item.external_id}:`, insertErr.message);
        } else {
          result.upsertedCount++;
        }
      }
    } catch (upsertErr: any) {
      console.error(`Upsert error for item ${item.external_id}:`, upsertErr?.message || upsertErr);
    }
  }

  await logSystemEvent(
    'info',
    'ingestion',
    `Ingestion pass finished. Gmail: ${result.gmailCount}, Classroom: ${result.classroomCount}, Upserted new: ${result.upsertedCount}`
  );

  return result;
}
