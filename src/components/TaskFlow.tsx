'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Task, Deliverable, Question } from '@/lib/types';

// ─── Types mirrored from API route ────────────────────────────────────────────

interface PipelineNodeTrace {
  id: string;
  name: string;
  subtitle: string;
  status: 'done' | 'active' | 'pending' | 'retry' | 'skipped' | 'error';
  detail: string;
  retryCount?: number;
  qualityScore?: number;
  attemptCount?: number;
  order: number;
}

interface TaskTrace {
  task: Record<string, any>;
  deliverables: Deliverable[];
  questions: Question[];
  systemEvents: Array<{ id: string; level: string; component: string; message: string; created_at: string }>;
  pipelineNodes: PipelineNodeTrace[];
}

interface TaskFlowProps {
  tasks: Task[];
  selectedTask: Task | null;
  onSelectTask?: (task: Task) => void;
}

// ─── SVG Icon Set (no emojis) ──────────────────────────────────────────────────

const SvgCheck = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
    <circle cx="7" cy="7" r="6.5" fill="#276a3c" />
    <path d="M 3.5 7 L 6 9.5 L 10.5 5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </svg>
);

const SvgSpinner = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none" className="spin-slow">
    <circle cx="7" cy="7" r="5.5" stroke="#705728" strokeWidth="2" strokeDasharray="20 14" strokeLinecap="round" />
  </svg>
);

const SvgRetry = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
    <circle cx="7" cy="7" r="6.5" fill="#e67e22" />
    <path d="M 9.5 7 A 2.5 2.5 0 1 1 8 4.7" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    <polygon points="7.5,3.2 9.8,4.5 8.2,5.9" fill="#fff" />
  </svg>
);

const SvgSkip = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
    <circle cx="7" cy="7" r="6.5" fill="#d1c5b6" />
    <line x1="4" y1="7" x2="10" y2="7" stroke="#7f7669" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const SvgError = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
    <circle cx="7" cy="7" r="6.5" fill="#ba1a1a" />
    <line x1="5" y1="5" x2="9" y2="9" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    <line x1="9" y1="5" x2="5" y2="9" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const SvgPending = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
    <circle cx="7" cy="7" r="6.5" stroke="#d1c5b6" strokeWidth="1.5" fill="#fff8f4" />
    <circle cx="7" cy="7" r="2" fill="#d1c5b6" />
  </svg>
);

const SvgDrive = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <polygon points="0,12 4.7,4 9.3,12" fill="#f4b400" />
    <polygon points="4.7,4 9.3,4 14,12 9.3,12" fill="#0f9d58" />
    <polygon points="0,12 4.7,12 7,8 2.3,8" fill="#4285f4" />
  </svg>
);

const SvgQuestion = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <circle cx="7" cy="7" r="6.5" stroke="var(--primary)" strokeWidth="1.3" fill="var(--surface-container)" />
    <text x="7" y="10.5" textAnchor="middle" fontSize="8" fontWeight="700" fill="var(--primary)">?</text>
  </svg>
);

const SvgEvent = ({ level }: { level: string }) => {
  const colors: Record<string, string> = { error: '#ba1a1a', warning: '#e67e22', info: '#705728' };
  const c = colors[level] || '#705728';
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" style={{ flexShrink: 0, marginTop: 2 }}>
      <circle cx="4" cy="4" r="3.5" fill={c} />
    </svg>
  );
};

const SvgFile = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M2 1 H8 L12 5 V13 H2 Z" stroke="var(--primary)" strokeWidth="1.2" fill="var(--surface-container)" strokeLinejoin="round" />
    <path d="M8 1 V5 H12" stroke="var(--primary)" strokeWidth="1.2" fill="none" strokeLinejoin="round" />
    <line x1="4" y1="7.5" x2="10" y2="7.5" stroke="var(--outline)" strokeWidth="1" />
    <line x1="4" y1="9.5" x2="8" y2="9.5" stroke="var(--outline)" strokeWidth="1" />
  </svg>
);

