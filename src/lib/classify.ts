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
 * Call LLM with multi-provider fallback:
 * Primary: OpenRouter (MiniMax or configured model)
 * Fallback 1: Groq (llama-3.3-70b-versatile)
 * Fallback 2: Secondary OpenRouter model (meta-llama/llama-3.3-70b-instruct:free)
 */
async function callLlmWithFallback(prompt: string, systemPrompt: string): Promise<string> {
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;

  // 1. Primary: OpenRouter
  if (openRouterKey) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openRouterKey}`,
          'HTTP-Referer': process.env.HTTP_REFERER || 'https://vicarius-agent.local',
          'X-Title': 'Vicarius Agent',
        },
        body: JSON.stringify({
          model: process.env.OPENROUTER_MODEL || 'minimax/minimax-m3:free',
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
        console.warn(`OpenRouter primary failed (${res.status}): ${errBody}. Falling back to Groq...`);
        await logSystemEvent('warning', 'classify', `OpenRouter primary failed: ${res.statusText}. Triggering Groq fallback.`);
      }
    } catch (orErr: any) {
      console.warn('OpenRouter primary network error. Falling back to Groq:', orErr?.message || orErr);
      await logSystemEvent('warning', 'classify', `OpenRouter primary error: ${orErr?.message || orErr}. Triggering Groq fallback.`);
    }
  }

  // 2. Fallback 1: Groq (qwen/qwen3.8-27b)
  if (groqKey) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groqKey}`,
        },
        body: JSON.stringify({
          model: process.env.GROQ_MODEL || 'qwen/qwen3.8-27b',
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
        if (content) {
          console.log('[Classify] Successfully recovered using Groq llama-3.3-70b-versatile');
          await logSystemEvent('info', 'classify', 'Successfully completed classification using Groq fallback.');
          return content;
        }
      } else {
        const errBody = await res.text();
        console.warn(`Groq fallback failed (${res.status}): ${errBody}. Trying secondary OpenRouter...`);
        await logSystemEvent('warning', 'classify', `Groq fallback failed: ${res.statusText}`);
      }
    } catch (groqErr: any) {
      console.warn('Groq fallback error:', groqErr?.message || groqErr);
      await logSystemEvent('warning', 'classify', `Groq fallback error: ${groqErr?.message || groqErr}`);
    }
  }

  // 3. Fallback 2: Secondary OpenRouter model
  if (openRouterKey) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openRouterKey}`,
        },
        body: JSON.stringify({
          model: 'meta-llama/llama-3.3-70b-instruct:free',
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
      }
    } catch (e: any) {
      console.error('Secondary OpenRouter fallback error:', e?.message || e);
    }
  }

  throw new Error('All LLM classification providers (OpenRouter primary, Groq fallback, OpenRouter secondary) failed.');
}

/**
 * Call Gemini Flash for vision/PDF extraction with OpenRouter Vision fallback (C5 prompt)
 */
async function extractAttachmentContent(attachmentName: string, mimeType?: string, base64Data?: string): Promise<string> {
  const geminiKey = process.env.GEMINI_API_KEY;
  const geminiModelId = process.env.GEMINI_VISION_MODEL || 'gemini-1.5-flash';
  const openRouterKey = process.env.OPENROUTER_API_KEY;

  const c5Prompt = `You are reading an assignment instruction sheet (PDF page or photo). Extract, as plain structured text, everything needed to complete it — do not solve it:
