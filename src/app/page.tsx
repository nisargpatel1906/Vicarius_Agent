'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { Task, Question, Deliverable, SystemEvent, UserProfile } from '@/lib/types';
import { VicariusLogo } from '@/components/VicariusLogo';
import {
  ClockIcon,
  RefreshIcon,
  ZapIcon,
  AlertIcon,
  ClassroomIcon,
  MailIcon,
  HelpIcon,
  FileIcon,
  ExternalLinkIcon,
  CopyIcon,
  CheckIcon,
  SearchIcon,
  CloseIcon,
  SparklesIcon,
} from '@/components/Icons';

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
  stats?: {
    totalTasks: number;
    completedTasks: number;
  };
}

export default function DashboardPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [showProfileModal, setShowProfileModal] = useState<boolean>(false);
  const [profileSaving, setProfileSaving] = useState<boolean>(false);
  const [profileSavedMsg, setProfileSavedMsg] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [courseFilter, setCourseFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [showArchived, setShowArchived] = useState<boolean>(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [replyText, setReplyText] = useState<string>('');
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [ingesting, setIngesting] = useState<boolean>(false);
  const [copiedSpec, setCopiedSpec] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<string>('');

  // Live IST Clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString('en-IN', {
          timeZone: 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        }) + ' IST'
      );
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch dashboard data
  const fetchData = async () => {
    try {
      setLoading(true);
      const [tasksRes, healthRes, profileRes] = await Promise.all([
        fetch(`/api/tasks?archived=${showArchived}`),
        fetch(`/api/health`),
        fetch(`/api/profile`),
      ]);

      const tasksData = await tasksRes.json();
      const healthData = await healthRes.json();
      const profileData = await profileRes.json();

      if (tasksData.success) {
        setTasks(tasksData.data || []);
      }
      if (healthData.success) {
        setHealth(healthData.data);
      }
      if (profileData.success && profileData.data) {
        setProfile(profileData.data);
      }
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    try {
      setProfileSaving(true);
      setProfileSavedMsg('');
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      const data = await res.json();
      if (data.success) {
        setProfile(data.data);
        setProfileSavedMsg('Profile successfully saved live to Supabase! All future tasks read this immediately.');
        setTimeout(() => setProfileSavedMsg(''), 5000);
      } else {
        alert(data.error?.message || 'Failed to update profile');
      }
    } catch (err: any) {
      alert('Error updating profile: ' + (err?.message || err));
    } finally {
      setProfileSaving(false);
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

  // Requeue a flagged or failed task (PRD Section 6.6)
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

  // Answer a pending question from the dashboard (PRD Section 6.6)
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
          const updatedRes = await fetch(`/api/tasks?archived=true`);
          const updatedData = await updatedRes.json();
          if (updatedData.success && updatedData.data) {
            const found = updatedData.data.find((t: Task) => t.id === selectedTask.id);
            if (found) setSelectedTask(found);
          }
        }
      }
    } catch (err) {
      console.error('Error answering question:', err);
    } finally {
      setActionLoading(false);
    }
  };

  // Distinct courses for filter dropdown
  const uniqueCourses = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach((t) => {
      if (t.course) set.add(t.course);
    });
    return Array.from(set).sort();
  }, [tasks]);

  // Status badge styling adhering strictly to Cognitive Heritage Palette (DESIGN.md)
  const renderStatusBadge = (status: string) => {
    const config: Record<
      string,
      { bg: string; color: string; border: string; label: string }
    > = {
      new: {
        bg: '#fff1e5',
        color: '#705728',
        border: '#d1c5b6',
        label: 'New Intake',
      },
      extracting: {
        bg: '#ede1c8',
        color: '#4d4633',
        border: '#cec6b3',
        label: 'Extracting',
      },
      queued: {
        bg: '#fdebd9',
        color: '#8b6f3e',
        border: '#e4c289',
        label: 'Queued for Build',
      },
      claimed: {
        bg: '#f1e0ce',
        color: '#5a4316',
        border: '#d1c5b6',
        label: 'Worker Claimed',
      },
      building: {
        bg: '#ffdea9',
        color: '#271900',
        border: '#e4c289',
        label: 'In Execution',
      },
      verifying: {
        bg: '#ede1c8',
        color: '#201b0b',
        border: '#8b6f3e',
        label: 'Verifying',
      },
      flagged: {
        bg: '#ffdad6',
        color: '#93000a',
        border: '#ba1a1a',
        label: 'Flagged Review',
      },
      done: {
        bg: '#e2f0d9',
        color: '#276a3c',
        border: '#b3d8a5',
        label: 'Delivered',
      },
      failed: {
        bg: '#ffebee',
        color: '#b71c1c',
        border: '#ef9a9a',
        label: 'Failed',
      },
    };

    const c = config[status] || config.new;
    return (
      <span
        style={{
          backgroundColor: c.bg,
          color: c.color,
          border: `1px solid ${c.border}`,
          padding: '3px 9px',
          borderRadius: 4,
          fontSize: '11px',
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
        }}
      >
        {['building', 'verifying'].includes(status) && (
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              backgroundColor: c.color,
              display: 'inline-block',
            }}
            className="badge-pulse"
          />
        )}
        {c.label}
      </span>
    );
  };

  // Helper for deadline urgency countdown
  const getDeadlineInfo = (dueDateStr: string | null) => {
    if (!dueDateStr) {
      return {
        formatted: 'No Deadline Specified',
        relative: 'Untimed',
        isUrgent: false,
        isPast: false,
      };
    }

    const due = new Date(dueDateStr);
    const now = new Date();
    const diffHours = (due.getTime() - now.getTime()) / (1000 * 60 * 60);

    const formatted = due.toLocaleDateString('en-IN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata',
    });

    if (diffHours < 0) {
      return { formatted, relative: 'Past Due', isUrgent: true, isPast: true };
    }
    if (diffHours <= 12) {
      return {
        formatted,
        relative: `Urgent (${Math.round(diffHours)}h left)`,
        isUrgent: true,
        isPast: false,
      };
    }
    if (diffHours <= 48) {
      return {
        formatted,
        relative: `Due in ${Math.round(diffHours)}h`,
        isUrgent: false,
        isPast: false,
      };
    }
    const diffDays = Math.round(diffHours / 24);
    return {
      formatted,
      relative: `Due in ${diffDays}d`,
      isUrgent: false,
      isPast: false,
    };
  };

  // Filter tasks
  const filteredTasks = tasks.filter((t) => {
    const matchesSearch =
      (t.title || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.course || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.task_type || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || t.status === statusFilter;
    const matchesCourse = courseFilter === 'all' || t.course === courseFilter;
    const matchesType = typeFilter === 'all' || t.task_type === typeFilter;
    return matchesSearch && matchesStatus && matchesCourse && matchesType;
  });

  const flaggedTasks = tasks.filter((t) => t.status === 'flagged');
  const queuedTasks = tasks.filter((t) => t.status === 'queued');
  const buildingTasks = tasks.filter((t) =>
    ['claimed', 'building', 'verifying'].includes(t.status)
  );
  const doneTasks = tasks.filter((t) => t.status === 'done');

  // Find nearest upcoming deadline
  const nearestTask = [...tasks]
    .filter((t) => t.due_date && t.status !== 'done' && !t.archived)
    .sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime())[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* Executive Header & Action Strip */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <VicariusLogo size={24} variant="badge" fill="var(--primary)" />
            <h2 className="heading-h1" style={{ color: 'var(--on-surface)' }}>
              Academic Operations Command
            </h2>
          </div>
          <p style={{ color: 'var(--on-surface-variant)', fontSize: '0.92rem' }}>
            Autonomous multi-course ingestion, Antigravity CLI code generation, and quiet luxury execution tracking.
          </p>
        </div>

        {/* Global Action Buttons */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div
            style={{
              fontSize: '0.82rem',
              color: 'var(--on-surface-variant)',
              background: 'var(--surface-container-low)',
              padding: '8px 14px',
              borderRadius: 4,
              border: '1px solid var(--outline-variant)',
              fontFamily: 'monospace',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <ClockIcon size={14} color="var(--primary)" />
            <span>{currentTime || 'Loading IST...'}</span>
          </div>

          <button
            onClick={fetchData}
            disabled={loading}
            className="btn-heritage-secondary"
            title="Refresh pipeline stream"
          >
            <RefreshIcon size={14} />
            <span>Refresh Stream</span>
          </button>

          <button
            onClick={() => setShowProfileModal(true)}
            className="btn-heritage-secondary"
            title="View and edit student profile (PRD Section 5 & 6.6)"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <VicariusLogo size={14} variant="mark" fill="var(--primary)" />
            <span>Student Profile</span>
          </button>

          <button
            onClick={handleTriggerIngest}
            disabled={ingesting}
            className="btn-heritage-primary"
            style={{ opacity: ingesting ? 0.75 : 1 }}
          >
            <ZapIcon size={14} color="#FFF9F6" />
            <span>{ingesting ? 'Polling Classroom & Gmail...' : 'Poll Sources Now'}</span>
          </button>
        </div>
      </div>

      {/* AI Executive Intelligence Briefing Strip (DESIGN.md Insight Highlight) */}
      <div className="insight-highlight" style={{ position: 'relative', overflow: 'hidden' }}>
        <VicariusLogo size={140} variant="watermark" fill="#8B6F3E" style={{ right: '-15px', bottom: '-25px' }} />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <SparklesIcon size={15} color="var(--primary)" />
            <strong className="font-serif" style={{ color: 'var(--primary)', fontSize: '0.95rem' }}>
              Autonomous Pipeline Briefing:
            </strong>
            <span
              className="label-caps"
              style={{
                background: 'var(--primary-container)',
                color: '#fff9f6',
                padding: '1px 6px',
                borderRadius: 3,
                fontSize: '9px',
              }}
            >
              AI Live Synthesis
            </span>
          </div>
          <p style={{ fontSize: '0.88rem', color: 'var(--on-surface)', lineHeight: 1.55 }}>
            {tasks.length === 0
              ? 'The system is idle. Trigger a poll or wait for the scheduled background ingestion to discover academic coursework.'
              : `Tracking ${tasks.length} total assignment(s) across ${uniqueCourses.length || 1} course(s). ${
                  flaggedTasks.length > 0
                    ? `${flaggedTasks.length} task(s) require human review or clarification.`
                    : 'All tasks are operating within normal autonomous confidence thresholds.'
                } ${
                  nearestTask
                    ? `Nearest deadline is "${nearestTask.title}" (${nearestTask.course || 'General'}), due ${new Date(
                        nearestTask.due_date!
                      ).toLocaleDateString('en-IN', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'Asia/Kolkata',
                      })}.`
                    : 'No pending hard deadlines.'
                }`}
          </p>
        </div>
      </div>

      {/* Flagged Attention Banner (PRD Section 6.6) */}
      {flaggedTasks.length > 0 && (
        <div
          style={{
            background: 'var(--error-container)',
            border: '1px solid rgba(186, 26, 26, 0.4)',
            borderRadius: 8,
            padding: '18px 22px',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            boxShadow: 'var(--shadow-diffused)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <AlertIcon size={20} color="var(--on-error-container)" />
              <h3 className="font-serif" style={{ color: 'var(--on-error-container)', fontSize: '1.05rem', fontWeight: 700 }}>
                {flaggedTasks.length} Task(s) Require Human Attention & Clarification
              </h3>
            </div>
            <span
              className="label-caps"
              style={{
                background: 'var(--error)',
                color: '#fff',
                padding: '3px 8px',
                borderRadius: 4,
                fontSize: '10px',
              }}
            >
              Action Required
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {flaggedTasks.map((t) => (
              <div
                key={t.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: '#ffffff',
                  padding: '12px 18px',
                  borderRadius: 6,
                  border: '1px solid rgba(186, 26, 26, 0.25)',
                  flexWrap: 'wrap',
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 700, color: 'var(--on-surface)', fontSize: '0.92rem' }}>
                      {t.title}
                    </span>
                    <span
                      style={{
                        fontSize: '0.78rem',
                        color: 'var(--on-surface-variant)',
                        background: 'var(--surface-container-high)',
                        padding: '2px 8px',
                        borderRadius: 4,
                      }}
                    >
                      {t.course || 'General'}
                    </span>
                  </div>
                  <div style={{ color: 'var(--error)', fontSize: '0.82rem', marginTop: 4 }}>
                    {t.result_summary || 'Task flagged due to low extraction confidence or missing requirements.'}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => setSelectedTask(t)}
                    className="btn-heritage-secondary"
                    style={{ fontSize: '0.8rem', padding: '6px 14px' }}
                  >
                    Inspect & Clarify
                  </button>
                  <button
                    onClick={() => handleRetryTask(t.id)}
                    disabled={actionLoading}
                    className="btn-heritage-primary"
                    style={{ fontSize: '0.8rem', padding: '6px 14px' }}
                  >
                    <RefreshIcon size={13} color="#FFF9F6" />
                    <span>Retry Build</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* KPI Metric Overview Cards (DESIGN.md Tonal Layering + Logo Watermark) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 18,
        }}
      >
        {/* Queued Card */}
        <div className="heritage-card" style={{ padding: '22px 24px' }}>
          <VicariusLogo size={90} variant="watermark" fill="#705728" />
          <div className="label-caps" style={{ color: 'var(--primary-container)' }}>
            Queued For Build
          </div>
          <div
            className="font-serif"
            style={{
              fontSize: '2.4rem',
              fontWeight: 700,
              color: 'var(--primary)',
              marginTop: 6,
              lineHeight: 1,
            }}
          >
            {queuedTasks.length}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--on-surface-variant)', marginTop: 8 }}>
            Prioritized by nearest due date
          </div>
        </div>

        {/* In Execution Card */}
        <div className="heritage-card" style={{ padding: '22px 24px' }}>
          <VicariusLogo size={90} variant="watermark" fill="#8B6F3E" />
          <div className="label-caps" style={{ color: 'var(--primary)' }}>
            Active Execution
          </div>
          <div
            className="font-serif"
            style={{
              fontSize: '2.4rem',
              fontWeight: 700,
              color: 'var(--primary-container)',
              marginTop: 6,
              lineHeight: 1,
            }}
          >
            {buildingTasks.length}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--on-surface-variant)', marginTop: 8 }}>
            Running in local worker sandbox
          </div>
        </div>

        {/* Flagged Review Card */}
        <div className="heritage-card" style={{ padding: '22px 24px' }}>
          <VicariusLogo size={90} variant="watermark" fill="#BA1A1A" />
          <div className="label-caps" style={{ color: 'var(--error)' }}>
            Flagged For Review
          </div>
          <div
            className="font-serif"
            style={{
              fontSize: '2.4rem',
              fontWeight: 700,
              color: 'var(--error)',
              marginTop: 6,
              lineHeight: 1,
            }}
          >
            {flaggedTasks.length}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--on-surface-variant)', marginTop: 8 }}>
            Awaiting human decision or answer
          </div>
        </div>

        {/* Completed Deliverables Card */}
        <div className="heritage-card" style={{ padding: '22px 24px' }}>
          <VicariusLogo size={90} variant="watermark" fill="#2E7D32" />
          <div className="label-caps" style={{ color: '#276a3c' }}>
            Verified Deliverables
          </div>
          <div
            className="font-serif"
            style={{
              fontSize: '2.4rem',
              fontWeight: 700,
              color: '#276a3c',
              marginTop: 6,
              lineHeight: 1,
            }}
          >
            {doneTasks.length}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--on-surface-variant)', marginTop: 8 }}>
            Passed verification & archived
          </div>
        </div>
      </div>

      {/* Main Content Split: Tasks Ledger (2fr) + Telemetry / Quotas (1fr) */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24, alignItems: 'start' }}>
        {/* Left Column: Academic Task Ledger */}
        <div className="heritage-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Header & Filter Toolbar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <VicariusLogo size={20} variant="mark" fill="var(--primary)" />
              <h3 className="font-serif" style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--on-surface)' }}>
                Academic Task Ledger
              </h3>
              <span
                style={{
                  fontSize: '0.8rem',
                  color: 'var(--on-surface-variant)',
                  background: 'var(--surface-container-high)',
                  padding: '2px 8px',
                  borderRadius: 12,
                }}
              >
                {filteredTasks.length} tasks
              </span>
            </div>

            {/* Archive Switch (DESIGN.md Analysis Toggle) */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: '0.84rem' }}>
              <span style={{ color: 'var(--on-surface-variant)', fontWeight: 500 }}>Include Archived (90d+)</span>
              <div className="analysis-toggle-switch">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(e) => setShowArchived(e.target.checked)}
                />
                <span className="analysis-toggle-slider" />
              </div>
            </label>
          </div>

          {/* Search and Filters Strip (Stationery Inputs) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <SearchIcon
                size={15}
                color="var(--outline)"
                style={{ position: 'absolute', left: 12, pointerEvents: 'none' }}
              />
              <input
                type="text"
                placeholder="Search title, course, or prompt..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="stationery-input"
                style={{ width: '100%', paddingLeft: 34 }}
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="stationery-select"
            >
              <option value="all">All Statuses</option>
              <option value="queued">Queued for Build</option>
              <option value="building">In Execution</option>
              <option value="flagged">Flagged Review</option>
              <option value="done">Delivered</option>
              <option value="failed">Failed</option>
            </select>

            <select
              value={courseFilter}
              onChange={(e) => setCourseFilter(e.target.value)}
              className="stationery-select"
            >
              <option value="all">All Courses</option>
              {uniqueCourses.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="stationery-select"
            >
              <option value="all">All Types</option>
              <option value="document">Document (Report/Essay)</option>
              <option value="presentation">Presentation (Slides)</option>
              <option value="code_project">Code Project</option>
              <option value="ml_training">ML Training</option>
              <option value="research">Research Summary</option>
              <option value="handwritten">Handwritten Style</option>
            </select>
          </div>

          {/* Academic Table View */}
          <div style={{ overflowX: 'auto' }}>
            <table className="academic-table">
              <thead>
                <tr>
                  <th style={{ width: '110px' }}>Source</th>
                  <th>Assignment / Deliverable</th>
                  <th>Course</th>
                  <th>Type</th>
                  <th>Deadline (IST)</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTasks.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: '48px 16px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                        <VicariusLogo size={48} variant="mark" fill="var(--outline-variant)" />
                        <div className="font-serif" style={{ fontSize: '1.1rem', color: 'var(--on-surface-variant)' }}>
                          {loading ? 'Consulting database ledger...' : 'No academic tasks found matching current filters.'}
                        </div>
                        <p style={{ fontSize: '0.82rem', color: 'var(--outline)' }}>
                          {searchQuery || statusFilter !== 'all' || courseFilter !== 'all' || typeFilter !== 'all'
                            ? 'Try resetting the search or filter dropdowns above.'
                            : 'Trigger a poll using the action button to ingest recent assignments.'}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredTasks.map((t) => {
                    const deadline = getDeadlineInfo(t.due_date);
                    return (
                      <tr
                        key={t.id}
                        onClick={() => setSelectedTask(t)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td>
                          <span
                            style={{
                              fontSize: '0.78rem',
                              color: 'var(--on-surface-variant)',
                              background: 'var(--surface-container-high)',
                              padding: '3px 8px',
                              borderRadius: 4,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                              fontWeight: 600,
                            }}
                          >
                            {t.source === 'classroom' ? (
                              <>
                                <ClassroomIcon size={13} color="var(--primary)" />
                                <span>Classroom</span>
                              </>
                            ) : (
                              <>
                                <MailIcon size={13} color="var(--primary-container)" />
                                <span>Gmail</span>
                              </>
                            )}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600, color: 'var(--on-surface)', fontSize: '0.9rem' }}>
                            {t.title}
                          </div>
                          {t.result_summary && (
                            <div
                              style={{
                                fontSize: '0.75rem',
                                color: 'var(--on-surface-variant)',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                maxWidth: '280px',
                                marginTop: 2,
                              }}
                            >
                              {t.result_summary}
                            </div>
                          )}
                        </td>
                        <td>
                          <span style={{ color: 'var(--on-surface-variant)', fontWeight: 500 }}>
                            {t.course || 'General Academic'}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <span
                              style={{
                                fontSize: '0.78rem',
                                color: 'var(--secondary)',
                                textTransform: 'capitalize',
                                fontWeight: 600,
                              }}
                            >
                              {t.task_type?.replace('_', ' ')}
                            </span>
                            {t.weight && (
                              <span
                                style={{
                                  fontSize: '0.65rem',
                                  fontWeight: 700,
                                  letterSpacing: '0.04em',
                                  textTransform: 'uppercase',
                                  padding: '1px 6px',
                                  borderRadius: 4,
                                  width: 'fit-content',
                                  background:
                                    t.weight === 'heavy'
                                      ? 'rgba(186, 26, 26, 0.12)'
                                      : t.weight === 'medium'
                                      ? 'rgba(139, 111, 62, 0.15)'
                                      : 'rgba(112, 87, 40, 0.08)',
                                  color:
                                    t.weight === 'heavy'
                                      ? 'var(--error)'
                                      : t.weight === 'medium'
                                      ? 'var(--primary-container)'
                                      : 'var(--primary)',
                                  border:
                                    t.weight === 'heavy'
                                      ? '1px solid rgba(186, 26, 26, 0.3)'
                                      : '1px solid var(--outline-variant)',
                                }}
                              >
                                {t.weight}
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <div>
                            <div style={{ fontSize: '0.84rem', color: 'var(--on-surface)', fontWeight: 500 }}>
                              {deadline.formatted}
                            </div>
                            <div
                              style={{
                                fontSize: '0.72rem',
                                color: deadline.isUrgent ? 'var(--error)' : 'var(--outline)',
                                fontWeight: deadline.isUrgent ? 700 : 400,
                              }}
                            >
                              {deadline.relative}
                            </div>
                          </div>
                        </td>
                        <td>{renderStatusBadge(t.status)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedTask(t);
                            }}
                            className="btn-heritage-secondary"
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

        {/* Right Column: System Telemetry & Provider Quotas */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Health & Infrastructure Panel */}
          <div className="heritage-card" style={{ padding: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <VicariusLogo size={18} variant="mark" fill="var(--primary)" />
              <h3 className="font-serif" style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--on-surface)' }}>
                System Telemetry
              </h3>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--on-surface-variant)' }}>Last Ingestion Run:</span>
                <span style={{ fontWeight: 600, color: 'var(--primary)' }}>
                  {health?.lastIngestion
                    ? new Date(health.lastIngestion).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })
                    : 'Scheduled'}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--on-surface-variant)' }}>Local Worker Status:</span>
                <span
                  style={{
                    fontWeight: 600,
                    color: '#2e7d32',
                    background: '#e2f0d9',
                    padding: '2px 8px',
                    borderRadius: 4,
                    fontSize: '0.78rem',
                  }}
                >
                  {health?.lastWorkerCheckin ? 'Ready & Polling' : 'Active Standby'}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--on-surface-variant)' }}>Timezone Standard:</span>
                <span style={{ fontWeight: 600, color: 'var(--on-surface)' }}>Asia/Kolkata (IST)</span>
              </div>
            </div>
          </div>

          {/* Provider Quotas (Free Tier Gauges from PRD Section 6.6 & DESIGN.md Confidence Meters) */}
          <div className="heritage-card" style={{ padding: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <VicariusLogo size={18} variant="mark" fill="var(--primary-container)" />
                <h3 className="font-serif" style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--on-surface)' }}>
                  Provider Quotas
                </h3>
              </div>
              <span
                className="label-caps"
                style={{
                  background: 'var(--surface-container-high)',
                  color: 'var(--on-surface-variant)',
                  padding: '2px 6px',
                  borderRadius: 3,
                  fontSize: '9px',
                }}
              >
                Free Tier
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Groq Classification Meter */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, color: 'var(--on-surface)' }}>Groq Llama-3.3 (Classification)</span>
                  <span style={{ color: 'var(--on-surface-variant)' }}>
                    {health?.usage?.groq?.usagePercent || 0}% of 14.4k RPD
                  </span>
                </div>
                <div className="confidence-meter-track">
                  <div
                    className="confidence-meter-fill"
                    style={{ width: `${Math.max(4, health?.usage?.groq?.usagePercent || 2)}%` }}
                  />
                </div>
              </div>

              {/* Gemini Flash Vision/PDF OCR Meter */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, color: 'var(--on-surface)' }}>Gemini Flash (OCR / Vision)</span>
                  <span style={{ color: 'var(--on-surface-variant)' }}>
                    {health?.usage?.gemini?.usagePercent || 0}% of 1.5k RPD
                  </span>
                </div>
                <div className="confidence-meter-track">
                  <div
                    className="confidence-meter-fill"
                    style={{ width: `${Math.max(4, health?.usage?.gemini?.usagePercent || 3)}%` }}
                  />
                </div>
              </div>

              {/* OpenRouter Failover */}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', paddingTop: 4 }}>
                <span style={{ color: 'var(--on-surface)' }}>OpenRouter Failover Chain:</span>
                <span style={{ color: '#2e7d32', fontWeight: 600 }}>Active Standby</span>
              </div>

              {/* Antigravity CLI */}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                <span style={{ color: 'var(--on-surface)' }}>Antigravity Engine:</span>
                <span style={{ color: 'var(--primary)', fontWeight: 600 }}>v1.1.12 Pinned</span>
              </div>
            </div>
          </div>

          {/* Live System Events Log */}
          <div className="heritage-card" style={{ padding: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <VicariusLogo size={18} variant="mark" fill="var(--outline)" />
                <h3 className="font-serif" style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--on-surface)' }}>
                  Live System Events
                </h3>
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--outline)' }}>Real-time</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 260, overflowY: 'auto' }}>
              {(health?.events || []).length === 0 ? (
                <div style={{ color: 'var(--on-surface-variant)', fontSize: '0.8rem', padding: '12px 0', textAlign: 'center' }}>
                  No system events recorded.
                </div>
              ) : (
                (health?.events || []).slice(0, 10).map((evt) => (
                  <div
                    key={evt.id}
                    style={{
                      fontSize: '0.78rem',
                      padding: '8px 12px',
                      borderRadius: 4,
                      background: 'var(--surface-container-low)',
                      borderLeft: `3px solid ${
                        evt.level === 'error'
                          ? 'var(--error)'
                          : evt.level === 'warning'
                          ? '#d97706'
                          : 'var(--primary)'
                      }`,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--outline)', fontSize: '0.72rem' }}>
                      <span style={{ fontWeight: 600 }}>[{evt.component.toUpperCase()}]</span>
                      <span>{new Date(evt.created_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}</span>
                    </div>
                    <div style={{ color: 'var(--on-surface)', marginTop: 3 }}>{evt.message}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Task Inspection & Clarification Modal (PRD Section 6.6 & DESIGN.md Stationary Modal) */}
      {selectedTask && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(35, 26, 15, 0.65)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: 24,
          }}
          onClick={() => setSelectedTask(null)}
        >
          <div
            className="heritage-card"
            style={{
              maxWidth: 840,
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: 36,
              position: 'relative',
              background: '#ffffff',
              boxShadow: 'var(--shadow-modal)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Watermark Background */}
            <VicariusLogo size={240} variant="watermark" fill="#8B6F3E" style={{ right: '-30px', bottom: '-30px' }} />

            {/* Close Button */}
            <button
              onClick={() => setSelectedTask(null)}
              style={{
                position: 'absolute',
                top: 24,
                right: 24,
                background: 'transparent',
                border: 'none',
                color: 'var(--outline)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 4,
              }}
              aria-label="Close modal"
            >
              <CloseIcon size={20} />
            </button>

            {/* Modal Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
              <VicariusLogo size={36} variant="crest" />
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {renderStatusBadge(selectedTask.status)}
                  {selectedTask.weight && (
                    <span
                      style={{
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        padding: '2px 8px',
                        borderRadius: 4,
                        background:
                          selectedTask.weight === 'heavy'
                            ? 'rgba(186, 26, 26, 0.12)'
                            : selectedTask.weight === 'medium'
                            ? 'rgba(139, 111, 62, 0.15)'
                            : 'rgba(112, 87, 40, 0.08)',
                        color:
                          selectedTask.weight === 'heavy'
                            ? 'var(--error)'
                            : selectedTask.weight === 'medium'
                            ? 'var(--primary-container)'
                            : 'var(--primary)',
                        border: '1px solid var(--outline-variant)',
                      }}
                    >
                      {selectedTask.weight} lift
                    </span>
                  )}
                  <span
                    style={{
                      fontSize: '0.78rem',
                      background: 'var(--surface-container-high)',
                      padding: '2px 8px',
                      borderRadius: 4,
                      color: 'var(--on-surface-variant)',
                      fontWeight: 600,
                    }}
                  >
                    {selectedTask.course || 'General'}
                  </span>
                  <span
                    style={{
                      fontSize: '0.78rem',
                      color: 'var(--outline)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    Source: {selectedTask.source === 'classroom' ? 'Google Classroom' : 'Gmail'}
                  </span>
                </div>
              </div>
            </div>

            <h2
              className="heading-h2"
              style={{
                fontSize: '1.65rem',
                color: 'var(--on-surface)',
                marginTop: 8,
                marginBottom: 6,
              }}
            >
              {selectedTask.title}
            </h2>

            <p style={{ color: 'var(--on-surface-variant)', fontSize: '0.88rem', marginBottom: selectedTask.progress_note ? 14 : 24 }}>
              <strong>Due Date:</strong>{' '}
              {selectedTask.due_date
                ? new Date(selectedTask.due_date).toLocaleString('en-IN', {
                    timeZone: 'Asia/Kolkata',
                    dateStyle: 'full',
                    timeStyle: 'short',
                  })
                : 'No explicit deadline specified'}
            </p>

            {selectedTask.progress_note && (
              <div
                style={{
                  background: 'rgba(139, 111, 62, 0.08)',
                  border: '1px solid var(--outline-variant)',
                  borderRadius: 6,
                  padding: '10px 14px',
                  marginBottom: 18,
                  fontSize: '0.85rem',
                  color: 'var(--on-surface)',
                }}
              >
                <div style={{ fontWeight: 600, color: 'var(--primary)', marginBottom: 2 }}>
                  ⚡ Heavy Lift Progress Update:
                </div>
                <div>{selectedTask.progress_note}</div>
                {selectedTask.last_progress_at && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--outline)', marginTop: 4 }}>
                    Reported at: {new Date(selectedTask.last_progress_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} IST
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 22, position: 'relative', zIndex: 1 }}>
              {/* Extracted Requirements Checklist */}
              <div>
                <h4
                  className="font-serif"
                  style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 8, color: 'var(--primary)' }}
                >
                  Extracted Requirements
                </h4>
                <div
                  style={{
                    background: 'var(--surface-container-low)',
                    border: '1px solid var(--outline-variant)',
                    padding: '16px 20px',
                    borderRadius: 6,
                    fontSize: '0.88rem',
                  }}
                >
                  {selectedTask.extracted_requirements?.items &&
                  Array.isArray(selectedTask.extracted_requirements.items) &&
                  selectedTask.extracted_requirements.items.length > 0 ? (
                    <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {selectedTask.extracted_requirements.items.map((item: string, i: number) => (
                        <li key={i} style={{ color: 'var(--on-surface)' }}>
                          {item}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p style={{ color: 'var(--on-surface-variant)' }}>
                      {selectedTask.extracted_requirements?.summary ||
                        selectedTask.extracted_requirements?.raw_body ||
                        'No structured requirements extracted.'}
                    </p>
                  )}

                  {/* Format specifications */}
                  {selectedTask.extracted_requirements && (
                    <div
                      style={{
                        display: 'flex',
                        gap: 12,
                        marginTop: 12,
                        paddingTop: 10,
                        borderTop: '1px dashed var(--outline-variant)',
                        fontSize: '0.8rem',
                        color: 'var(--on-surface-variant)',
                        flexWrap: 'wrap',
                      }}
                    >
                      {selectedTask.extracted_requirements.output_style && (
                        <span>Style: <strong>{selectedTask.extracted_requirements.output_style}</strong></span>
                      )}
                      {selectedTask.extracted_requirements.slide_count && (
                        <span>Slides: <strong>{selectedTask.extracted_requirements.slide_count}</strong></span>
                      )}
                      {selectedTask.extracted_requirements.word_count && (
                        <span>Word Count: <strong>~{selectedTask.extracted_requirements.word_count}</strong></span>
                      )}
                      {selectedTask.extracted_requirements.language && (
                        <span>Language: <strong>{selectedTask.extracted_requirements.language}</strong></span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Success Criteria */}
              {selectedTask.success_criteria && (
                <div>
                  <h4
                    className="font-serif"
                    style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 8, color: '#276a3c' }}
                  >
                    Success Criteria
                  </h4>
                  <div
                    style={{
                      background: '#f4fbf5',
                      border: '1px solid #c3e6cb',
                      padding: '14px 18px',
                      borderRadius: 6,
                      fontSize: '0.88rem',
                      color: '#1e4620',
                    }}
                  >
                    {selectedTask.success_criteria}
                  </div>
                </div>
              )}

              {/* Antigravity Build Spec Prompt */}
              {selectedTask.build_spec && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <h4
                      className="font-serif"
                      style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--primary-container)' }}
                    >
                      Antigravity CLI Build Spec
                    </h4>
                    <button
                      onClick={() => {
                        if (selectedTask.build_spec) {
                          navigator.clipboard.writeText(selectedTask.build_spec);
                          setCopiedSpec(true);
                          setTimeout(() => setCopiedSpec(false), 2000);
                        }
                      }}
                      className="btn-heritage-secondary"
                      style={{ padding: '4px 12px', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                      {copiedSpec ? (
                        <>
                          <CheckIcon size={13} color="#2e7d32" />
                          <span>Copied!</span>
                        </>
                      ) : (
                        <>
                          <CopyIcon size={13} />
                          <span>Copy Spec Prompt</span>
                        </>
                      )}
                    </button>
                  </div>
                  <pre
                    className="font-mono"
                    style={{
                      background: 'var(--surface-dim)',
                      border: '1px solid var(--outline-variant)',
                      padding: 16,
                      borderRadius: 6,
                      fontSize: '0.78rem',
                      whiteSpace: 'pre-wrap',
                      maxHeight: 200,
                      overflowY: 'auto',
                      color: 'var(--on-surface)',
                      lineHeight: 1.5,
                    }}
                  >
                    {selectedTask.build_spec}
                  </pre>
                </div>
              )}

              {/* Result Summary & Assumptions */}
              {selectedTask.result_summary && (
                <div>
                  <h4
                    className="font-serif"
                    style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 8, color: 'var(--on-surface)' }}
                  >
                    Result Summary & Assumptions
                  </h4>
                  <div
                    style={{
                      background: 'var(--surface-container-low)',
                      border: '1px solid var(--outline-variant)',
                      padding: '14px 18px',
                      borderRadius: 6,
                      fontSize: '0.88rem',
                      color: 'var(--on-surface)',
                    }}
                  >
                    {selectedTask.result_summary}
                  </div>
                </div>
              )}

              {/* Clarification Questions Answering Interface (PRD Section 6.6) */}
              {(selectedTask as any).questions && (selectedTask as any).questions.length > 0 && (
                <div>
                  <h4
                    className="font-serif"
                    style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 8, color: 'var(--error)' }}
                  >
                    Human Clarification Questions
                  </h4>
                  {(selectedTask as any).questions.map((q: Question) => (
                    <div
                      key={q.id}
                      style={{
                        background: 'var(--surface-container-low)',
                        border: '1px solid var(--outline-variant)',
                        padding: 16,
                        borderRadius: 6,
                        marginBottom: 10,
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: '0.9rem',
                          color: 'var(--on-surface)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        <HelpIcon size={15} color="var(--primary-container)" />
                        <span>{q.question_text}</span>
                      </div>
                      {q.status === 'answered' ? (
                        <div
                          style={{
                            color: '#276a3c',
                            fontSize: '0.84rem',
                            marginTop: 6,
                            background: '#e2f0d9',
                            padding: '6px 12px',
                            borderRadius: 4,
                          }}
                        >
                          <strong>Your Answer:</strong> {q.answer_text}
                        </div>
                      ) : (
                        <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          <input
                            type="text"
                            placeholder="Type your clarification answer..."
                            value={replyText}
                            onChange={(e) => setReplyText(e.target.value)}
                            className="stationery-input"
                            style={{ flex: 1, minWidth: 220 }}
                          />
                          <button
                            onClick={() => handleAnswerQuestion(q.id)}
                            disabled={actionLoading || !replyText.trim()}
                            className="btn-heritage-primary"
                            style={{ padding: '8px 18px', fontSize: '0.85rem' }}
                          >
                            Submit Clarification
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Deliverables List (PRD Section 6.6) */}
              {(selectedTask as any).deliverables && (selectedTask as any).deliverables.length > 0 && (
                <div>
                  <h4
                    className="font-serif"
                    style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 8, color: '#276a3c' }}
                  >
                    Generated Deliverables
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {(selectedTask as any).deliverables.map((d: Deliverable) => (
                      <div
                        key={d.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          background: 'var(--surface-container-low)',
                          padding: '10px 16px',
                          borderRadius: 6,
                          border: '1px solid var(--outline-variant)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <FileIcon size={16} color="var(--primary)" />
                          <div>
                            <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{d.file_name}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--on-surface-variant)' }}>
                              Delivered via: {d.delivered_via || 'Google Drive'}
                            </div>
                          </div>
                        </div>
                        {d.drive_link && (
                          <a
                            href={d.drive_link}
                            target="_blank"
                            rel="noreferrer"
                            className="btn-heritage-primary"
                            style={{
                              textDecoration: 'none',
                              padding: '6px 12px',
                              fontSize: '0.78rem',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                            }}
                          >
                            <span>Open Drive Folder</span>
                            <ExternalLinkIcon size={12} color="#FFF9F6" />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 16 }}>
                {['flagged', 'failed'].includes(selectedTask.status) && (
                  <button
                    onClick={() => handleRetryTask(selectedTask.id)}
                    disabled={actionLoading}
                    className="btn-heritage-primary"
                  >
                    <RefreshIcon size={14} color="#FFF9F6" />
                    <span>Requeue & Retry Task</span>
                  </button>
                )}
                <button onClick={() => setSelectedTask(null)} className="btn-heritage-secondary">
                  Close Ledger
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Student Profile Settings Modal (PRD Section 5 & 6.6) */}
      {showProfileModal && profile && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(35, 26, 15, 0.45)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: 20,
          }}
          onClick={() => setShowProfileModal(false)}
        >
          <div
            className="heritage-card"
            style={{
              maxWidth: 720,
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '32px 36px',
              position: 'relative',
              background: 'var(--surface)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Button */}
            <button
              onClick={() => setShowProfileModal(false)}
              style={{
                position: 'absolute',
                top: 24,
                right: 24,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--outline)',
                padding: 4,
              }}
            >
              <CloseIcon size={20} />
            </button>

            {/* Modal Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
              <VicariusLogo size={42} variant="crest" />
              <div>
                <h2 className="heading-h2" style={{ fontSize: '1.45rem', color: 'var(--on-surface)', margin: 0 }}>
                  Student Profile & Tone Register
                </h2>
                <div style={{ fontSize: '0.82rem', color: 'var(--on-surface-variant)', marginTop: 2 }}>
                  Stored in Supabase <code>profile</code> table. Every build prompt reads live from this row.
                </div>
              </div>
            </div>

            {profileSavedMsg && (
              <div
                style={{
                  background: '#e2f0d9',
                  border: '1px solid #c3e6cb',
                  color: '#276a3c',
                  padding: '10px 14px',
                  borderRadius: 6,
                  fontSize: '0.86rem',
                  fontWeight: 600,
                  marginTop: 14,
                  marginBottom: 14,
                }}
              >
                ✓ {profileSavedMsg}
              </div>
            )}

            <form onSubmit={handleSaveProfile} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 18 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--on-surface)', marginBottom: 6 }}>
                    Full Name
                  </label>
                  <input
                    type="text"
                    value={profile.full_name || ''}
                    onChange={(e) => setProfile({ ...profile, full_name: e.target.value })}
                    className="stationery-input"
                    style={{ width: '100%' }}
                    required
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--on-surface)', marginBottom: 6 }}>
                    University / Institution
                  </label>
                  <input
                    type="text"
                    value={profile.university || ''}
                    onChange={(e) => setProfile({ ...profile, university: e.target.value })}
                    className="stationery-input"
                    style={{ width: '100%' }}
                    required
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--on-surface)', marginBottom: 6 }}>
                    Degree & Program
                  </label>
                  <input
                    type="text"
                    value={profile.program || ''}
                    onChange={(e) => setProfile({ ...profile, program: e.target.value })}
                    className="stationery-input"
                    style={{ width: '100%' }}
                    required
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--on-surface)', marginBottom: 6 }}>
                    Current Semester
                  </label>
                  <input
                    type="text"
                    value={profile.current_semester || ''}
                    onChange={(e) => setProfile({ ...profile, current_semester: e.target.value })}
                    className="stationery-input"
                    style={{ width: '100%' }}
                    required
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--on-surface)', marginBottom: 6 }}>
                    Citation Style
                  </label>
                  <select
                    value={profile.default_citation_style || 'IEEE'}
                    onChange={(e) => setProfile({ ...profile, default_citation_style: e.target.value })}
                    className="stationery-select"
                    style={{ width: '100%' }}
                  >
                    <option value="IEEE">IEEE</option>
                    <option value="APA">APA</option>
                    <option value="MLA">MLA</option>
                    <option value="Chicago">Chicago</option>
                    <option value="Harvard">Harvard</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--on-surface)', marginBottom: 6 }}>
                  Academic Level & Register Note
                </label>
                <textarea
                  rows={2}
                  value={profile.academic_level_note || ''}
                  onChange={(e) => setProfile({ ...profile, academic_level_note: e.target.value })}
                  className="stationery-input"
                  style={{ width: '100%', resize: 'vertical' }}
                  placeholder="e.g. Comfortable with rigorous technical depth, distributed systems, machine learning architectures..."
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--on-surface)', marginBottom: 6 }}>
                  Writing Voice Sample
                  <span style={{ fontWeight: 400, color: 'var(--outline)', marginLeft: 6 }}>
                    (Used as tone/style register reference, never copied verbatim)
                  </span>
                </label>
                <textarea
                  rows={4}
                  value={profile.writing_voice_sample || ''}
                  onChange={(e) => setProfile({ ...profile, writing_voice_sample: e.target.value })}
                  className="stationery-input"
                  style={{ width: '100%', resize: 'vertical', fontFamily: 'var(--font-serif)', fontSize: '0.9rem' }}
                  placeholder="A paragraph of your own past writing to anchor sentence rhythm and technical register..."
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 12 }}>
                <button
                  type="button"
                  onClick={() => setShowProfileModal(false)}
                  className="btn-heritage-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={profileSaving}
                  className="btn-heritage-primary"
                >
                  {profileSaving ? 'Saving to Supabase...' : 'Save Profile Live'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
