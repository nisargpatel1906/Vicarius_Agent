'use client';

import React, { useEffect, useState } from 'react';
import { Task, Question, Deliverable, SystemEvent } from '@/lib/types';

interface HealthData {
  lastIngestion: string | null;
  lastWorkerCheckin: string | null;
  events: SystemEvent[];
  usage: {
    groq: { estimatedCalls: number; dailyLimit: number; usagePercent: number };
    gemini: { estimatedCalls: number; dailyLimit: number; usagePercent: number };
    openrouter: { status: string };
    antigravity: { totalRuns: number; status: string };
  };
}

export default function DashboardPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [showArchived, setShowArchived] = useState<boolean>(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [replyText, setReplyText] = useState<string>('');
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [ingesting, setIngesting] = useState<boolean>(false);

  // Fetch dashboard data
  const fetchData = async () => {
    try {
      setLoading(true);
      const [tasksRes, healthRes] = await Promise.all([
        fetch(`/api/tasks?archived=${showArchived}`),
        fetch(`/api/health`),
      ]);

      const tasksData = await tasksRes.json();
      const healthData = await healthRes.json();

      if (tasksData.success) {
        setTasks(tasksData.data || []);
      }
      if (healthData.success) {
        setHealth(healthData.data);
      }
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000); // Auto-refresh every 15s
    return () => clearInterval(interval);
  }, [showArchived]);

  // Trigger manual ingestion
  const handleTriggerIngest = async () => {
    try {
      setIngesting(true);
      const res = await fetch('/api/ingest', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        await fetchData();
      }
    } catch (err) {
      console.error('Failed to trigger ingestion:', err);
    } finally {
      setIngesting(false);
    }
  };

  // Requeue a flagged or failed task
  const handleRetryTask = async (taskId: string) => {
    try {
      setActionLoading(true);
      const res = await fetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: taskId, action: 'retry' }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchData();
        if (selectedTask?.id === taskId) {
          setSelectedTask(data.data);
        }
      }
    } catch (err) {
      console.error('Error retrying task:', err);
    } finally {
      setActionLoading(false);
    }
  };

  // Answer a pending question from the dashboard
  const handleAnswerQuestion = async (questionId: string) => {
    if (!replyText.trim()) return;
    try {
      setActionLoading(true);
      const res = await fetch('/api/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId, answer: replyText }),
      });
      const data = await res.json();
      if (data.success) {
        setReplyText('');
        await fetchData();
        // Refresh selected task
        if (selectedTask) {
          const updated = tasks.find((t) => t.id === selectedTask.id);
          if (updated) setSelectedTask(updated);
        }
      }
    } catch (err) {
      console.error('Error answering question:', err);
    } finally {
      setActionLoading(false);
    }
  };

  // Status badge styling helper
  const getStatusBadge = (status: string) => {
    const config: Record<string, { bg: string; color: string; border: string }> = {
      new: { bg: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', border: 'rgba(56, 189, 248, 0.4)' },
      extracting: { bg: 'rgba(168, 85, 247, 0.15)', color: '#c084fc', border: 'rgba(168, 85, 247, 0.4)' },
      queued: { bg: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', border: 'rgba(245, 158, 11, 0.4)' },
      claimed: { bg: 'rgba(99, 102, 241, 0.15)', color: '#818cf8', border: 'rgba(99, 102, 241, 0.4)' },
      building: { bg: 'rgba(56, 189, 248, 0.25)', color: '#38bdf8', border: '#38bdf8' },
      verifying: { bg: 'rgba(168, 85, 247, 0.25)', color: '#c084fc', border: '#c084fc' },
      flagged: { bg: 'rgba(244, 63, 94, 0.2)', color: '#fb7185', border: '#f43f5e' },
      done: { bg: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: 'rgba(16, 185, 129, 0.4)' },
      failed: { bg: 'rgba(239, 68, 68, 0.2)', color: '#f87171', border: '#ef4444' },
    };
    const c = config[status] || config.new;
    return (
      <span style={{
        backgroundColor: c.bg,
        color: c.color,
        border: `1px solid ${c.border}`,
        padding: '3px 10px',
        borderRadius: '12px',
        fontSize: '0.75rem',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        display: 'inline-block',
      }}>
        {status}
      </span>
    );
  };

  // Filter tasks
  const filteredTasks = tasks.filter((t) => {
    const matchesSearch =
      (t.title || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.course || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || t.status === statusFilter;
    const matchesType = typeFilter === 'all' || t.task_type === typeFilter;
    return matchesSearch && matchesStatus && matchesType;
  });

  const flaggedTasks = tasks.filter((t) => t.status === 'flagged');
  const queuedCount = tasks.filter((t) => t.status === 'queued').length;
  const buildingCount = tasks.filter((t) => ['claimed', 'building', 'verifying'].includes(t.status)).length;
  const doneCount = tasks.filter((t) => t.status === 'done').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Top Controls & Ingest Button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 800, letterSpacing: '-0.02em' }}>Academic Operations</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Autonomous assignment ingestion, Antigravity builds, and deadline tracking.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={handleTriggerIngest}
            disabled={ingesting}
            className="btn-primary"
            style={{ opacity: ingesting ? 0.7 : 1 }}
          >
            {ingesting ? 'Polling Sources...' : '⚡ Poll Gmail & Classroom'}
          </button>
        </div>
      </div>

      {/* Flagged Alert Banner (PRD Section 6.6) */}
      {flaggedTasks.length > 0 && (
        <div style={{
          background: 'rgba(244, 63, 94, 0.12)',
          border: '1px solid rgba(244, 63, 94, 0.4)',
          borderRadius: 16,
          padding: '16px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '1.25rem' }}>⚠️</span>
            <h3 style={{ color: '#fb7185', fontSize: '1rem', fontWeight: 700 }}>
              {flaggedTasks.length} Task(s) Require Your Attention
            </h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {flaggedTasks.map((t) => (
              <div
                key={t.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: 'rgba(15, 23, 42, 0.7)',
                  padding: '10px 16px',
                  borderRadius: 8,
                }}
              >
                <div>
                  <span style={{ fontWeight: 600, color: '#fff' }}>{t.title}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginLeft: 8 }}>({t.course || 'Unknown Course'})</span>
                  <div style={{ color: '#fb7185', fontSize: '0.8rem', marginTop: 2 }}>{t.result_summary || 'Flagged during extraction'}</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => setSelectedTask(t)}
                    className="btn-secondary"
                    style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                  >
                    View Details
                  </button>
                  <button
                    onClick={() => handleRetryTask(t.id)}
                    className="btn-primary"
                    style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                  >
                    🔄 Retry
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* KPI Overview Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        <div className="glass-panel" style={{ padding: 20 }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 500 }}>Queued for Build</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#fbbf24', marginTop: 4 }}>{queuedCount}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>Sorted by nearest deadline</div>
        </div>

        <div className="glass-panel" style={{ padding: 20 }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 500 }}>In Execution</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#38bdf8', marginTop: 4 }}>{buildingCount}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>Running on local PC</div>
        </div>

        <div className="glass-panel" style={{ padding: 20 }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 500 }}>Flagged Review</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#fb7185', marginTop: 4 }}>{flaggedTasks.length}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>Awaiting human input</div>
        </div>

        <div className="glass-panel" style={{ padding: 20 }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 500 }}>Completed Deliverables</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#34d399', marginTop: 4 }}>{doneCount}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>Verified & Delivered</div>
        </div>
      </div>

      {/* Main Content Layout: Tasks Table + Sidebar Panel */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24 }}>
        {/* Left Column: Tasks List */}
        <div className="glass-panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700 }}>Task Queue & History</h3>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              Show Archived (90d+)
            </label>
          </div>

          {/* Search and Filters */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Search tasks or courses..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                flex: 1,
                minWidth: 200,
                background: 'rgba(30, 41, 59, 0.6)',
                border: '1px solid var(--border-color)',
                borderRadius: 8,
                padding: '8px 12px',
                color: '#fff',
                fontSize: '0.85rem',
              }}
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{
                background: 'rgba(30, 41, 59, 0.6)',
                border: '1px solid var(--border-color)',
                borderRadius: 8,
                padding: '8px 12px',
                color: '#fff',
                fontSize: '0.85rem',
              }}
            >
              <option value="all">All Statuses</option>
              <option value="queued">Queued</option>
              <option value="building">Building</option>
              <option value="flagged">Flagged</option>
              <option value="done">Done</option>
            </select>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              style={{
                background: 'rgba(30, 41, 59, 0.6)',
                border: '1px solid var(--border-color)',
                borderRadius: 8,
                padding: '8px 12px',
                color: '#fff',
                fontSize: '0.85rem',
              }}
            >
              <option value="all">All Types</option>
              <option value="document">Document</option>
              <option value="presentation">Presentation</option>
              <option value="code_project">Code Project</option>
              <option value="ml_training">ML Training</option>
              <option value="research">Research</option>
              <option value="handwritten">Handwritten</option>
            </select>
          </div>

          {/* Tasks Table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '12px 8px' }}>Source</th>
                  <th style={{ padding: '12px 8px' }}>Task Title</th>
                  <th style={{ padding: '12px 8px' }}>Course</th>
                  <th style={{ padding: '12px 8px' }}>Type</th>
                  <th style={{ padding: '12px 8px' }}>Due Date</th>
                  <th style={{ padding: '12px 8px' }}>Status</th>
                  <th style={{ padding: '12px 8px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTasks.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: '32px 8px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      {loading ? 'Loading tasks...' : 'No tasks found matching current filters.'}
                    </td>
                  </tr>
                ) : (
                  filteredTasks.map((t) => {
                    const dueStr = t.due_date
                      ? new Date(t.due_date).toLocaleDateString('en-IN', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: 'Asia/Kolkata',
                        })
                      : 'No Deadline';

                    return (
                      <tr
                        key={t.id}
                        onClick={() => setSelectedTask(t)}
                        style={{
                          borderBottom: '1px solid rgba(51, 65, 85, 0.3)',
                          cursor: 'pointer',
                          transition: 'background 0.15s ease',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(30, 41, 59, 0.4)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        <td style={{ padding: '12px 8px' }}>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            {t.source === 'classroom' ? '🏫 Classroom' : '📧 Gmail'}
                          </span>
                        </td>
                        <td style={{ padding: '12px 8px', fontWeight: 600, color: '#fff' }}>
                          {t.title}
                        </td>
                        <td style={{ padding: '12px 8px', color: 'var(--text-secondary)' }}>
                          {t.course || 'General'}
                        </td>
                        <td style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>
                          {t.task_type}
                        </td>
                        <td style={{ padding: '12px 8px', color: 'var(--text-secondary)' }}>
                          {dueStr}
                        </td>
                        <td style={{ padding: '12px 8px' }}>
                          {getStatusBadge(t.status)}
                        </td>
                        <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedTask(t);
                            }}
                            className="btn-secondary"
                            style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                          >
                            Inspect
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Column: System Health & Quota Panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Health Overview */}
          <div className="glass-panel" style={{ padding: 20 }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 14 }}>System Health</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Last Ingestion:</span>
                <span style={{ fontWeight: 600, color: '#38bdf8' }}>
                  {health?.lastIngestion
                    ? new Date(health.lastIngestion).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })
                    : 'Awaiting Run'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Local Worker Check-in:</span>
                <span style={{ fontWeight: 600, color: '#10b981' }}>
                  {health?.lastWorkerCheckin
                    ? new Date(health.lastWorkerCheckin).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })
                    : 'Ready'}
                </span>
              </div>
            </div>
          </div>

          {/* Free-Tier Quota Tracker (PRD Section 6.6) */}
          <div className="glass-panel" style={{ padding: 20 }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 14 }}>Provider Quotas (Free Tier)</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: 4 }}>
                  <span>Groq (Classification)</span>
                  <span style={{ color: 'var(--text-muted)' }}>{health?.usage?.groq?.usagePercent || 0}% used</span>
                </div>
                <div style={{ background: 'rgba(51, 65, 85, 0.4)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                  <div style={{ background: '#38bdf8', height: '100%', width: `${health?.usage?.groq?.usagePercent || 5}%` }} />
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: 4 }}>
                  <span>Gemini Flash (Vision/PDF)</span>
                  <span style={{ color: 'var(--text-muted)' }}>{health?.usage?.gemini?.usagePercent || 0}% used</span>
                </div>
                <div style={{ background: 'rgba(51, 65, 85, 0.4)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                  <div style={{ background: '#818cf8', height: '100%', width: `${health?.usage?.gemini?.usagePercent || 5}%` }} />
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                  <span>OpenRouter Failover</span>
                  <span style={{ color: '#10b981' }}>Standby Ready</span>
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                  <span>Antigravity Engine</span>
                  <span style={{ color: '#38bdf8' }}>v1.1.12 Pinned</span>
                </div>
              </div>
            </div>
          </div>

          {/* Recent System Events */}
          <div className="glass-panel" style={{ padding: 20 }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 14 }}>Live System Events</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 250, overflowY: 'auto' }}>
              {(health?.events || []).length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>No system events recorded.</div>
              ) : (
                (health?.events || []).slice(0, 8).map((evt) => (
                  <div
                    key={evt.id}
                    style={{
                      fontSize: '0.75rem',
                      padding: '6px 10px',
                      borderRadius: 6,
                      background: 'rgba(30, 41, 59, 0.5)',
                      borderLeft: `3px solid ${
                        evt.level === 'error' ? '#ef4444' : evt.level === 'warning' ? '#f59e0b' : '#38bdf8'
                      }`,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
                      <span>[{evt.component}]</span>
                      <span>{new Date(evt.created_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}</span>
                    </div>
                    <div style={{ color: '#f1f5f9', marginTop: 2 }}>{evt.message}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Task Detail Modal (PRD Section 6.6) */}
      {selectedTask && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100,
          padding: 24,
        }}>
          <div className="glass-panel" style={{
            maxWidth: 800,
            width: '100%',
            maxHeight: '90vh',
            overflowY: 'auto',
            padding: 32,
            position: 'relative',
            background: 'var(--bg-secondary)',
          }}>
            <button
              onClick={() => setSelectedTask(null)}
              style={{
                position: 'absolute',
                top: 20,
                right: 20,
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: '1.5rem',
                cursor: 'pointer',
              }}
            >
              &times;
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              {getStatusBadge(selectedTask.status)}
              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{selectedTask.task_type}</span>
            </div>

            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: 4, color: '#fff' }}>
              {selectedTask.title}
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: 20 }}>
              Course: <strong style={{ color: '#fff' }}>{selectedTask.course || 'General'}</strong> • Due:{' '}
              {selectedTask.due_date
                ? new Date(selectedTask.due_date).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
                : 'No Deadline'}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Requirements & Criteria */}
              <div>
                <h4 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: 8, color: '#38bdf8' }}>
                  Extracted Requirements
                </h4>
                <div style={{ background: 'rgba(15, 23, 42, 0.8)', padding: 14, borderRadius: 8, fontSize: '0.85rem' }}>
                  {selectedTask.extracted_requirements?.items ? (
                    <ul style={{ paddingLeft: 20 }}>
                      {selectedTask.extracted_requirements.items.map((item: string, i: number) => (
                        <li key={i} style={{ marginBottom: 4 }}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>{selectedTask.extracted_requirements?.raw_body || 'No structured requirements extracted.'}</p>
                  )}
                </div>
              </div>

              {/* Success Criteria */}
              {selectedTask.success_criteria && (
                <div>
                  <h4 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: 8, color: '#10b981' }}>
                    Success Criteria
                  </h4>
                  <div style={{ background: 'rgba(15, 23, 42, 0.8)', padding: 14, borderRadius: 8, fontSize: '0.85rem' }}>
                    {selectedTask.success_criteria}
                  </div>
                </div>
              )}

              {/* Build Spec Prompt */}
              {selectedTask.build_spec && (
                <div>
                  <h4 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: 8, color: '#818cf8' }}>
                    Antigravity Build Spec
                  </h4>
                  <pre style={{
                    background: 'rgba(10, 15, 29, 0.95)',
                    padding: 14,
                    borderRadius: 8,
                    fontSize: '0.75rem',
                    whiteSpace: 'pre-wrap',
                    maxHeight: 180,
                    overflowY: 'auto',
                    border: '1px solid var(--border-color)',
                  }}>
                    {selectedTask.build_spec}
                  </pre>
                </div>
              )}

              {/* Result Summary & Assumptions */}
              {selectedTask.result_summary && (
                <div>
                  <h4 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: 8, color: '#fbbf24' }}>
                    Result Summary & Assumptions
                  </h4>
                  <div style={{ background: 'rgba(15, 23, 42, 0.8)', padding: 14, borderRadius: 8, fontSize: '0.85rem' }}>
                    {selectedTask.result_summary}
                  </div>
                </div>
              )}

              {/* Pending Questions Answering Area (PRD Section 6.6) */}
              {(selectedTask as any).questions && (selectedTask as any).questions.length > 0 && (
                <div>
                  <h4 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: 8, color: '#f43f5e' }}>
                    Agent Clarification Questions
                  </h4>
                  {(selectedTask as any).questions.map((q: Question) => (
                    <div key={q.id} style={{ background: 'rgba(30, 41, 59, 0.7)', padding: 14, borderRadius: 8, marginBottom: 8 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#fff' }}>{q.question_text}</div>
                      {q.status === 'answered' ? (
                        <div style={{ color: '#10b981', fontSize: '0.8rem', marginTop: 4 }}>
                          Answered: {q.answer_text}
                        </div>
                      ) : (
                        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                          <input
                            type="text"
                            placeholder="Type your clarification answer..."
                            value={replyText}
                            onChange={(e) => setReplyText(e.target.value)}
                            style={{
                              flex: 1,
                              background: 'rgba(15, 23, 42, 0.9)',
                              border: '1px solid var(--border-color)',
                              borderRadius: 6,
                              padding: '6px 10px',
                              color: '#fff',
                              fontSize: '0.85rem',
                            }}
                          />
                          <button
                            onClick={() => handleAnswerQuestion(q.id)}
                            disabled={actionLoading}
                            className="btn-primary"
                            style={{ padding: '6px 14px', fontSize: '0.8rem' }}
                          >
                            Submit Answer
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 12 }}>
                {['flagged', 'failed'].includes(selectedTask.status) && (
                  <button
                    onClick={() => handleRetryTask(selectedTask.id)}
                    disabled={actionLoading}
                    className="btn-primary"
                  >
                    🔄 Retry Task
                  </button>
                )}
                <button onClick={() => setSelectedTask(null)} className="btn-secondary">
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