- Deliverable type and required output format, if stated.
- Every numbered/lettered task or question, transcribed VERBATIM and in order.
- Explicit success criteria (accuracy target, word/slide/page count, required sections, rubric points, mark allocations).
- Constraints (citation style, language, tools/libraries required or banned).
- Any deadline visible on the sheet.
If the image is unreadable or has no extractable text, say exactly:
"NO_EXTRACTABLE_CONTENT" and nothing else.`;

  // 1. Primary: Gemini Flash
  if (geminiKey && base64Data && mimeType) {
    try {
      const genAI = new GoogleGenerativeAI(geminiKey);
      const model = genAI.getGenerativeModel({ model: geminiModelId });

      const result = await model.generateContent([
        c5Prompt,
        {
          inlineData: {
            data: base64Data,
            mimeType: mimeType,
          },
        },
      ]);
      const text = result.response.text();
      if (text && text.trim() && !text.includes('NO_EXTRACTABLE_CONTENT')) return text.trim();
    } catch (geminiErr: any) {
      console.warn(`Gemini (${geminiModelId}) vision failed. Falling back to OpenRouter vision:`, geminiErr?.message || geminiErr);
      await logSystemEvent('warning', 'classify', `Gemini vision failed (${geminiErr?.message || geminiErr}). Triggering OpenRouter vision fallback.`);
    }
  }

  // 2. Fallback: OpenRouter Vision
  if (openRouterKey && base64Data && mimeType) {
    try {
      const imageUrl = `data:${mimeType};base64,${base64Data}`;
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openRouterKey}`,
        },
        body: JSON.stringify({
          model: 'meta-llama/llama-3.2-11b-vision-instruct:free',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: c5Prompt },
                { type: 'image_url', image_url: { url: imageUrl } },
              ],
            },
          ],
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content;
        if (text && text.trim() && !text.includes('NO_EXTRACTABLE_CONTENT')) {
          console.log('[Classify] Extracted vision content using OpenRouter vision fallback');
          await logSystemEvent('info', 'classify', 'Extracted attachment via OpenRouter vision fallback.');
          return text.trim();
        }
      }
    } catch (orVisionErr: any) {
      console.warn('OpenRouter vision fallback error:', orVisionErr?.message || orVisionErr);
      await logSystemEvent('warning', 'classify', `OpenRouter vision fallback error: ${orVisionErr?.message || orVisionErr}`);
    }
  }

  await logSystemEvent('warning', 'classify', `Attachment text extraction failed for '${attachmentName}' — using filename reference only.`);
  return `Attachment: ${attachmentName} (${mimeType || 'unknown'})`;
}

import { queryAethosCourseNotes } from './aethos';

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
 * Generates the standardized Build Spec template (C2 & C3 per IMPLEMENT.md)
 */
