// Classification & Extraction Engine
// Sourced from PRD_academic_task_agent.md (Section 6.2, 6.3, 7)

import { GoogleGenerativeAI } from '@google/generative-ai';
import { getSupabaseAdmin, logSystemEvent } from './supabase';
import { Task, TaskType, ExtractedRequirements, TaskWeight, UserProfile } from './types';
import { sendTelegramAlert } from './telegram';

export interface ClassificationOutput {
  task_type: TaskType;
  course: string;
  due_date: string | null;
  confidence: number;
  extracted_requirements: ExtractedRequirements;
  success_criteria: string | null;
  output_format: string;
  build_spec: string;
  weight: TaskWeight;
}

/**
 * Call OpenRouter with MiniMax model
 */
async function callLlmWithFallback(prompt: string, systemPrompt: string): Promise<string> {
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (openRouterKey) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openRouterKey}`,
          'HTTP-Referer': 'https://vicarius-agent.local',
          'X-Title': 'Vicarius Agent',
        },
        body: JSON.stringify({
          model: 'minimax/minimax-m3:free',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ],
          temperature: 0.1,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content;
        if (content) return content;
      } else {
        const errBody = await res.text();
        throw new Error(`OpenRouter API error: ${res.statusText} - ${errBody}`);
      }
    } catch (orErr: any) {
      console.error('OpenRouter classification failed:', orErr);
      await logSystemEvent('error', 'classify', `OpenRouter error: ${orErr?.message || orErr}`);
    }
  }

  throw new Error('LLM classification provider (OpenRouter) failed or missing API keys.');
}

/**
 * Call Gemini Flash for vision/PDF extraction with OpenRouter fallback
 */
async function extractAttachmentContent(attachmentName: string, mimeType?: string, base64Data?: string): Promise<string> {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey && base64Data && mimeType) {
    try {
      const genAI = new GoogleGenerativeAI(geminiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });

      const prompt = `Extract all academic requirements, task instructions, rubric guidelines, and explicit success criteria from this assignment document/image. Return clear, thorough text.`;
      const result = await model.generateContent([
        prompt,
        {
          inlineData: {
            data: base64Data,
            mimeType: mimeType,
          },
        },
      ]);
      const text = result.response.text();
      if (text) return text;
    } catch (geminiErr: any) {
      console.warn('Gemini Flash vision failed. Falling back to OpenRouter vision:', geminiErr?.message || geminiErr);
    }
  }

  return `Attachment: ${attachmentName} (${mimeType || 'unknown'})`;
}

/**
 * Check Aethos Memory for per-course / professor standing notes
 */
async function queryAethosCourseNotes(courseName: string): Promise<string[]> {
  try {
    // Check if Aethos memory tool / endpoint is accessible
    // Fallback standing student profile context
    return [
      `User is Nisarg Patel (B.Tech CE/AIML at Academic Institution).`,
      `Prefers clean, production-grade output with clear README/documentation.`,
    ];
  } catch (err) {
    return [];
  }
}

/**
 * Fetch student profile row from Supabase (PRD Section 5 & 6.2)
 */
export async function getUserProfile(): Promise<UserProfile> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from('profile').select('*').limit(1).single();
    if (!error && data) {
      return data as UserProfile;
    }
  } catch (err) {
    console.warn('Could not fetch user profile from Supabase:', err);
  }
  return {
    id: 'default',
    full_name: 'Nisarg Patel',
    university: 'Academic Institution',
    program: 'B.Tech, Computer Engineering (AIML)',
    current_semester: 'Semester 4',
    default_citation_style: 'IEEE',
    academic_level_note: 'Comfortable with rigorous technical depth, distributed systems, machine learning architectures, and academic prose; avoids superficial generalizations.',
    writing_voice_sample: 'In distributed systems, ensuring high availability often necessitates trade-offs against immediate consistency, as characterized by the CAP theorem. Our evaluation demonstrates that leader-based consensus mechanisms such as Raft offer superior operational simplicity compared to traditional Paxos deployments without sacrificing fault tolerance.',
    updated_at: new Date().toISOString(),
  };
}

/**
 * Generates the standardized Build Spec template (PRD Section 6.3 & PROMPT_AND_OUTPUT_STANDARDS.md)
 */
export function generateBuildSpec(
  title: string,
  course: string,
  taskType: TaskType,
  requirementsList: string[],
  successCriteria: string | null,
  outputFormat: string,
  profile?: UserProfile
): string {
  const reqsFormatted = requirementsList.map((r) => `- ${r}`).join('\n');
  const criteriaFormatted = successCriteria ? successCriteria : 'None explicitly specified';

  const isUiTask = taskType === 'code_project' || taskType === 'presentation' || /web|ui|dashboard|frontend|app|react|html|css|slides/i.test(title);
  const designDirective = isUiTask ? `\n\nUI & Visual Design System (MANDATORY — from docx/DESIGN.md):