const SvgExternal = () => (
  <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
    <path d="M5 2H2V9H9V6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
    <path d="M7 1H10V4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
    <line x1="10" y1="1" x2="5.5" y2="5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

const SvgRefresh = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
    <path d="M 10 6.5 A 3.5 3.5 0 1 1 8.5 3.2" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    <polygon points="8,1.5 11,3 9,5" fill="currentColor" />
  </svg>
);

const SvgJson = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
    <text x="0" y="10" fontSize="9" fontWeight="700" fill="var(--primary)" fontFamily="monospace">{'{}'}</text>
  </svg>
);

// ─── Status helpers ────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  new:        { bg: '#e8e0d4', color: '#4d463a', label: 'New' },
  extracting: { bg: '#fff1e5', color: '#705728', label: 'Extracting' },
  queued:     { bg: '#fdf5ea', color: '#8b6f3e', label: 'Queued' },
  claimed:    { bg: '#e8f4ff', color: '#2563eb', label: 'Claimed' },
  building:   { bg: '#f3e8ff', color: '#7c3aed', label: 'Building' },
  verifying:  { bg: '#fffbea', color: '#92400e', label: 'Verifying' },
  flagged:    { bg: '#fff1f0', color: '#ba1a1a', label: 'Flagged' },
  done:       { bg: '#e2f0d9', color: '#276a3c', label: 'Done' },
  failed:     { bg: '#ffe5e5', color: '#ba1a1a', label: 'Failed' },
};

const TYPE_LABELS: Record<string, string> = {
  document: 'Document',
  presentation: 'Presentation',
  handwritten: 'Handwritten',
  code_project: 'Code Project',
  research: 'Research',
  ml_training: 'ML Training',
};

const WEIGHT_COLORS: Record<string, string> = {
  light: '#276a3c',
  medium: '#e67e22',
  heavy: '#ba1a1a',
};

function nodeStatusIcon(status: PipelineNodeTrace['status']) {
  switch (status) {
    case 'done':    return <SvgCheck size={18} />;
    case 'active':  return <SvgSpinner size={18} />;
    case 'retry':   return <SvgRetry size={18} />;
    case 'skipped': return <SvgSkip size={18} />;
    case 'error':   return <SvgError size={18} />;
    default:        return <SvgPending size={18} />;
  }
}

function nodeStatusColor(status: PipelineNodeTrace['status']): string {
  switch (status) {
    case 'done':    return '#276a3c';
    case 'active':  return '#705728';
    case 'retry':   return '#e67e22';
    case 'error':   return '#ba1a1a';
    case 'skipped': return '#7f7669';
    default:        return '#d1c5b6';
  }
}