export function generateBuildSpec(
  title: string,
  course: string,
  taskType: TaskType,
  requirementsList: string[],
  successCriteria: string | null,
  outputFormat: string,
  profile?: UserProfile,
  courseNotes?: string[],
  weight: TaskWeight = 'light',
  dueDate?: string | null
): string {
  // Format requirements with R1..Rn
  const reqsFormatted = requirementsList.map((r, idx) => {
    const cleaned = r.replace(/^R\d+[:.]\s*/i, '').replace(/^-\s*/, '');
    return `R${idx + 1}. ${cleaned}`;
  }).join('\n');

  const criteriaFormatted = successCriteria ? successCriteria : 'none stated';

  const isUiTask = taskType === 'code_project' || taskType === 'presentation' || /web|ui|dashboard|frontend|app|react|html|css|slides/i.test(title);
  const designDirective = isUiTask ? `\n\nUI & Visual Design System (MANDATORY — from docx/DESIGN.md):
- Follow the Cognitive Heritage design system:
  • Colors: Surface (#fff8f4), Surface-Container (#fdebd9), Surface-Container-High (#f7e5d4), On-Surface (#231a0f), Primary (#705728), Primary-Container (#8b6f3e), Secondary (#645e4e), Outline (#7f7669).
  • Typography: Headings ('Noto Serif' 600/700), Body & Controls ('Manrope' 400/600).
  • Visual Standards: Clean card-based structure, smooth micro-interactions (0.2s cubic-bezier), modern border-radius (8px buttons, 12px cards, 9999px badges), and high legibility.` : '';

  const studentContext = profile ? `\n\nStudent context (write to THIS level and register, not a generic AI default):
- ${profile.full_name}, ${profile.program}, ${profile.current_semester}, ${profile.university}
- Academic register: ${profile.academic_level_note || 'Formal undergraduate technical standard'}
- Citation style: ${profile.default_citation_style || 'IEEE'}
- Voice reference (inform phrasing/rhythm; do NOT copy): "${profile.writing_voice_sample || ''}"` : '';

  const aethosContext = courseNotes && courseNotes.length > 0
    ? `\n\nStanding course notes (past corrections — honor these):\n${courseNotes.map(n => `- ${n}`).join('\n')}`
    : `\n\nStanding course notes (past corrections — honor these):\n- none`;

  // C3 Task-Type Inserts
  let taskTypeInsert = '';
  if (taskType === 'document') {
    taskTypeInsert = `\n\nTask-Specific Guidance (Document):
- Default to introduction → body → conclusion unless the source implies another structure (lab report: Objective/Hypothesis, Apparatus & Method, Observations & Results, Discussion & Conclusion; formal letter: follow letter conventions).
- If a word/page target exists, hit it within ±10% and report the actual count.`;
  } else if (taskType === 'presentation') {
    taskTypeInsert = `\n\nTask-Specific Guidance (Presentation):
- Slides are visual-first: a title + 3–6 concise bullets each, never pasted paragraphs. Depth goes in speaker notes on every content slide.
- Produce EXACTLY the requested slide count (incl. a title slide). Report the count.`;
  } else if (taskType === 'code_project') {
    taskTypeInsert = `\n\nTask-Specific Guidance (Code Project):
- Idiomatic style for the language; meaningful names; comments only where they aid understanding. No leftover TODO/placeholder in delivered code.
- Include a README (prereqs, setup, run) and a smoke test proving it boots.
- If it's a UI/web app, launch it and capture a real screenshot (screenshot.png).
- Zip excludes node_modules, .venv, __pycache__, .git, .next, dist, build.`;
  } else if (taskType === 'ml_training') {
    taskTypeInsert = `\n\nTask-Specific Guidance (ML Training):
- The numeric target is a hard pass/fail: iterate (epochs/arch/hyperparameters) until you meet it or exhaust a reasonable attempt budget; report the ACTUAL final number either way — never claim a number you didn't measure.
- Checkpoint every few epochs to ./checkpoints/ and resume from the latest if present (an interrupted run must not restart from zero).
- Check GPU availability first; if CPU-only and the run would be very long, reduce scope (smaller sample/fewer epochs) and say so in assumptions, or ask_human.
- Deliver: model weights artifact, training logs/loss curve, and an evaluation_report.docx written in the same formal register as a document task.`;
  } else if (taskType === 'research') {
    taskTypeInsert = `\n\nTask-Specific Guidance (Research):
- Use real web search; cite exact, reachable URLs in ${profile?.default_citation_style || 'IEEE'} style. No invented or approximate sources.
- Original synthesis in your own framing — never lightly reworded copying.`;
  } else if (taskType === 'handwritten') {
    taskTypeInsert = `\n\nTask-Specific Guidance (Handwritten):
- Output clean, copy-ready plain text (.txt) the student will transcribe by hand. No .docx styling, no markdown artifacts, no page furniture — just the text.`;
  }

  return `Task: ${title}
Course / type: ${course || 'Academic Course'} — ${taskType}   (weight: ${weight})
Due (IST): ${dueDate || 'Not specified'}

Requirements — address every one, in this exact order, and reference its ID in your final report:
${reqsFormatted}

Success criteria (mechanical pass/fail): ${criteriaFormatted}
Output format: ${outputFormat}${studentContext}${designDirective}${aethosContext}${taskTypeInsert}

How to work:
- Work to completion without stopping for approval; your permissions cover everything needed here.
- If — and only if — you hit a genuine blocker (a real choice that changes the deliverable and isn't a minor judgment call), call the ask_human tool with a single specific question. Wait up to the configured timeout; if no answer comes, pick the most reasonable option and record it under "assumptions".
- For ordinary ambiguity, choose the most reasonable interpretation and note it — do not stop.

Before you finish (self-check — do this, don't assume):
- Re-read R1..Rn and confirm each is actually addressed in the artifact, in order.
- Open/run the file you produced and confirm it's valid: a .docx opens and hits the word/section target; a .pptx has exactly the required slide count; code actually runs a smoke test; a model file exists and the reported metric is real.
- Remove any placeholder, TODO, or lorem text.

Tone & format (mandatory):
- Formal academic register fit for submission to a professor. Plain and direct.
- BANNED phrasings (do not use): "in today's fast-paced world", "in today's digital era", "delve into", "it is important to note that", "as an AI language model", "in conclusion" used reflexively, "unlock the power of", "navigate the complexities of". Vary sentence structure; avoid the uniform three-sentence paragraph rhythm that reads as machine-written.
- Structure clearly: headings for real sections, lists only for genuine lists, full paragraphs otherwise. Match subject terminology to the course.

End your run with EXACTLY this JSON block, fenced, as the last thing you output:
\`\`\`json
{
  "files": [{ "name": "report.docx", "path": "./report.docx" }],
  "metrics": { "value": null, "target": null, "unit": null },
  "requirement_coverage": [{ "id": "R1", "addressed": true, "where": "Section 2" }],
  "assumptions": ["..."],
  "notes": "anything the user should double-check"
}
\`\`\``;
}

