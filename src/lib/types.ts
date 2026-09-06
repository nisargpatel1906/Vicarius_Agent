// Vicarius Agent TypeScript Types
// Sourced from PRD_academic_task_agent.md (Section 5, 6, 8)

export type TaskSource = 'gmail' | 'classroom';

export type TaskType = 
  | 'document' 
  | 'presentation' 
  | 'handwritten' 
  | 'code_project' 
  | 'research' 
  | 'ml_training';

export type OutputStyle = 'typed' | 'handwritten';

export interface ExtractedRequirements {
  summary: string;
  items: string[];
  raw_text?: string;
  raw_body?: string;
  course_notes?: string[];
  output_style?: OutputStyle;
  slide_count?: number | null;
  word_count?: number | null;
  is_lab_report?: boolean;
  is_group_project?: boolean;
  language?: string;
  citation_style?: string;
  requires_screenshot?: boolean;
  is_spreadsheet?: boolean;
  [key: string]: any;
}

export type TaskStatus = 
  | 'new' 
  | 'extracting' 
  | 'queued' 
  | 'claimed' 
  | 'building' 
  | 'verifying' 
  | 'flagged' 
  | 'done' 
  | 'failed';

export type QuestionStatus = 'pending' | 'answered' | 'timed_out';

export type DeliveredVia = 'email' | 'telegram' | 'both';

export type EventLevel = 'info' | 'warning' | 'error';

export type TaskWeight = 'light' | 'medium' | 'heavy';

export interface Task {
  id: string;
  source: TaskSource;
  external_id: string;
  course: string | null;
  title: string;
  task_type: TaskType;
  weight: TaskWeight;
  progress_note: string | null;
  last_progress_at: string | null;
  extracted_requirements: ExtractedRequirements | Record<string, any> | null;
  success_criteria: string | null;
  build_spec: string | null;
  due_date: string | null;
  status: TaskStatus;
  worker_id: string | null;
  claimed_at: string | null;
  result_summary: string | null;
  archived: boolean;
  posted_date?: string | null;
  error_message?: string | null;
  deliverables?: Deliverable[];
  questions?: Question[];
  created_at: string;
  updated_at: string;
}

export interface UserProfile {
  id: string;
  full_name: string;
  preferred_name?: string | null;
  email?: string | null;
  phone?: string | null;
  telegram_id?: string | null;
  enrollment_no?: string | null;
  university: string;
  department?: string | null;
  program: string;
  degree?: string | null;
  current_semester: string;
  graduation_year?: string | null;
  cgpa_or_target_grade?: string | null;
  bio?: string | null;
  skills?: string[] | null;
  research_interests?: string[] | null;
  custom_instructions?: string | null;
  custom_attributes?: Record<string, any> | null;
  default_citation_style: string;
  writing_voice_sample: string | null;
  academic_level_note: string | null;
  created_at?: string;
  updated_at: string;
}

export interface Question {
  id: string;
  task_id: string;
  question_text: string;
  answer_text: string | null;
  status: QuestionStatus;
  asked_at: string;
  answered_at: string | null;
}

export interface Deliverable {
  id: string;
  task_id: string;
  file_name: string;
  drive_link: string | null;
  file_type: string | null;
  delivered_via: DeliveredVia | null;
  delivered_at: string;
}

export interface SystemEvent {
  id: string;
  level: EventLevel;
  component: string;
  message: string;
  created_at: string;
}

export interface NormalizedRawItem {
  source: TaskSource;
  external_id: string;
  course: string | null;
  title: string;
  raw_body: string;
  attachments?: Array<{
    id?: string;
    name: string;
    mimeType?: string;
    dataBase64?: string;
    driveFileId?: string;
    url?: string;
    thumbnailUrl?: string;
    extracted_text?: string;
  }>;
  posted_date?: string;
  due_date?: string | null;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}

export interface KnowledgeItem {
  id?: string;
  source: TaskSource;
  external_id: string;
  course: string | null;
  title: string;
  content: string;
  embedding?: number[];
  metadata?: Record<string, any>;
  posted_date?: string;
}