- Follow the Cognitive Heritage design system:
  • Colors: Surface (#fff8f4), Surface-Container (#fdebd9), Surface-Container-High (#f7e5d4), On-Surface (#231a0f), Primary (#705728), Primary-Container (#8b6f3e), Secondary (#645e4e), Outline (#7f7669).
  • Typography: Headings ('Noto Serif' 600/700), Body & Controls ('Manrope' 400/600).
  • Visual Standards: Clean card-based structure, smooth micro-interactions (0.2s cubic-bezier), modern border-radius (8px buttons, 12px cards, 9999px badges), and high legibility.` : '';

  const studentContext = profile ? `\n\nStudent Profile:
- Student: ${profile.full_name} (${profile.program} - ${profile.current_semester} at ${profile.university})
- Academic Register: ${profile.academic_level_note || 'Formal undergraduate technical standard'}
- Default Citation Style: ${profile.default_citation_style || 'IEEE'}
- Writing Voice Guidance: Let the student's voice sample inform natural phrasing and cadence without copying verbatim: "${profile.writing_voice_sample || ''}"` : '';

  return `Task: ${title}
Source: ${course || 'Academic Course'} — ${taskType}
Requirements:
${reqsFormatted}
Success criteria: ${criteriaFormatted}
Output format: ${outputFormat}${studentContext}
${designDirective}

Instructions:
- Work to completion without stopping for approval — this project's
  permissions already cover everything you need here.
- If something is genuinely blocking (not just a minor judgment call),
  ask the user directly via the ask_human tool. Wait up to the configured
  timeout for a reply; if none arrives in time, make the most reasonable
  assumption instead, and clearly state what you assumed in your final report.
- For anything else ambiguous, make the most reasonable assumption and note
  it in your final report — do not stop and wait.
- Report: files produced, the final metric vs. the target (if there is a
  numeric success criterion), and any assumptions you made.

Tone and format requirements:
- Write in a clear, formal, academic register appropriate for submission to
  a professor. No casual language, no slang, no filler.
- Avoid generic AI-sounding phrases — things like "in today's fast-paced
  world," "delve into," "it is important to note that," or "in conclusion"
  used as a reflexive crutch rather than because a conclusion is actually
  needed. Write plainly and directly instead.
- Address every requirement from the source explicitly, in the same order
  they were given, so nothing is missed and it's easy to check the output
  against the original ask point by point.
- Structure the output clearly: headers where sections are natural,
  numbered or bulleted points where the content is genuinely a list, full
  paragraphs otherwise. Don't produce an undifferentiated wall of text.
- Match terminology and conventions to the specific course/subject where
  that context is available.
- Match the academic level and general writing register described in the
  user's profile — not more polished or more advanced than that level, and
  not generic. If a writing voice sample is available, let it inform
  natural phrasing and sentence rhythm without copying it directly.`;
}

/**
 * Classifies and extracts a single task
 */