/**
 * Classifies and extracts a single task
 */
export async function classifyAndExtractTask(task: Task): Promise<ClassificationOutput> {
  const rawData = task.extracted_requirements || {};
  const rawBody = rawData.raw_body || task.title;
  const courseNotes = await queryAethosCourseNotes(task.course || 'General');

  // C1 System Prompt from IMPLEMENT.md
  const systemPrompt = `You are the classification and extraction stage of an academic task agent for a single university student. Your only job: read one piece of coursework (an email or Classroom item, plus any extracted attachment text) and output a strict JSON object describing what must be produced. You do not write the deliverable here.

Think step by step internally, then output ONLY the JSON — no prose, no code fence.

Rules:
- REQUIREMENTS must be atomic and preserved in the SAME ORDER as the source. If the source has 5 numbered questions, output 5 requirements, R1..R5, in that order, each self-contained. Never merge, reorder, or summarize away a requirement.
- DUE DATE: resolve relative dates ("by next Friday", "in 2 weeks") against the item's posted date, expressed in Asia/Kolkata (IST), ISO 8601. If several dates appear, choose the submission deadline. If none is findable, use null.
- CONFIDENCE rubric: 0.9–1.0 = task type and every requirement are unambiguous; 0.7–0.9 = minor ambiguity; 0.5–0.7 = a specific thing is unclear (say what in flag_reason); <0.5 = you are largely guessing. Do not inflate.
- WEIGHT: ml_training => heavy. code_project => heavy only if large/complex (full-stack, distributed, large dataset), else medium. research => medium. document/presentation/handwritten => light. Override if the text clearly implies a longer runtime.
- SUCCESS CRITERIA: capture any explicit, checkable target verbatim (accuracy range, word count, slide count, required sections). null if none stated.

Output JSON exactly:
{
  "task_type": "document|presentation|handwritten|code_project|research|ml_training",
  "course": string,
  "due_date": string|null,
  "confidence": number,
  "flag_reason": string|null,
  "weight": "light|medium|heavy",
  "requirements": [
    { "id": "R1", "text": string, "verbatim": boolean }
  ],
  "success_criteria": string|null,
  "output_format": string
}`;

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

  const rawRequirements = Array.isArray(parsed.requirements) ? parsed.requirements : [task.title];
  const requirementsList: string[] = rawRequirements.map((r: any, idx: number) => {
    if (typeof r === 'string') return r;
    if (r && typeof r === 'object' && r.text) {
      return `${r.id || `R${idx + 1}`}: ${r.text}`;
    }
    return JSON.stringify(r);
  });

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
    profile,
    courseNotes,
    weight,
    parsed.due_date || task.due_date || null
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
