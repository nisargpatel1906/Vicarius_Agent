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

export interface Task {
  id: string;
  source: TaskSource;
  external_id: string;
  course: string | null;
  title: string;
  task_type: TaskType;
  extracted_requirements: Record<string, any> | null;
  success_criteria: string | null;
  build_spec: string | null;
  due_date: string | null;
  status: TaskStatus;
  worker_id: string | null;
  claimed_at: string | null;
  result_summary: string | null;
  archived: boolean;
  created_at: string;
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
