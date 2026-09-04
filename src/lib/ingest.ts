// Ingestion Pipeline: Gmail & Google Classroom
// Sourced from PRD_academic_task_agent.md (Section 6.1, Section 7)

import { getGmailClient, getClassroomClient, getDriveClient } from './google-auth';
import { getSupabaseAdmin, logSystemEvent } from './supabase';
import { generateEmbedding, extractPdfText, extractDocxText, extractImageText } from './vector';
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

      // Helper to extract material attachments cleanly
      const parseMaterials = (materialsList?: any[]): Array<{ name: string; driveFileId?: string; mimeType?: string; url?: string; thumbnailUrl?: string }> => {
        const result: Array<{ name: string; driveFileId?: string; mimeType?: string; url?: string; thumbnailUrl?: string }> = [];
        if (!materialsList || !Array.isArray(materialsList)) return result;
        for (const mat of materialsList) {
          if (mat.driveFile?.driveFile) {
            result.push({
              name: mat.driveFile.driveFile.title || 'Classroom Attachment',
              driveFileId: mat.driveFile.driveFile.id || undefined,
              mimeType: undefined, // Let Drive API determine actual mimeType accurately
              url: mat.driveFile.driveFile.alternateLink || undefined,
              thumbnailUrl: mat.driveFile.driveFile.thumbnailUrl || undefined,
            });
          } else if (mat.link) {
            result.push({
              name: mat.link.title || mat.link.url || 'Link',
              mimeType: 'text/url',
              url: mat.link.url || undefined,
            });
          } else if (mat.youtubeVideo) {
            result.push({
              name: mat.youtubeVideo.title || 'YouTube Video',
              mimeType: 'video/youtube',
              url: mat.youtubeVideo.alternateLink || undefined,
            });
          } else if (mat.form) {
            result.push({
              name: mat.form.title || 'Google Form',
              mimeType: 'form/google',
              url: mat.form.formUrl || undefined,
            });
          }
        }
        return result;
      };

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

          const attachments = parseMaterials(cw.materials);

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

      // 2. Fetch CourseWork Materials (Lecture notes, Syllabus, Readings)
      try {
        const cwmRes = await classroom.courses.courseWorkMaterials.list({
          courseId: course.id,
          courseWorkMaterialStates: ['PUBLISHED'],
        });
        const cwmList = cwmRes.data.courseWorkMaterial || [];

        for (const cwm of cwmList) {
          if (!cwm.id) continue;
          const attachments = parseMaterials(cwm.materials);

          items.push({
            source: 'classroom',
            external_id: `cwm_${cwm.id}`,
            course: courseName,
            title: cwm.title || 'Course Material',
            raw_body: cwm.description || cwm.title || '',
            attachments,
            posted_date: cwm.creationTime || new Date().toISOString(),
          });
        }
      } catch (cwmErr: any) {
        console.warn(`Classroom courseWorkMaterials error for course ${course.id}:`, cwmErr?.message || cwmErr);
      }

      // 3. Fetch Announcements (with attachment parsing)
      try {
        const annRes = await classroom.courses.announcements.list({
          courseId: course.id,
          announcementStates: ['PUBLISHED'],
        });
        const announcements = annRes.data.announcements || [];

        for (const ann of announcements) {
          if (!ann.id) continue;
          const attachments = parseMaterials(ann.materials);

          items.push({
            source: 'classroom',
            external_id: `ann_${ann.id}`,
            course: courseName,
            title: `Announcement: ${(ann.text || 'Notice').slice(0, 60)}...`,
            raw_body: ann.text || '',
            attachments,
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
 * Registers Google Classroom Pub/Sub watch requests for active courses.
 * Registrations need to be renewed before they expire.
 */
export async function renewClassroomWatch() {
  try {
    const classroom = getClassroomClient();
    const topicName = process.env.GOOGLE_PUBSUB_TOPIC || 'projects/YOUR_PROJECT_ID/topics/vicarius-ingest';
    
    // Fetch active courses
    const coursesRes = await classroom.courses.list({ courseStates: ['ACTIVE'] });
    const courses = coursesRes.data.courses || [];
    
    let successCount = 0;
    for (const course of courses) {
      if (!course.id) continue;
      
      try {
        // Register for courseWork changes
        await classroom.registrations.create({
          requestBody: {
            cloudPubsubTopic: { topicName },
            feed: {
              feedType: 'COURSE_WORK_CHANGES',
              courseWorkChangesInfo: { courseId: course.id }
            }
          }
        });
        
        // Register for roster changes to catch announcements or other events if needed,
        // but Google Classroom API doesn't support an explicit 'ANNOUNCEMENT_CHANGES' feed yet.
        // COURSE_WORK_CHANGES covers assignments.
        
        successCount++;
      } catch (regErr: any) {
        console.warn(`Failed to register watch for course ${course.id}:`, regErr?.message || regErr);
      }
    }
    
    await logSystemEvent('info', 'ingestion', `Successfully renewed Classroom watch subscriptions for ${successCount} courses.`);
  } catch (err: any) {
    console.error('Failed to renew Classroom watch:', err);
    await logSystemEvent('warning', 'ingestion', `Failed to renew Classroom watch: ${err?.message || err}`);
  }
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

  // Upsert items into tasks table using (source, external_id) and fuzzy cross-source dedup
  for (const item of rawItems) {
    const success = await processSingleItem(item, supabase);
    if (success) result.upsertedCount++;
  }

  await logSystemEvent(
    'info',
    'ingestion',
    `Ingestion pass finished. Gmail: ${result.gmailCount}, Classroom: ${result.classroomCount}, Upserted new: ${result.upsertedCount}`
  );

  return result;
}

function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculates token Jaccard similarity between two strings
 */
function calculateSimilarity(str1: string, str2: string): number {
  const norm1 = normalizeString(str1);
  const norm2 = normalizeString(str2);
  if (norm1 === norm2) return 1.0;
  if (!norm1 || !norm2) return 0.0;

  const set1 = new Set(norm1.split(' ').filter(Boolean));
  const set2 = new Set(norm2.split(' ').filter(Boolean));

  if (set1.size === 0 || set2.size === 0) return 0.0;

  let intersection = 0;
  for (const token of set1) {
    if (set2.has(token)) {
      intersection++;
    }
  }

  const union = new Set([...set1, ...set2]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Checks whether an incoming item is a cross-source duplicate of an existing task
 */
async function findFuzzyDuplicate(
  supabase: any,
  item: NormalizedRawItem
): Promise<{ id: string; title: string; attachments: any[]; extracted_requirements: any } | null> {
  const { data: candidates } = await supabase
    .from('tasks')
    .select('id, title, course, due_date, extracted_requirements, created_at')
    .eq('archived', false)
    .order('created_at', { ascending: false })
    .limit(50);

  if (!candidates || candidates.length === 0) return null;

  for (const candidate of candidates) {
    // 1. Check title similarity
    const sim = calculateSimilarity(item.title, candidate.title);
    if (sim < 0.70) continue;

    // 2. Check course match if both have courses
    if (item.course && candidate.course) {
      const courseSim = calculateSimilarity(item.course, candidate.course);
      if (courseSim < 0.3 && !candidate.course.includes(item.course) && !item.course.includes(candidate.course)) {
        continue;
      }
    }

    // 3. Check due date window (within 24 hours if both specified)
    if (item.due_date && candidate.due_date) {
      const t1 = new Date(item.due_date).getTime();
      const t2 = new Date(candidate.due_date).getTime();
      const diffHours = Math.abs(t1 - t2) / (1000 * 60 * 60);
      if (diffHours > 24) {
        continue;
      }
    }

    // Found fuzzy duplicate
    const existingAttachments = candidate.extracted_requirements?.attachments || [];
    return {
      id: candidate.id,
      title: candidate.title,
      attachments: existingAttachments,
      extracted_requirements: candidate.extracted_requirements || {},
    };
  }

  return null;
}

/**
 * Downloads and extracts complete text from an attachment in Google Drive.
 * Supports:
 * - Google Docs (export to text/plain)
 * - Google Sheets (export to text/csv)
 * - Google Slides (export to text/plain)
 * - Word Docs .docx (Mammoth text & table parser)
 * - PDFs (pdf-parse)
 * - Images .png, .jpg, .jpeg, .webp (Gemini Vision OCR & visual transcription)
 * - Plain text, markdown, CSV, JSON, and source code
 */
export async function downloadAndExtractDriveFile(
  drive: any,
  fileId: string,
  hintName: string = '',
  thumbnailUrl?: string,
  alternateLink?: string
): Promise<{ text: string; mimeType: string; name: string }> {
  let mimeType = '';
  let fileName = hintName || 'Attachment';

  // 1. Try direct Google Drive API
  try {
    const fileMeta = await drive.files.get({
      fileId,
      fields: 'id, name, mimeType, size',
      supportsAllDrives: true,
    });

    mimeType = fileMeta.data.mimeType || '';
    fileName = fileMeta.data.name || hintName || 'Attachment';

    // Google Workspace Cloud Files (Docs, Sheets, Slides)
    if (mimeType === 'application/vnd.google-apps.document') {
      try {
        const res = await drive.files.export(
          { fileId, mimeType: 'text/plain' },
          { responseType: 'text' }
        );
        return { text: String(res.data || '').trim(), mimeType, name: fileName };
      } catch (docErr: any) {
        console.warn(`Export failed for Google Doc ${fileName}:`, docErr?.message || docErr);
      }
    }

    if (mimeType === 'application/vnd.google-apps.spreadsheet') {
      try {
        const res = await drive.files.export(
          { fileId, mimeType: 'text/csv' },
          { responseType: 'text' }
        );
        return { text: String(res.data || '').trim(), mimeType, name: fileName };
      } catch (sheetErr: any) {
        console.warn(`Export failed for Google Sheet ${fileName}:`, sheetErr?.message || sheetErr);
      }
    }

    if (mimeType === 'application/vnd.google-apps.presentation') {
      try {
        const res = await drive.files.export(
          { fileId, mimeType: 'text/plain' },
          { responseType: 'text' }
        );
        return { text: String(res.data || '').trim(), mimeType, name: fileName };
      } catch (slideErr: any) {
        console.warn(`Export failed for Google Slide ${fileName}:`, slideErr?.message || slideErr);
      }
    }

    // Binary files: download media buffer
    const res = await drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' }
    );
    const buffer = Buffer.from(res.data as ArrayBuffer);

    // Word Documents (.docx, .doc)
    const isDocx =
      mimeType.includes('wordprocessingml') ||
      mimeType.includes('msword') ||
      fileName.toLowerCase().endsWith('.docx') ||
      fileName.toLowerCase().endsWith('.doc');

    if (isDocx) {
      const text = await extractDocxText(buffer);
      if (text.trim()) {
        return {
          text: text.trim(),
          mimeType: mimeType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          name: fileName,
        };
      }
    }

    // PDF Documents (.pdf)
    const isPdf = mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');
    if (isPdf) {
      const text = await extractPdfText(buffer);
      if (text.trim()) {
        return { text: text.trim(), mimeType: 'application/pdf', name: fileName };
      }
    }

    // Images (.png, .jpg, .jpeg, .webp, .gif) -> OCR via Gemini Vision
    const isImage =
      mimeType.startsWith('image/') ||
      /\.(png|jpe?g|webp|gif|bmp)$/i.test(fileName);

    if (isImage) {
      const text = await extractImageText(buffer, mimeType || 'image/jpeg');
      if (text.trim()) {
        return { text: text.trim(), mimeType: mimeType || 'image/jpeg', name: fileName };
      }
    }

    // Plain text, Markdown, CSV, JSON, Code files
    if (
      mimeType.includes('text') ||
      mimeType.includes('json') ||
      mimeType.includes('csv') ||
      /\.(txt|md|csv|json|py|js|ts|cpp|java|html|xml|yaml|yml)$/i.test(fileName)
    ) {
      const text = buffer.toString('utf-8');
      return { text: text.trim(), mimeType: mimeType || 'text/plain', name: fileName };
    }
  } catch (driveErr: any) {
    // Direct Drive access failed (e.g. file owned by professor, restricted by drive.file scope)
    // Seamlessly fallback to high-resolution preview + Gemini Vision OCR below
  }

  // 2. High-Resolution Visual OCR Fallback via Classroom thumbnailUrl
  // Classroom provides rendered preview thumbnails for PDFs, Word docs, Images, and Google Docs
  if (thumbnailUrl) {
    try {
      const highResUrl = thumbnailUrl.replace(/=s\d+$/, '=s1600');
      const imgRes = await fetch(highResUrl);
      if (imgRes.ok) {
        const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
        const ocrText = await extractImageText(imgBuffer, 'image/jpeg');
        if (ocrText && ocrText.trim()) {
          return {
            text: ocrText.trim(),
            mimeType: 'application/rendered-preview',
            name: fileName,
          };
        }
      }
    } catch (thumbErr: any) {
      console.warn(`Failed to extract via thumbnailUrl for ${fileName}:`, thumbErr?.message || thumbErr);
    }
  }

  return { text: '', mimeType, name: fileName };
}

/**
 * Processes a single ingested item (useful for webhook-triggered events and bulk sync)
 */
export async function processSingleItem(item: NormalizedRawItem, supabaseClient?: any): Promise<boolean> {
  const supabase = supabaseClient || getSupabaseAdmin();
  
  try {
    // 0. Extract attachments full text for Vector Knowledge Base and Task Requirements
    const richAttachments: any[] = [];
    let attachmentsText = '';

    if (item.attachments && item.attachments.length > 0) {
      const drive = getDriveClient();
      for (const att of item.attachments) {
        if (att.driveFileId) {
          const extracted = await downloadAndExtractDriveFile(
            drive,
            att.driveFileId,
            att.name,
            (att as any).thumbnailUrl,
            (att as any).url
          );
          richAttachments.push({
            ...att,
            name: extracted.name || att.name,
            mimeType: extracted.mimeType || att.mimeType,
            extracted_text: extracted.text,
          });
          if (extracted.text.trim()) {
            attachmentsText += `\n\n--- Attachment: ${extracted.name} (${extracted.mimeType || 'unknown'}) ---\n${extracted.text}`;
          }
        } else {
          richAttachments.push(att);
        }
      }
    }

    let fullContent = `${item.title}\n\n${item.raw_body}`;
    if (attachmentsText) {
      fullContent += `\n${attachmentsText}`;
    }

    // 1. Push to Vector Knowledge Base
    try {
      const { data: kbExisting } = await supabase
        .from('knowledge_base')
        .select('id')
        .eq('source', item.source)
        .eq('external_id', item.external_id)
        .maybeSingle();

      if (!kbExisting) {
        const embedding = await generateEmbedding(fullContent);
        
        await supabase.from('knowledge_base').insert({
          source: item.source,
          external_id: item.external_id,
          course: item.course,
          title: item.title,
          content: fullContent,
          embedding,
          metadata: {
            attachments: richAttachments,
            attachment_count: richAttachments.length,
            has_extracted_text: richAttachments.some((a: any) => a.extracted_text && a.extracted_text.length > 0),
          },
          posted_date: item.posted_date || new Date().toISOString(),
        });
      }
    } catch (vectorErr: any) {
      console.warn(`Failed to insert into knowledge_base for ${item.external_id}:`, vectorErr?.message || vectorErr);
    }

    // Determine if this item is actionable and should go to tasks table
    const isClassroomAssignment = item.source === 'classroom' && item.external_id.startsWith('cw_');
    const isEmailTask = item.source === 'gmail' && !!item.due_date;

    if (!isClassroomAssignment && !isEmailTask) {
      return true; // Successfully saved to knowledge base
    }

    // Ignore tasks whose due date has already passed
    if (item.due_date && new Date(item.due_date).getTime() < Date.now()) {
      return true; // Already past due; preserved in knowledge base but excluded from active tasks ledger
    }

    // 2. Exact dedup by (source, external_id)
    const { data: existing } = await supabase
      .from('tasks')
      .select('id, status')
      .eq('source', item.source)
      .eq('external_id', item.external_id)
      .maybeSingle();

    if (existing) {
      return false; // Already exists
    }

    // 3. Cross-source fuzzy dedup
    const fuzzyMatch = await findFuzzyDuplicate(supabase, item);
    if (fuzzyMatch) {
      const newAttachments = (richAttachments || []).filter(
        (na) => !fuzzyMatch.attachments.some((ea: any) => ea.name === na.name)
      );

      if (newAttachments.length > 0) {
        const mergedRequirements = {
          ...fuzzyMatch.extracted_requirements,
          attachments: [...fuzzyMatch.attachments, ...newAttachments],
        };
        await supabase.from('tasks').update({
          extracted_requirements: mergedRequirements,
          updated_at: new Date().toISOString(),
        }).eq('id', fuzzyMatch.id);
      }

      await logSystemEvent(
        'info',
        'ingestion',
        `Cross-source duplicate suppressed: '${item.title}' (${item.source}) merged into task '${fuzzyMatch.title}' (${fuzzyMatch.id})`
      );
      return false;
    }

    // Insert new task in 'new' status with posted_date and rich attachments
    const fullBody = attachmentsText
      ? `${item.raw_body}\n${attachmentsText}`
      : item.raw_body;

    const { error: insertErr } = await supabase.from('tasks').insert({
      source: item.source,
      external_id: item.external_id,
      course: item.course,
      title: item.title,
      task_type: 'document',
      status: 'new',
      due_date: item.due_date || null,
      posted_date: item.posted_date || new Date().toISOString(),
      extracted_requirements: {
        raw_body: fullBody,
        attachments: richAttachments,
        posted_date: item.posted_date,
      },
    });

    if (insertErr) {
      console.error(`Failed to insert task ${item.external_id}:`, insertErr.message);
      return false;
    }
    
    return true;
  } catch (upsertErr: any) {
    console.error(`Upsert error for item ${item.external_id}:`, upsertErr?.message || upsertErr);
    return false;
  }
}

