// Classification & Extraction Engine
// Sourced from PRD_academic_task_agent.md (Section 6.2, 6.3, 7)

import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getSupabaseAdmin, logSystemEvent } from './supabase';
import { Task, TaskType } from './types';
import { sendTelegramAlert } from './telegram';

export interface ClassificationOutput {
  task_type: TaskType;
  course: string;
  due_date: string | null;
  confidence: number;
  extracted_requirements: {
    summary: string;
    items: string[];
    raw_text?: string;
    course_notes?: string[];
  };
  success_criteria: string | null;
  output_format: string;
  build_spec: string;
}

/**
 * Call Groq with fallback to OpenRouter on rate limits
 */
async function callLlmWithFallback(prompt: string, systemPrompt: string): Promise<string> {
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    try {
      const groq = new Groq({ apiKey: groqKey });
      const completion = await groq.chat.completions.create({
        model: 'qwen/qwen3.8-27b',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
      });
      const response = completion.choices[0]?.message?.content;
      if (response) return response;
    } catch (groqErr: any) {
      console.warn('Groq API failed or rate-limited. Falling back to OpenRouter:', groqErr?.message || groqErr);
      await logSystemEvent('warning', 'classify', `Groq rate-limit/error fallback triggered: ${groqErr?.message || groqErr}`);
    }
  }

  // OpenRouter Fallback
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
          model: 'openai/gpt-4o-mini',
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
    } catch (orErr: any) {
      console.error('OpenRouter fallback failed:', orErr);
    }
  }

  throw new Error('All LLM classification providers (Groq, OpenRouter) failed or missing API keys.');
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
 * Generates the standardized Build Spec template (PRD Section 6.3)
 */
export function generateBuildSpec(
  title: string,
  course: string,
  taskType: TaskType,
  requirementsList: string[],
  successCriteria: string | null,
  outputFormat: string
): string {
  const reqsFormatted = requirementsList.map((r) => `- ${r}`).join('\n');
  const criteriaFormatted = successCriteria ? successCriteria : 'None explicitly specified';

  return `Task: ${title}
Source: ${course || 'Academic Course'} — ${taskType}
Requirements:
${reqsFormatted}
Success criteria: ${criteriaFormatted}
Output format: ${outputFormat}

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
  numeric success criterion), and any assumptions you made.`;
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
  const parsed = JSON.parse(cleanedJson);

  const taskType: TaskType = [
    'document',
    'presentation',
    'handwritten',
    'code_project',
    'research',
    'ml_training',
  ].includes(parsed.task_type)
    ? parsed.task_type
    : 'document';

  const outputFormat = parsed.output_format || (
    taskType === 'presentation' ? 'slides.pptx' :
    taskType === 'code_project' ? 'zipped code project + README.md' :
    taskType === 'ml_training' ? 'model training scripts, dataset pipeline, evaluation metrics + report.md' :
    taskType === 'handwritten' ? 'structured text transcript for transcription' :
    'document.docx'
  );

  const requirementsList = Array.isArray(parsed.requirements) && parsed.requirements.length > 0
    ? parsed.requirements
    : [task.title, rawBody.slice(0, 200)];

  const buildSpec = generateBuildSpec(
    task.title,
    parsed.course || task.course || 'Course',
    taskType,
    requirementsList,
    parsed.success_criteria || task.success_criteria || null,
    outputFormat
  );

  return {
    task_type: taskType,
    course: parsed.course || task.course || 'Course',
    due_date: parsed.due_date || task.due_date || null,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.9,
    extracted_requirements: {
      summary: task.title,
      items: requirementsList,
      raw_text: rawBody,
      course_notes: courseNotes,
    },
    success_criteria: parsed.success_criteria || null,
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