function formatRelTime(iso: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'N/A';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function getFileTypeBadge(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    pptx: 'PPTX', ppt: 'PPT', pdf: 'PDF',
    docx: 'DOCX', doc: 'DOC', xlsx: 'XLSX',
    zip: 'ZIP', py: 'PY', ipynb: 'IPYNB', txt: 'TXT',
  };
  return map[ext] || ext.toUpperCase() || 'FILE';
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function TaskFlow({ tasks, selectedTask, onSelectTask }: TaskFlowProps) {
  const [tracedTask, setTracedTask] = useState<Task | null>(selectedTask);
  const [trace, setTrace] = useState<TaskTrace | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRawJson, setShowRawJson] = useState(false);
  const [expandedNode, setExpandedNode] = useState<string | null>(null);

  // Fetch the task trace from API
  const fetchTrace = useCallback(async (task: Task) => {
    setLoading(true);
    setError(null);
    setTrace(null);
    try {
      const res = await fetch(`/api/task-trace/${task.id}`, {
        headers: { 'x-dashboard-secret': process.env.NEXT_PUBLIC_DASHBOARD_SECRET || '' },
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || 'Fetch failed');
      setTrace(json.data as TaskTrace);
    } catch (e: any) {
      setError(e.message || 'Could not load trace');
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-load when a task is selected
  useEffect(() => {
    if (tracedTask) fetchTrace(tracedTask);
  }, [tracedTask, fetchTrace]);

  // Sync external selectedTask prop
  useEffect(() => {
    if (selectedTask && selectedTask.id !== tracedTask?.id) {
      setTracedTask(selectedTask);
    }
  }, [selectedTask]);

  const handleSelectTask = (task: Task) => {
    setTracedTask(task);
    setExpandedNode(null);
    if (onSelectTask) onSelectTask(task);
  };

  const activeTasks = tasks.filter((t) => !t.archived);
  const archivedTasks = tasks.filter((t) => t.archived);

  return (
    <div style={{ display: 'flex', gap: 0, minHeight: 600, border: '1px solid var(--outline-variant)', borderRadius: 12, overflow: 'hidden', background: 'var(--surface)' }}>

      {/* ── Left Panel: Task Selector ── */}
      <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid var(--outline-variant)', background: 'var(--surface-container)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--outline-variant)', background: 'var(--surface-container-high)' }}>
          <span style={{ fontFamily: "'Noto Serif', serif", fontWeight: 700, fontSize: '0.9rem', color: 'var(--on-surface)' }}>
            Select a Task
          </span>
          <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--on-surface-variant)' }}>
            {activeTasks.length} active &middot; {archivedTasks.length} archived
          </p>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {tasks.length === 0 && (
            <p style={{ padding: '16px', fontSize: '0.82rem', color: 'var(--on-surface-variant)', textAlign: 'center' }}>
              No tasks found.
            </p>
          )}
          {tasks.map((task) => {
            const sc = STATUS_COLORS[task.status] || STATUS_COLORS.new;
            const isSelected = tracedTask?.id === task.id;
            return (
              <button
                key={task.id}
                type="button"
                onClick={() => handleSelectTask(task)}
                style={{
                  width: '100%',
                  display: 'block',
                  textAlign: 'left',
                  padding: '10px 16px',
                  border: 'none',
                  borderLeft: isSelected ? '3px solid var(--primary)' : '3px solid transparent',
                  borderBottom: '1px solid var(--outline-variant)',
                  background: isSelected ? 'var(--surface)' : 'transparent',
                  cursor: 'pointer',
                  transition: 'all 0.12s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 3 }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--on-surface)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {task.title}
                  </span>
                  <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: 8, background: sc.bg, color: sc.color, flexShrink: 0 }}>
                    {sc.label}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--on-surface-variant)' }}>
                    {task.course || 'General'}
                  </span>
                  {task.weight && (
                    <span style={{ fontSize: '0.68rem', fontWeight: 700, color: WEIGHT_COLORS[task.weight] || 'var(--on-surface-variant)' }}>
                      [{task.weight.toUpperCase()}]
                    </span>
                  )}
                  {task.archived && (
                    <span style={{ fontSize: '0.68rem', color: '#7f7669', fontStyle: 'italic' }}>archived</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Right Panel: Trace View ── */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

        {/* Placeholder when no task selected */}
        {!tracedTask && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 40, color: 'var(--on-surface-variant)' }}>
            <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
              <rect x="8" y="6" width="28" height="36" rx="3" stroke="var(--outline-variant)" strokeWidth="2" fill="var(--surface-container)" />
              <line x1="14" y1="16" x2="30" y2="16" stroke="var(--outline-variant)" strokeWidth="1.5" />
              <line x1="14" y1="22" x2="30" y2="22" stroke="var(--outline-variant)" strokeWidth="1.5" />
              <line x1="14" y1="28" x2="24" y2="28" stroke="var(--outline-variant)" strokeWidth="1.5" />
              <circle cx="40" cy="40" r="12" fill="var(--surface-container)" stroke="var(--outline-variant)" strokeWidth="2" />
              <line x1="37" y1="40" x2="43" y2="40" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" />
              <line x1="40" y1="37" x2="40" y2="43" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontWeight: 700, color: 'var(--on-surface)', marginBottom: 4 }}>Select a task to trace</p>
              <p style={{ fontSize: '0.82rem' }}>Choose any task from the left panel to see the full end-to-end pipeline trace.</p>
            </div>
          </div>
        )}

        {/* Loading */}
        {tracedTask && loading && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, padding: 40 }}>
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" className="spin-slow">
              <circle cx="16" cy="16" r="13" stroke="var(--primary)" strokeWidth="3" strokeDasharray="50 32" strokeLinecap="round" />
            </svg>
            <span style={{ color: 'var(--on-surface-variant)', fontSize: '0.88rem' }}>Loading pipeline trace...</span>
          </div>
        )}

        {/* Error */}
        {tracedTask && error && !loading && (
          <div style={{ padding: 24 }}>
            <div style={{ background: '#fff1f0', border: '1px solid #ba1a1a', borderRadius: 8, padding: '12px 16px', color: '#ba1a1a', fontSize: '0.88rem' }}>
              <strong>Error loading trace:</strong> {error}
              <button type="button" onClick={() => fetchTrace(tracedTask)} style={{ marginLeft: 12, background: 'none', border: 'none', cursor: 'pointer', color: '#ba1a1a', textDecoration: 'underline', fontSize: '0.88rem' }}>
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Main trace view */}
        {trace && !loading && (
          <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* ── Task Header ── */}
            <div style={{ background: 'var(--surface-container)', border: '1px solid var(--outline-variant)', borderRadius: 10, padding: '14px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                    <h2 style={{ fontFamily: "'Noto Serif', serif", fontSize: '1.1rem', fontWeight: 700, color: 'var(--on-surface)', margin: 0 }}>
                      {trace.task.title}
                    </h2>
                    {(() => {
                      const sc = STATUS_COLORS[trace.task.status] || STATUS_COLORS.new;
                      return (
                        <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 10px', borderRadius: 10, background: sc.bg, color: sc.color }}>
                          {sc.label}
                        </span>
                      );
                    })()}
                  </div>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: '0.8rem', color: 'var(--on-surface-variant)' }}>
                    <span><strong>Course:</strong> {trace.task.course || 'General'}</span>
                    <span><strong>Type:</strong> {TYPE_LABELS[trace.task.task_type] || trace.task.task_type}</span>
                    <span style={{ color: WEIGHT_COLORS[trace.task.weight] || 'inherit' }}><strong>Weight:</strong> {trace.task.weight?.toUpperCase()}</span>
                    <span><strong>Source:</strong> {trace.task.source?.toUpperCase()}</span>
                    <span><strong>Due:</strong> {formatDate(trace.task.due_date)}</span>
                    <span><strong>Created:</strong> {formatRelTime(trace.task.created_at)}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => fetchTrace(tracedTask!)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', border: '1px solid var(--outline-variant)', borderRadius: 5, background: 'var(--surface)', color: 'var(--on-surface-variant)', cursor: 'pointer', fontSize: '0.8rem' }}
                  >
                    <SvgRefresh /> Refresh
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowRawJson(!showRawJson)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', border: '1px solid var(--outline-variant)', borderRadius: 5, background: showRawJson ? 'var(--primary)' : 'var(--surface)', color: showRawJson ? '#fff' : 'var(--on-surface-variant)', cursor: 'pointer', fontSize: '0.8rem' }}
                  >
                    <SvgJson /> Raw JSON
                  </button>
                </div>
              </div>
              {trace.task.result_summary && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--outline-variant)', fontSize: '0.82rem', color: 'var(--on-surface-variant)', fontStyle: 'italic' }}>
                  {trace.task.result_summary}
                </div>
              )}
            </div>

            {/* ── Pipeline Node Timeline ── */}
            <div>
              <h3 style={{ fontFamily: "'Noto Serif', serif", fontSize: '0.95rem', fontWeight: 700, color: 'var(--on-surface)', margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="1" y="1" width="14" height="14" rx="3" stroke="var(--primary)" strokeWidth="1.4" fill="var(--surface-container)" />
                  <line x1="5" y1="5" x2="11" y2="5" stroke="var(--primary)" strokeWidth="1.2" />
                  <line x1="5" y1="8" x2="11" y2="8" stroke="var(--primary)" strokeWidth="1.2" />
                  <line x1="5" y1="11" x2="9" y2="11" stroke="var(--primary)" strokeWidth="1.2" />
                </svg>
                LangGraph Pipeline Trace
                <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--on-surface-variant)' }}>
                  ({trace.pipelineNodes.filter((n) => n.status === 'done').length}/{trace.pipelineNodes.length} nodes complete)
                </span>
              </h3>

              <div style={{ position: 'relative' }}>
                {/* Vertical connector line */}
                <div style={{ position: 'absolute', left: 8, top: 18, bottom: 18, width: 2, background: 'var(--outline-variant)', zIndex: 0 }} />

                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {trace.pipelineNodes.map((node, idx) => {
                    const isExpanded = expandedNode === node.id;
                    const statusColor = nodeStatusColor(node.status);
                    return (
                      <div
                        key={node.id}
                        style={{ position: 'relative', zIndex: 1 }}
                      >
                        <button
                          type="button"
                          onClick={() => setExpandedNode(isExpanded ? null : node.id)}
                          style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 12,
                            padding: '10px 12px',
                            background: isExpanded ? 'var(--surface-container)' : 'transparent',
                            border: `1px solid ${isExpanded ? 'var(--outline-variant)' : 'transparent'}`,
                            borderRadius: 8,
                            cursor: 'pointer',
                            textAlign: 'left',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          {/* Icon */}
                          <div style={{ flexShrink: 0, marginTop: 2, zIndex: 2 }}>
                            {nodeStatusIcon(node.status)}
                          </div>

                          {/* Content */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 2 }}>
                              <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--on-surface)' }}>
                                {node.order + 1}. {node.name}
                              </span>
                              <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 7px', borderRadius: 8, background: `${statusColor}22`, color: statusColor, border: `1px solid ${statusColor}44` }}>
                                {node.status.toUpperCase()}
                              </span>
                              {node.retryCount !== undefined && node.retryCount > 0 && (
                                <span style={{ fontSize: '10px', background: '#fff1e5', color: '#e67e22', border: '1px solid #e67e22', borderRadius: 8, padding: '1px 7px', fontWeight: 700 }}>
                                  {node.retryCount} RETR{node.retryCount === 1 ? 'Y' : 'IES'}
                                </span>
                              )}
                              {node.qualityScore !== null && node.qualityScore !== undefined && (
                                <span style={{ fontSize: '10px', color: 'var(--on-surface-variant)' }}>
                                  Score: <strong>{(node.qualityScore * 100).toFixed(0)}%</strong>
                                </span>
                              )}
                              {node.attemptCount !== undefined && node.attemptCount > 1 && (
                                <span style={{ fontSize: '10px', color: 'var(--on-surface-variant)' }}>
                                  Attempt: <strong>{node.attemptCount}</strong>
                                </span>
                              )}
                            </div>
                            <span style={{ fontSize: '0.75rem', color: 'var(--on-surface-variant)' }}>
                              {node.subtitle}
                            </span>
                          </div>

                          {/* Chevron */}
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, marginTop: 4, transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }}>
                            <path d="M2 4 L6 8 L10 4" stroke="var(--on-surface-variant)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                          </svg>
                        </button>

                        {/* Expanded detail */}
                        {isExpanded && (
                          <div style={{ marginLeft: 42, marginTop: 2, marginBottom: 6, padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--outline-variant)', borderRadius: 6, fontSize: '0.82rem', color: 'var(--on-surface-variant)', lineHeight: 1.6 }}>
                            {node.detail || 'No additional detail available for this stage.'}
                          </div>
                        )}

                        {/* Connector dot between nodes */}
                        {idx < trace.pipelineNodes.length - 1 && (
                          <div style={{ height: 6, display: 'flex', alignItems: 'center', paddingLeft: 6 }}>
                            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--outline-variant)', marginLeft: 5 }} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* ── Build Spec ── */}
            {trace.task.build_spec && (
              <div>
                <h3 style={{ fontFamily: "'Noto Serif', serif", fontSize: '0.95rem', fontWeight: 700, color: 'var(--on-surface)', margin: '0 0 10px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <SvgFile /> Build Specification
                </h3>
                <details>
                  <summary style={{ cursor: 'pointer', userSelect: 'none', fontSize: '0.82rem', color: 'var(--primary)', fontWeight: 600, marginBottom: 8 }}>
                    View full build spec ({trace.task.build_spec.length.toLocaleString()} characters)
                  </summary>
                  <pre style={{ marginTop: 8, padding: '12px 16px', background: '#1e1e1e', color: '#d4d4d4', borderRadius: 8, fontSize: '0.75rem', lineHeight: 1.6, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 400, overflowY: 'auto', fontFamily: 'monospace' }}>
                    {trace.task.build_spec}
                  </pre>
                </details>
              </div>
            )}

            {/* ── Extracted Requirements ── */}
            {trace.task.extracted_requirements && Object.keys(trace.task.extracted_requirements).length > 0 && (
              <div>
                <h3 style={{ fontFamily: "'Noto Serif', serif", fontSize: '0.95rem', fontWeight: 700, color: 'var(--on-surface)', margin: '0 0 10px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <rect x="1" y="1" width="12" height="12" rx="2" stroke="var(--primary)" strokeWidth="1.3" fill="var(--surface-container)" />
                    <line x1="3.5" y1="5" x2="10.5" y2="5" stroke="var(--primary)" strokeWidth="1" />
                    <line x1="3.5" y1="7.5" x2="10.5" y2="7.5" stroke="var(--primary)" strokeWidth="1" />
                    <line x1="3.5" y1="10" x2="7" y2="10" stroke="var(--primary)" strokeWidth="1" />
                  </svg>
                  Extracted Requirements
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
                  {Object.entries(trace.task.extracted_requirements)
                    .filter(([k, v]) => v !== null && v !== undefined && v !== '' && k !== 'raw_text' && k !== 'raw_body' && k !== 'course_notes')
                    .map(([key, val]) => (
                      <div key={key} style={{ padding: '8px 12px', background: 'var(--surface-container)', border: '1px solid var(--outline-variant)', borderRadius: 6, fontSize: '0.8rem' }}>
                        <span style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--primary)', marginBottom: 2 }}>
                          {key.replace(/_/g, ' ')}
                        </span>
                        <span style={{ color: 'var(--on-surface)', fontWeight: 600 }}>
                          {Array.isArray(val) ? val.join(', ') : String(val)}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* ── Deliverables ── */}
            <div>
              <h3 style={{ fontFamily: "'Noto Serif', serif", fontSize: '0.95rem', fontWeight: 700, color: 'var(--on-surface)', margin: '0 0 10px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                <SvgDrive /> Deliverables
                <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--on-surface-variant)' }}>
                  ({trace.deliverables.length})
                </span>
              </h3>
              {trace.deliverables.length === 0 ? (
                <p style={{ fontSize: '0.82rem', color: 'var(--on-surface-variant)', fontStyle: 'italic' }}>
                  No deliverables yet. Files will appear here once the Deliverer node uploads them to Google Drive.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {trace.deliverables.map((d) => (
                    <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'var(--surface-container)', border: '1px solid var(--outline-variant)', borderRadius: 8 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 6, background: '#e8f4ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <SvgFile />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--on-surface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {d.file_name}
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 2 }}>
                          <span style={{ fontSize: '10px', fontWeight: 700, background: 'var(--primary)', color: '#fff', padding: '1px 6px', borderRadius: 4 }}>
                            {getFileTypeBadge(d.file_name)}
                          </span>
                          {d.delivered_via && (
                            <span style={{ fontSize: '0.72rem', color: 'var(--on-surface-variant)' }}>
                              via {d.delivered_via}
                            </span>
                          )}
                          <span style={{ fontSize: '0.72rem', color: 'var(--on-surface-variant)' }}>
                            {formatRelTime(d.delivered_at)}
                          </span>
                        </div>
                      </div>
                      {d.drive_link && (
                        <a
                          href={d.drive_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', background: 'var(--surface)', border: '1px solid var(--outline-variant)', borderRadius: 5, color: 'var(--primary)', fontSize: '0.8rem', fontWeight: 600, textDecoration: 'none', flexShrink: 0 }}
                        >
                          <SvgDrive /> Open in Drive <SvgExternal />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Questions & Answers ── */}
            {trace.questions.length > 0 && (
              <div>
                <h3 style={{ fontFamily: "'Noto Serif', serif", fontSize: '0.95rem', fontWeight: 700, color: 'var(--on-surface)', margin: '0 0 10px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <SvgQuestion /> Agent Clarification Q&amp;A
                  <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--on-surface-variant)' }}>
                    ({trace.questions.length})
                  </span>
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {trace.questions.map((q) => (
                    <div key={q.id} style={{ border: '1px solid var(--outline-variant)', borderRadius: 8, overflow: 'hidden' }}>
                      <div style={{ padding: '10px 14px', background: 'var(--surface-container)', borderBottom: q.answer_text ? '1px solid var(--outline-variant)' : 'none' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 7px', borderRadius: 8, background: q.status === 'answered' ? '#e2f0d9' : q.status === 'timed_out' ? '#fff1e5' : '#fdf5ea', color: q.status === 'answered' ? '#276a3c' : q.status === 'timed_out' ? '#e67e22' : '#705728' }}>
                            {q.status.toUpperCase().replace('_', ' ')}
                          </span>
                          <span style={{ fontSize: '0.72rem', color: 'var(--on-surface-variant)' }}>{formatRelTime(q.asked_at)}</span>
                        </div>
                        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--on-surface)', fontWeight: 600 }}>{q.question_text}</p>
                      </div>
                      {q.answer_text && (
                        <div style={{ padding: '10px 14px', background: 'var(--surface)', fontSize: '0.82rem', color: 'var(--on-surface-variant)' }}>
                          <strong style={{ color: 'var(--primary)', marginRight: 6 }}>Answer:</strong>
                          {q.answer_text}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── System Events Log ── */}
            {trace.systemEvents.length > 0 && (
              <div>
                <h3 style={{ fontFamily: "'Noto Serif', serif", fontSize: '0.95rem', fontWeight: 700, color: 'var(--on-surface)', margin: '0 0 10px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <rect x="1" y="4" width="12" height="9" rx="2" stroke="var(--primary)" strokeWidth="1.3" fill="var(--surface-container)" />
                    <line x1="4" y1="4" x2="4" y2="1" stroke="var(--primary)" strokeWidth="1.3" strokeLinecap="round" />
                    <line x1="10" y1="4" x2="10" y2="1" stroke="var(--primary)" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                  System Event Log
                  <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--on-surface-variant)' }}>
                    (last {trace.systemEvents.length})
                  </span>
                </h3>
                <div style={{ background: '#0d1117', borderRadius: 8, padding: '10px 14px', maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {trace.systemEvents.map((ev) => (
                    <div key={ev.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '0.76rem', lineHeight: 1.5 }}>
                      <SvgEvent level={ev.level} />
                      <span style={{ color: '#8b949e', flexShrink: 0, fontFamily: 'monospace' }}>
                        {new Date(ev.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                      <span style={{ color: '#58a6ff', flexShrink: 0, fontFamily: 'monospace', fontSize: '0.72rem' }}>
                        [{ev.component}]
                      </span>
                      <span style={{ color: ev.level === 'error' ? '#f85149' : ev.level === 'warning' ? '#d29922' : '#8b949e', flex: 1 }}>
                        {ev.message}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Raw JSON Inspector ── */}
            {showRawJson && (
              <div>
                <h3 style={{ fontFamily: "'Noto Serif', serif", fontSize: '0.95rem', fontWeight: 700, color: 'var(--on-surface)', margin: '0 0 10px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <SvgJson /> Raw Task Object (Debug)
                </h3>
                <pre style={{ background: '#1e1e1e', color: '#d4d4d4', borderRadius: 8, padding: '14px 16px', fontSize: '0.72rem', lineHeight: 1.6, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 500, overflowY: 'auto', fontFamily: 'monospace' }}>
                  {JSON.stringify(trace, null, 2)}
                </pre>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}