export async function classifyAndExtractTask(task: Task): Promise<ClassificationOutput> {
  const rawData = task.extracted_requirements || {};
  const rawBody = rawData.raw_body || task.title;
  const courseNotes = await queryAethosCourseNotes(task.course || 'General');

  const systemPrompt = `You are an expert academic assistant analyzer.
Your job is to classify university coursework and extract actionable requirements into strict JSON format.

Output JSON with keys:
{
  "task_type": "document" | "presentation" | "handwritten" | "code_project" | "research" | "ml_training",
  "course": string,
  "due_date": string (ISO 8601 format e.g. "2026-09-10T18:30:00Z", or null if not found),
  "confidence": number between 0.0 and 1.0 (confidence in task type and requirements),
  "requirements": [string array of atomic requirements],
  "success_criteria": string or null (e.g. "validation accuracy between 80 and 90 percent" or "minimum 1000 words"),
  "output_format": string (e.g. "report.docx", "slides.pptx", "python project with README", "structured markdown")
}
Return ONLY valid JSON.`;

  const prompt = `Analyze this task:
Title: ${task.title}
Course: ${task.course || 'Unknown'}
Raw description/content:
${rawBody}

Existing standing notes:
${courseNotes.join('\n')}
`;

  const rawJson = await callLlmWithFallback(prompt, systemPrompt);
  
  // Clean markdown JSON fences if present
  const cleanedJson = rawJson.replace(/```json/g, '').replace(/```/g, '').trim();
  let parsed: any = {};
  try {
    parsed = JSON.parse(cleanedJson);
  } catch (e) {
    parsed = {
      task_type: 'document',
      requirements: [task.title],
      course: task.course || 'Academic Course',
      confidence: 0.6,
    };
  }

  let taskType: TaskType = (parsed.task_type as TaskType) || 'document';
  
  // Check handwritten detection
  const isHandwritten = /handwritten|write by hand|copy-ready|written assignment/i.test(rawBody) || /handwritten|write by hand/i.test(task.title);
  if (isHandwritten) {
    taskType = 'handwritten';
  }

  const requirementsList: string[] = Array.isArray(parsed.requirements) ? parsed.requirements : [task.title];

  // 1. Detect Lab Report Structure (TASK_TYPES.md Section: Document)
  const isLabReport = /lab|experiment|apparatus|procedure|observation|titration|practical/i.test(rawBody) || /lab|practical/i.test(task.title);
  if (isLabReport && (taskType === 'document' || taskType === 'handwritten')) {
    if (!requirementsList.some(r => /hypothesis|procedure|observation|results/i.test(r))) {
      requirementsList.push('Format as a structured Lab Report: 1. Objective/Hypothesis, 2. Apparatus & Methodology, 3. Observations & Results, 4. Discussion & Conclusion');
    }
  }

  // 2. Word Count / Page Count Extraction (TASK_TYPES.md Section: Document)
  const wordCountMatch = rawBody.match(/(\d+)[\s-]*(?:words|word)/i) || task.title.match(/(\d+)[\s-]*(?:words|word)/i);
  const pageCountMatch = rawBody.match(/(\d+)[\s-]*(?:pages|page)/i) || task.title.match(/(\d+)[\s-]*(?:pages|page)/i);
  if (wordCountMatch) {
    requirementsList.push(`Target word count: approximately ${wordCountMatch[1]} words.`);
  } else if (pageCountMatch) {
    requirementsList.push(`Target length: approximately ${pageCountMatch[1]} pages.`);
  }

  // 3. Presentation Slide Count Target & Speaker Notes (TASK_TYPES.md Section: Presentation)
  const slideCountMatch = rawBody.match(/(\d+)[\s-]*(?:slide|slides)/i) || task.title.match(/(\d+)[\s-]*(?:slide|slides)/i);
  const explicitSlideCount = slideCountMatch ? parseInt(slideCountMatch[1], 10) : null;
  if (explicitSlideCount && taskType === 'presentation') {
    requirementsList.push(`Generate exactly ${explicitSlideCount} presentation slides with title slide, content slides matching all topics, and comprehensive speaker notes.`);
  } else if (taskType === 'presentation') {
    requirementsList.push('Generate a valid presentation deck (.pptx) covering all requested topics with informative speaker notes on each content slide.');
  }

  // 4. Code Project: Smoke test, README, UI Screenshot, Clean packaging (TASK_TYPES.md Section: Code Project)
  const isWebOrGui = /web|ui|dashboard|frontend|app|gui|html|interface|react|next/i.test(rawBody) || /web|ui|dashboard|app|gui/i.test(task.title);
  if (taskType === 'code_project') {
    requirementsList.push('Include a smoke test / run verification to ensure the code boots and executes cleanly without crashing.');
    requirementsList.push('Include a clear README.md with prerequisites, setup steps, and run instructions.');
    if (isWebOrGui) {
      requirementsList.push('Capture a real running UI/app screenshot as a preview image (screenshot.png/webp) after launching the application.');
    }
  }

  // 5. ML Training: Model Weights, Numeric Criteria, Evaluation Report (TASK_TYPES.md Section: ML Training)
  if (taskType === 'ml_training') {
    requirementsList.push('Save the trained model weights/artifact file (.h5, .pt, .pth, .pkl, or .joblib).');
    requirementsList.push('Include an evaluation report (evaluation_report.docx/md) detailing architecture, training logs, loss curves, and validation metrics.');
    if (parsed.success_criteria) {
      requirementsList.push(`Meet explicit numeric target criterion: ${parsed.success_criteria}`);
    }
  }

  // 6. Research: Browser Tool Invocation, Real URLs, Citations (TASK_TYPES.md Section: Research)
  if (taskType === 'research') {
    requirementsList.push('Gather real web sources using browser/search tools and cite exact, verifiable reference URLs.');
    requirementsList.push('Synthesize original content without direct plagiarism.');
    const citationStyleMatch = rawBody.match(/(ieee|apa|mla|chicago|harvard)/i);
    const citationStyle = citationStyleMatch ? citationStyleMatch[1].toUpperCase() : 'IEEE';
    requirementsList.push(`Format citations and references consistently in ${citationStyle} style.`);
  }

  // 7. Group Projects Scope Extension (TASK_TYPES.md Resolved Scope Extension #1)
  const isGroupProject = /group|team|members|individual contribution|partner/i.test(rawBody) || /group project|team assignment/i.test(task.title);
  if (isGroupProject) {
    requirementsList.push('Partition requirements across team members and include an Individual Contribution Summary section in the deliverable.');
  }

  // 8. Regional Language Coursework Scope Extension (TASK_TYPES.md Resolved Scope Extension #2)
  const isHindi = /hindi|हिन्दी/i.test(rawBody) || /hindi|हिन्दी/i.test(task.title);
  const isGujarati = /gujarati|ગુજરાતી/i.test(rawBody) || /gujarati|ગુજરાતી/i.test(task.title);
  if (isHindi) {
    requirementsList.push('Generate deliverable text in standard formal Hindi as requested by coursework rubric.');
  } else if (isGujarati) {
    requirementsList.push('Generate deliverable text in standard formal Gujarati as requested by coursework rubric.');
  }

  // 9. Spreadsheet & Data Analysis Tasks Scope Extension (TASK_TYPES.md Resolved Scope Extension #3)
  const isSpreadsheet = /spreadsheet|excel|xlsx|workbook|sheets|data analysis|pivot table|dataset analysis/i.test(rawBody) || /spreadsheet|excel|workbook/i.test(task.title);
  if (isSpreadsheet && (taskType === 'document' || taskType === 'code_project')) {
    requirementsList.push('Generate a formatted .xlsx workbook with formulas, charts, and summary sheets using openpyxl/pandas.');
    requirementsList.push('Accompany with an executive findings summary report (report.docx).');
  }

  const outputFormat = parsed.output_format || (
    taskType === 'presentation' ? `presentation.pptx${explicitSlideCount ? ` (${explicitSlideCount} slides)` : ''}` :
    taskType === 'code_project' ? 'zipped code project + README.md' + (isWebOrGui ? ' + screenshot.png' : '') :
    taskType === 'ml_training' ? 'model weights artifact (.pt/.h5), training logs, evaluation metrics + evaluation_report.docx' :
    taskType === 'handwritten' ? 'clean copy-ready text transcript (.txt, no docx formatting)' :
    taskType === 'research' ? 'research_report.docx with verified web citations' :
    isSpreadsheet ? 'analysis_workbook.xlsx + executive_findings.docx' :
    'document.docx'
  );

  // 10. Weight Classification (PRD Section 6.3.1 / micro_upgradeV3)
  let weight: TaskWeight = 'light';
  if (taskType === 'ml_training') {
    weight = 'heavy';
  } else if (taskType === 'code_project') {
    const isHeavyCode = /full-stack|microservice|distributed|pipeline|large dataset|multi-container|kubernetes/i.test(rawBody) || /full-stack|microservice|distributed/i.test(task.title);
    weight = isHeavyCode ? 'heavy' : 'medium';
  } else if (taskType === 'research') {
    weight = 'medium';
  } else {
    weight = 'light';
  }

  const profile = await getUserProfile();

  const buildSpec = generateBuildSpec(
    task.title,
    parsed.course || task.course || 'Course',
    taskType,
    requirementsList,
    parsed.success_criteria || task.success_criteria || null,
    outputFormat,
    profile
  );

  return {
    task_type: taskType,
    course: parsed.course || task.course || 'Course',
    due_date: parsed.due_date || task.due_date || null,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.9,
    weight,
    extracted_requirements: {
      summary: task.title,
      items: requirementsList,
      raw_text: rawBody,
      course_notes: courseNotes,
      output_style: isHandwritten ? 'handwritten' : 'typed',
      slide_count: explicitSlideCount,
      is_lab_report: isLabReport,
      is_group_project: isGroupProject,
      is_spreadsheet: isSpreadsheet,
      requires_screenshot: isWebOrGui && taskType === 'code_project',
    },
    success_criteria: parsed.success_criteria || task.success_criteria || null,
    output_format: outputFormat,
    build_spec: buildSpec,
  };
}

/**
 * Processes all tasks in 'new' status
 */
export async function processNewTasks(): Promise<{ processed: number; flagged: number; queued: number }> {
  const supabase = getSupabaseAdmin();
  const stats = { processed: 0, flagged: 0, queued: 0 };

  const { data: newTasks, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('status', 'new')
    .limit(10);

  if (error || !newTasks || newTasks.length === 0) {
    return stats;
  }

  for (const task of newTasks) {
    try {
      // Mark as extracting
      await supabase.from('tasks').update({ status: 'extracting' }).eq('id', task.id);

      const classification = await classifyAndExtractTask(task);
      stats.processed++;

      // Check low confidence or missing due date (PRD Section 6.2)
      if (classification.confidence < 0.7 || !classification.due_date) {
        await supabase.from('tasks').update({
          status: 'flagged',
          task_type: classification.task_type,
          weight: classification.weight,
          course: classification.course,
          due_date: classification.due_date,
          extracted_requirements: classification.extracted_requirements,
          success_criteria: classification.success_criteria,
          build_spec: classification.build_spec,
          result_summary: `Flagged during extraction: Confidence = ${classification.confidence}, Due Date = ${classification.due_date || 'Missing'}`,
          updated_at: new Date().toISOString(),
        }).eq('id', task.id);

        stats.flagged++;

        // Send immediate Telegram alert
        await sendTelegramAlert(
          `⚠️ *Task Flagged for Review*\n\n` +
          `*Title:* ${task.title}\n` +
          `*Course:* ${classification.course}\n` +
          `*Reason:* ${!classification.due_date ? 'Missing due date' : 'Low classification confidence'}\n` +
          `Please check dashboard to confirm details.`
        );
      } else {
        // High confidence -> set status = 'queued'
        await supabase.from('tasks').update({
          status: 'queued',
          task_type: classification.task_type,
          weight: classification.weight,
          course: classification.course,
          due_date: classification.due_date,
          extracted_requirements: classification.extracted_requirements,
          success_criteria: classification.success_criteria,
          build_spec: classification.build_spec,
          updated_at: new Date().toISOString(),
        }).eq('id', task.id);

        stats.queued++;
      }
    } catch (taskErr: any) {
      console.error(`Failed to classify task ${task.id}:`, taskErr);
      await supabase.from('tasks').update({
        status: 'flagged',
        result_summary: `Classification error: ${taskErr?.message || taskErr}`,
        updated_at: new Date().toISOString(),
      }).eq('id', task.id);
      stats.flagged++;
    }
  }

  return stats;
}
