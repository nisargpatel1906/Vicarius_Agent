'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { Task, Question, Deliverable, SystemEvent, UserProfile } from '@/lib/types';
import { VicariusLogo } from '@/components/VicariusLogo';
import { ProfileEditor } from '@/components/ProfileEditor';
import { AgentWorld } from '@/components/AgentWorld';
import { TaskFlow } from '@/components/TaskFlow';
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
  UserIcon,
} from '@/components/Icons';

interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  message: string;
}

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
  const [activeTab, setActiveTab] = useState<'pipeline' | 'flow' | 'campus' | 'profile'>('pipeline');

  const [showProfileModal, setShowProfileModal] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [courseFilter, setCourseFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [showArchived, setShowArchived] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<string>('posted_desc');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [replyText, setReplyText] = useState<string>('');
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [ingesting, setIngesting] = useState<boolean>(false);
  const [copiedSpec, setCopiedSpec] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<string>('');
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Toast Notification Dispatcher (Checklist Items 14 & 15)
  const addToast = (type: 'success' | 'error' | 'info', title: string, message: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Support deep links from navigation / mobile drawer (?tab=profile, ?tab=campus, ?tab=flow)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('tab') === 'profile') {
        setActiveTab('profile');
      } else if (params.get('tab') === 'campus') {
        setActiveTab('campus');
      } else if (params.get('tab') === 'flow') {
        setActiveTab('flow');
      }
    }
  }, []);

  // Dynamic Document Titles (Checklist Item 4)
  useEffect(() => {
    if (selectedTask) {
      document.title = `${selectedTask.title} • Task Inspector | Vicarius Agent`;
    } else if (activeTab === 'flow') {
      document.title = 'Task Flow Trace • Vicarius Agent';
    } else if (activeTab === 'profile') {
      document.title = 'Student Profile & Vault • Vicarius Agent';
    } else if (activeTab === 'campus') {
      document.title = 'Agent Campus & City Simulation • Vicarius Agent';
    } else {
      document.title = 'Academic Operations Command • Vicarius Agent';
    }
  }, [activeTab, selectedTask]);

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
      const sortParam =
        sortBy === 'posted_asc'
          ? 'posted_date_asc'
          : sortBy === 'due_asc'
          ? 'due_date_asc'
          : 'posted_date_desc';
      const [tasksRes, healthRes, profileRes] = await Promise.all([
        fetch(`/api/tasks?archived=${showArchived}&sort_by=${sortParam}`),
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
    } catch (err: any) {
      console.error('Error fetching dashboard data:', err);
      addToast('error', 'Sync Failed', 'Could not refresh academic data from server.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // Adaptive auto-refresh: 4s when any task is actively processing, 15s when idle
    const hasActiveTasks = tasks.some((t) =>
      ['extracting', 'claimed', 'building', 'verifying', 'queued'].includes(t.status)
    );
    const pollInterval = hasActiveTasks ? 4000 : 15000;
    const interval = setInterval(fetchData, pollInterval);
    return () => clearInterval(interval);
  }, [showArchived, sortBy, tasks]);

  // Trigger manual ingestion (PRD Section 6.6)
  const handleTriggerIngest = async () => {
    try {
      setIngesting(true);
      addToast('info', 'Ingestion Initiated', 'Connecting to Google Classroom & Gmail listeners...');
      const res = await fetch('/api/ingest', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        addToast(
          'success',
          'Ingestion Complete',
          data.message || 'Coursework streams checked. Task ledger synchronized.'
        );
        await fetchData();
      } else {
        addToast('error', 'Ingestion Failed', data.error || 'Unable to complete intake cycle.');
      }
    } catch (err: any) {
      console.error('Failed to trigger ingestion:', err);
      addToast('error', 'Network Error', err.message || 'Could not connect to ingestion endpoint.');
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
        addToast('success', 'Task Requeued', 'Directive successfully returned to worker build queue.');
        await fetchData();
        if (selectedTask?.id === taskId) {
          setSelectedTask(data.data);
        }
      } else {
        addToast('error', 'Retry Failed', data.error || 'Could not requeue task.');
      }
    } catch (err: any) {
      console.error('Error retrying task:', err);
      addToast('error', 'Retry Error', err.message || 'Failed to communicate retry request.');
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
        addToast('success', 'Clarification Recorded', 'Directive unblocked. Agent resuming synthesis.');
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
      } else {
        addToast('error', 'Submission Failed', data.error || 'Could not record answer.');
      }
    } catch (err: any) {
      console.error('Error answering question:', err);
      addToast('error', 'Clarification Error', err.message || 'Failed to submit response.');
    } finally {
      setActionLoading(false);
    }
  };

  // Reset all search and filter dropdowns (Checklist Item 11)
  const handleResetFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setCourseFilter('all');
    setTypeFilter('all');
    addToast('info', 'Filters Cleared', 'Displaying all academic tasks in the ledger.');
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

  // Filter and sort tasks (Default: Newest / Early on top, Old on bottom)
  const filteredTasks = useMemo(() => {
    const list = tasks.filter((t) => {
      const matchesSearch =
        (t.title || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (t.course || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (t.task_type || '').toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === 'all' || t.status === statusFilter;
      const matchesCourse = courseFilter === 'all' || t.course === courseFilter;
      const matchesType = typeFilter === 'all' || t.task_type === typeFilter;
      return matchesSearch && matchesStatus && matchesCourse && matchesType;
    });

    return list.sort((a, b) => {
      const dateA = a.posted_date ? new Date(a.posted_date).getTime() : new Date(a.created_at).getTime();
      const dateB = b.posted_date ? new Date(b.posted_date).getTime() : new Date(b.created_at).getTime();

      if (sortBy === 'posted_asc') {
        return dateA - dateB;
      }
      if (sortBy === 'due_asc') {
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
      }
      // Default: posted_desc (Newest / Early on top, Old on bottom)
      return dateB - dateA;
    });
  }, [tasks, searchQuery, statusFilter, courseFilter, typeFilter, sortBy]);

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
            onClick={() => setActiveTab(activeTab === 'profile' ? 'pipeline' : 'profile')}
            className={activeTab === 'profile' ? 'btn-heritage-primary' : 'btn-heritage-secondary'}
            title="View and edit student profile and user info database"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <VicariusLogo size={14} variant="mark" fill={activeTab === 'profile' ? '#FFF9F6' : 'var(--primary)'} />
            <span>{activeTab === 'profile' ? 'Academic Stream' : 'Profile & User Info'}</span>
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

      {/* Primary View Switcher Navigation */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          borderBottom: '1px solid var(--outline-variant)',
          marginBottom: 24,
          background: 'var(--surface-container-low)',
          padding: '6px 12px 0 12px',
          borderRadius: '8px 8px 0 0',
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab('pipeline')}
          style={{
            padding: '10px 18px',
            background: activeTab === 'pipeline' ? 'var(--surface)' : 'transparent',
            border: 'none',
            borderBottom: activeTab === 'pipeline' ? '3px solid var(--primary)' : '3px solid transparent',
            color: activeTab === 'pipeline' ? 'var(--primary)' : 'var(--on-surface-variant)',
            fontWeight: activeTab === 'pipeline' ? 700 : 500,
            fontSize: '0.92rem',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            borderRadius: '6px 6px 0 0',
            transition: 'all 0.15s ease',
          }}
        >
          <ClassroomIcon size={16} color={activeTab === 'pipeline' ? 'var(--primary)' : 'var(--on-surface-variant)'} />
          <span>Academic Pipeline Stream</span>
          <span
            style={{
              fontSize: '11px',
              padding: '2px 7px',
              borderRadius: 10,
              background: activeTab === 'pipeline' ? 'var(--primary)' : 'var(--surface-container-high)',
              color: activeTab === 'pipeline' ? '#fff' : 'var(--on-surface-variant)',
              fontWeight: 700,
            }}
          >
            {tasks.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('campus')}
          style={{
            padding: '10px 18px',
            background: activeTab === 'campus' ? 'var(--surface)' : 'transparent',
            border: 'none',
            borderBottom: activeTab === 'campus' ? '3px solid var(--primary)' : '3px solid transparent',
            color: activeTab === 'campus' ? 'var(--primary)' : 'var(--on-surface-variant)',
            fontWeight: activeTab === 'campus' ? 700 : 500,
            fontSize: '0.92rem',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            borderRadius: '6px 6px 0 0',
            transition: 'all 0.15s ease',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="8" width="4" height="7" rx="1" fill={activeTab === 'campus' ? 'var(--primary)' : 'var(--on-surface-variant)'} opacity="0.8" />
            <rect x="6" y="5" width="4" height="10" rx="1" fill={activeTab === 'campus' ? 'var(--primary)' : 'var(--on-surface-variant)'} />
            <rect x="11" y="7" width="4" height="8" rx="1" fill={activeTab === 'campus' ? 'var(--primary)' : 'var(--on-surface-variant)'} opacity="0.8" />
          </svg>
          <span>Agent Campus &amp; City Simulation</span>
          <span
            style={{
              fontSize: '11px',
              padding: '2px 7px',
              borderRadius: 10,
              background: activeTab === 'campus' ? 'var(--primary)' : '#fdebd9',
              color: activeTab === 'campus' ? '#fff' : 'var(--primary)',
              fontWeight: 700,
              border: '1px solid currentColor',
            }}
          >
            Live Tour
          </span>
        </button>

        {/* ── Task Flow Tab ── */}
        <button
          type="button"
          onClick={() => setActiveTab('flow')}
          style={{
            padding: '10px 18px',
            background: activeTab === 'flow' ? 'var(--surface)' : 'transparent',
            border: 'none',
            borderBottom: activeTab === 'flow' ? '3px solid var(--primary)' : '3px solid transparent',
            color: activeTab === 'flow' ? 'var(--primary)' : 'var(--on-surface-variant)',
            fontWeight: activeTab === 'flow' ? 700 : 500,
            fontSize: '0.92rem',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            borderRadius: '6px 6px 0 0',
            transition: 'all 0.15s ease',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="2" cy="8" r="1.5" fill={activeTab === 'flow' ? 'var(--primary)' : 'var(--on-surface-variant)'} />
            <line x1="3.5" y1="8" x2="5.5" y2="8" stroke={activeTab === 'flow' ? 'var(--primary)' : 'var(--on-surface-variant)'} strokeWidth="1.3" />
            <rect x="5.5" y="5.5" width="5" height="5" rx="1.5" stroke={activeTab === 'flow' ? 'var(--primary)' : 'var(--on-surface-variant)'} strokeWidth="1.3" fill="none" />
            <line x1="10.5" y1="8" x2="12.5" y2="8" stroke={activeTab === 'flow' ? 'var(--primary)' : 'var(--on-surface-variant)'} strokeWidth="1.3" />
            <circle cx="14" cy="8" r="1.5" fill={activeTab === 'flow' ? 'var(--primary)' : 'var(--on-surface-variant)'} />
          </svg>
          <span>Task Flow Trace</span>
          <span
            style={{
              fontSize: '11px',
              padding: '2px 7px',
              borderRadius: 10,
              background: activeTab === 'flow' ? 'var(--primary)' : 'var(--surface-container-high)',
              color: activeTab === 'flow' ? '#fff' : 'var(--on-surface-variant)',
              fontWeight: 700,
            }}
          >
            E2E
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('profile')}
          style={{
            padding: '10px 18px',
            background: activeTab === 'profile' ? 'var(--surface)' : 'transparent',
            border: 'none',
            borderBottom: activeTab === 'profile' ? '3px solid var(--primary)' : '3px solid transparent',
            color: activeTab === 'profile' ? 'var(--primary)' : 'var(--on-surface-variant)',
            fontWeight: activeTab === 'profile' ? 700 : 500,
            fontSize: '0.92rem',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            borderRadius: '6px 6px 0 0',
            transition: 'all 0.15s ease',
          }}
        >
          <VicariusLogo size={16} variant="mark" fill={activeTab === 'profile' ? 'var(--primary)' : 'var(--on-surface-variant)'} />
          <span>Profile & User Info Database</span>
          <span
            style={{
              fontSize: '11px',
              padding: '2px 7px',
              borderRadius: 10,
              background: '#e2f0d9',
              color: '#276a3c',
              fontWeight: 700,
            }}
          >
            Live Vault
          </span>
        </button>
      </div>

      {activeTab === 'profile' ? (
        <ProfileEditor
          initialProfile={profile}
          onProfileUpdated={(updated) => {
            setProfile(updated);
            addToast('success', 'Profile Updated', 'Student coordinates saved to Supabase.');
          }}
        />
      ) : activeTab === 'campus' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <AgentWorld
            tasks={tasks}
            selectedTask={selectedTask}
            onSelectTask={(task) => setSelectedTask(task)}
            onRefresh={fetchData}
            onTriggerIngest={handleTriggerIngest}
            onRetryTask={handleRetryTask}
            loading={loading}
            ingesting={ingesting}
          />
        </div>
      ) : activeTab === 'flow' ? (
        <TaskFlow
          tasks={tasks}
          selectedTask={selectedTask}
          onSelectTask={(task) => setSelectedTask(task)}
        />
      ) : tasks.length === 0 && !loading ? (
        <div
          className="heritage-card"
          style={{
            padding: 'clamp(32px, 6vw, 64px) clamp(20px, 5vw, 48px)',
            textAlign: 'center',
            position: 'relative',
            overflow: 'hidden',
            background: 'var(--surface-container-lowest)',
          }}
        >
          <VicariusLogo
            size={280}
            variant="watermark"
            fill="#8B6F3E"
            style={{ right: '-50px', bottom: '-50px', opacity: 0.05 }}
          />

          <div style={{ display: 'inline-flex', marginBottom: 16 }}>
            <VicariusLogo size={56} variant="crest" />
          </div>

          <div style={{ marginBottom: 12 }}>
            <span
              className="label-caps"
              style={{
                background: 'var(--primary-fixed)',
                color: 'var(--on-primary-fixed)',
                padding: '4px 12px',
                borderRadius: 20,
                fontSize: '11px',
                fontWeight: 700,
                border: '1px solid var(--outline-variant)',
              }}
            >
              Autonomous Pipeline Idle &bull; Ledger Clear
            </span>
          </div>

          <h2
            className="heading-h1"
            style={{
              fontSize: 'clamp(1.5rem, 3vw, 2.2rem)',
              color: 'var(--on-surface)',
              marginBottom: 12,
            }}
          >
            Academic Operations Ledger Clear
          </h2>

          <p
            style={{
              fontSize: '0.94rem',
              color: 'var(--on-surface-variant)',
              lineHeight: 1.6,
              maxWidth: 560,
              margin: '0 auto 32px auto',
            }}
          >
            No coursework directives or academic deliverables are currently pending in the Supabase ledger. Autonomous listeners are periodically polling Google Classroom and Gmail, or you can trigger an on-demand intake poll immediately.
          </p>

          {/* Empty State Quick Actions (Checklist Item 11) */}
          <div
            style={{
              display: 'flex',
              gap: 14,
              justifyContent: 'center',
              flexWrap: 'wrap',
              maxWidth: 620,
              margin: '0 auto',
            }}
          >
            <button
              onClick={handleTriggerIngest}
              disabled={ingesting}
              className="btn-heritage-primary"
              style={{ padding: '12px 24px', fontSize: '0.92rem' }}
            >
              <ZapIcon size={16} color="#FFF9F6" />
              <span>{ingesting ? 'Polling Classroom & Gmail...' : 'Poll Classroom & Gmail Now'}</span>
            </button>

            <button
              onClick={() => setActiveTab('profile')}
              className="btn-heritage-secondary"
              style={{ padding: '12px 20px', fontSize: '0.92rem' }}
            >
              <UserIcon size={16} color="var(--primary)" />
              <span>Configure Student Profile &amp; Vault</span>
            </button>

            <button
              onClick={fetchData}
              disabled={loading}
              className="btn-heritage-secondary"
              style={{ padding: '12px 18px', fontSize: '0.92rem' }}
            >
              <RefreshIcon size={15} color="var(--primary)" />
              <span>Refresh Stream</span>
            </button>
          </div>
        </div>
      ) : (
        <>

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

      {/* Main Content Split: Tasks Ledger + Telemetry / Quotas (Responsive Grid) */}
      <div className="dashboard-main-grid">
        {/* Left Column: Academic Task Ledger */}
        <div className="heritage-card" style={{ padding: 'clamp(16px, 3vw, 24px)', display: 'flex', flexDirection: 'column', gap: 18 }}>
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
                placeholder="Filter tasks by title, course, or prompt..."
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

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="stationery-select"
              title="Classroom post date ordering"
              style={{ fontWeight: 600, color: 'var(--primary)' }}
            >
              <option value="posted_desc">Sort: Classroom Posted (Newest First / Old at Bottom)</option>
              <option value="posted_asc">Sort: Classroom Posted (Oldest First)</option>
              <option value="due_asc">Sort: Deadline (Most Urgent First)</option>
            </select>
          </div>

          {/* Desktop Table View (Checklist Item 1 & 12) */}
          <div className="table-scroll-wrapper desktop-view-only">
            <table className="academic-table">
              <thead>
                <tr>
                  <th style={{ width: '110px' }}>Source</th>
                  <th>Assignment / Deliverable</th>
                  <th>Course</th>
                  <th>Type</th>
                  <th>Posted (Classroom)</th>
                  <th>Deadline (IST)</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTasks.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: '48px 16px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                        <VicariusLogo size={48} variant="mark" fill="var(--outline-variant)" />
                        <div className="font-serif" style={{ fontSize: '1.1rem', color: 'var(--on-surface-variant)' }}>
                          {loading ? 'Consulting database ledger...' : 'No academic tasks found matching current filters.'}
                        </div>
                        <p style={{ fontSize: '0.82rem', color: 'var(--outline)' }}>
                          {searchQuery || statusFilter !== 'all' || courseFilter !== 'all' || typeFilter !== 'all'
                            ? 'Active search or filter criteria restricted all records.'
                            : 'Trigger a poll using the action button to ingest recent assignments.'}
                        </p>
                        {(searchQuery || statusFilter !== 'all' || courseFilter !== 'all' || typeFilter !== 'all') && (
                          <button
                            type="button"
                            onClick={handleResetFilters}
                            className="btn-heritage-secondary"
                            style={{ fontSize: '0.82rem', padding: '6px 16px', marginTop: 6 }}
                          >
                            <RefreshIcon size={13} color="var(--primary)" />
                            <span>Reset All Filters</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredTasks.map((t) => {
                    const deadline = getDeadlineInfo(t.due_date);
                    const postedFormatted = t.posted_date
                      ? new Date(t.posted_date).toLocaleDateString('en-IN', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: 'Asia/Kolkata',
                        })
                      : t.created_at
                      ? new Date(t.created_at).toLocaleDateString('en-IN', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: 'Asia/Kolkata',
                        })
                      : '—';

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
                          <span style={{ fontSize: '0.82rem', color: 'var(--on-surface-variant)', whiteSpace: 'nowrap' }}>
                            {postedFormatted}
                          </span>
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

          {/* Mobile Card View (Checklist Item 1, 10, 12, 13) */}
          <div className="mobile-view-only" style={{ flexDirection: 'column', gap: 12 }}>
            {filteredTasks.length === 0 ? (
              <div className="heritage-card" style={{ padding: '36px 16px', textAlign: 'center' }}>
                <VicariusLogo size={40} variant="mark" fill="var(--outline-variant)" />
                <div className="font-serif" style={{ fontSize: '1.05rem', marginTop: 10, color: 'var(--on-surface)' }}>
                  No tasks matching criteria
                </div>
                <p style={{ fontSize: '0.8rem', color: 'var(--outline)', marginTop: 4 }}>
                  Reset filters to display all coursework records.
                </p>
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="btn-heritage-secondary"
                  style={{ marginTop: 14, fontSize: '0.8rem', padding: '6px 14px' }}
                >
                  <RefreshIcon size={13} />
                  <span>Reset All Filters</span>
                </button>
              </div>
            ) : (
              filteredTasks.map((t) => {
                const deadline = getDeadlineInfo(t.due_date);
                const postedFormatted = t.posted_date
                  ? new Date(t.posted_date).toLocaleDateString('en-IN', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: 'Asia/Kolkata',
                    })
                  : t.created_at
                  ? new Date(t.created_at).toLocaleDateString('en-IN', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: 'Asia/Kolkata',
                    })
                  : '—';

                return (
                  <div
                    key={t.id}
                    className="academic-mobile-card"
                    onClick={() => setSelectedTask(t)}
                    style={{ cursor: 'pointer' }}
                  >
                    {/* Card Header: Source & Status */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--on-surface-variant)',
                          background: 'var(--surface-container-high)',
                          padding: '2px 8px',
                          borderRadius: 4,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          fontWeight: 600,
                        }}
                      >
                        {t.source === 'classroom' ? (
                          <>
                            <ClassroomIcon size={12} color="var(--primary)" />
                            <span>Classroom</span>
                          </>
                        ) : (
                          <>
                            <MailIcon size={12} color="var(--primary-container)" />
                            <span>Gmail</span>
                          </>
                        )}
                      </span>
                      {renderStatusBadge(t.status)}
                    </div>

                    {/* Title */}
                    <div>
                      <h4
                        className="font-serif"
                        style={{
                          fontSize: '0.98rem',
                          fontWeight: 600,
                          color: 'var(--on-surface)',
                          lineHeight: 1.35,
                        }}
                      >
                        {t.title}
                      </h4>
                      {t.result_summary && (
                        <p
                          style={{
                            fontSize: '0.78rem',
                            color: 'var(--on-surface-variant)',
                            marginTop: 4,
                            lineHeight: 1.4,
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}
                        >
                          {t.result_summary}
                        </p>
                      )}
                    </div>

                    {/* Metadata chips */}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span
                        style={{
                          fontSize: '0.72rem',
                          background: 'var(--surface-container-low)',
                          border: '1px solid var(--outline-variant)',
                          padding: '2px 8px',
                          borderRadius: 4,
                          color: 'var(--on-surface)',
                          fontWeight: 600,
                        }}
                      >
                        {t.course || 'General Academic'}
                      </span>
                      <span
                        style={{
                          fontSize: '0.72rem',
                          background: 'var(--surface-container-low)',
                          border: '1px solid var(--outline-variant)',
                          padding: '2px 8px',
                          borderRadius: 4,
                          color: 'var(--secondary)',
                          textTransform: 'capitalize',
                        }}
                      >
                        {t.task_type?.replace('_', ' ')}
                      </span>
                      {t.weight && (
                        <span
                          style={{
                            fontSize: '0.66rem',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            padding: '2px 6px',
                            borderRadius: 4,
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
                          }}
                        >
                          {t.weight}
                        </span>
                      )}
                    </div>

                    {/* Dates & Deadline */}
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        borderTop: '1px solid var(--outline-variant)',
                        paddingTop: 8,
                        fontSize: '0.75rem',
                        color: 'var(--on-surface-variant)',
                      }}
                    >
                      <div>Posted: {postedFormatted}</div>
                      <div style={{ textAlign: 'right' }}>
                        <span
                          style={{
                            fontWeight: deadline.isUrgent ? 700 : 500,
                            color: deadline.isUrgent ? 'var(--error)' : 'var(--on-surface)',
                          }}
                        >
                          {deadline.formatted}
                        </span>
                        <span style={{ marginLeft: 4, color: deadline.isUrgent ? 'var(--error)' : 'var(--outline)' }}>
                          ({deadline.relative})
                        </span>
                      </div>
                    </div>

                    {/* Action Row */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                      {['flagged', 'failed'].includes(t.status) && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRetryTask(t.id);
                          }}
                          disabled={actionLoading}
                          className="btn-heritage-primary"
                          style={{ fontSize: '0.75rem', padding: '5px 12px' }}
                        >
                          <RefreshIcon size={12} color="#FFF9F6" />
                          <span>Retry</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedTask(t);
                        }}
                        className="btn-heritage-secondary"
                        style={{ fontSize: '0.75rem', padding: '5px 12px' }}
                      >
                        Inspect Details &rarr;
                      </button>
                    </div>
                  </div>
                );
              })
            )}
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
            padding: 'clamp(8px, 3vw, 24px)',
          }}
          onClick={() => setSelectedTask(null)}
        >
          <div
            className="heritage-card"
            style={{
              maxWidth: 840,
              width: '100%',
              maxHeight: '92vh',
              overflowY: 'auto',
              padding: 'clamp(18px, 4vw, 36px)',
              position: 'relative',
              background: '#ffffff',
              boxShadow: 'var(--shadow-modal)',
              boxSizing: 'border-box',
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
                top: 'clamp(12px, 3vw, 24px)',
                right: 'clamp(12px, 3vw, 24px)',
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
                </div>
              </div>
            </div>

            <h2
              className="heading-h2"
              style={{
                fontSize: 'clamp(1.2rem, 3vw, 1.65rem)',
                color: 'var(--on-surface)',
                marginTop: 8,
                marginBottom: 6,
              }}
            >
              {selectedTask.title}
            </h2>

            {(selectedTask as any).prompt && (
              <p style={{ color: 'var(--on-surface-variant)', fontSize: '0.9rem', marginBottom: 20, lineHeight: 1.5 }}>
                {(selectedTask as any).prompt}
              </p>
            )}

            {/* Quick Spec Pills */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: 10,
                background: 'var(--surface-container-low)',
                padding: 14,
                borderRadius: 6,
                border: '1px solid var(--outline-variant)',
                marginBottom: 20,
              }}
            >
              <div>
                <span className="label-caps" style={{ color: 'var(--outline)' }}>
                  Due Date
                </span>
                <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--on-surface)', marginTop: 2 }}>
                  {getDeadlineInfo(selectedTask.due_date).formatted}
                </div>
              </div>
              <div>
                <span className="label-caps" style={{ color: 'var(--outline)' }}>
                  Task Type
                </span>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: '0.88rem',
                    color: 'var(--on-surface)',
                    textTransform: 'capitalize',
                    marginTop: 2,
                  }}
                >
                  {selectedTask.task_type?.replace('_', ' ')}
                </div>
              </div>
              <div>
                <span className="label-caps" style={{ color: 'var(--outline)' }}>
                  Complexity
                </span>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: '0.88rem',
                    color: 'var(--on-surface)',
                    textTransform: 'capitalize',
                    marginTop: 2,
                  }}
                >
                  {selectedTask.weight || 'Standard'}
                </div>
              </div>
              <div>
                <span className="label-caps" style={{ color: 'var(--outline)' }}>
                  Course Code
                </span>
                <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--on-surface)', marginTop: 2 }}>
                  {selectedTask.course || 'General'}
                </div>
              </div>
            </div>

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
                          addToast('success', 'Build Spec Copied', 'Antigravity CLI prompt copied to clipboard.');
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
                    Result Summary &amp; Assumptions
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
                            placeholder="Type specific clarification for the worker..."
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

              {/* Deliverables List (PRD Section 6.6 & Checklist Item 7) */}
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
                          flexWrap: 'wrap',
                          gap: 8,
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
                        {d.drive_link && d.drive_link.startsWith('http') ? (
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
                        ) : (
                          <span
                            style={{
                              fontSize: '0.75rem',
                              color: 'var(--on-surface-variant)',
                              background: 'var(--surface-container-high)',
                              padding: '4px 10px',
                              borderRadius: 4,
                            }}
                          >
                            Archived Locally
                          </span>
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
                    <span>Requeue &amp; Retry Task</span>
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
      </>
    )}

      {/* Student Profile Settings Modal (PRD Section 5 & 6.6) */}
      {showProfileModal && (
        <ProfileEditor
          initialProfile={profile}
          isModal={true}
          onClose={() => setShowProfileModal(false)}
          onProfileUpdated={(updated) => {
            setProfile(updated);
            addToast('success', 'Profile Updated', 'Student coordinates saved to Supabase.');
          }}
        />
      )}

      {/* Toast Notifications Container (Checklist Items 14 & 15) */}
      <div className="toast-container" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast-item ${
              toast.type === 'success'
                ? 'toast-success'
                : toast.type === 'error'
                ? 'toast-error'
                : 'toast-info'
            }`}
            role="alert"
          >
            <div style={{ marginTop: 2, flexShrink: 0 }}>
              {toast.type === 'success' ? (
                <CheckIcon size={16} color="#2e7d32" />
              ) : toast.type === 'error' ? (
                <AlertIcon size={16} color="#ba1a1a" />
              ) : (
                <SparklesIcon size={16} color="var(--primary)" />
              )}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: '0.86rem' }}>{toast.title}</div>
              <div style={{ fontSize: '0.8rem', opacity: 0.9, marginTop: 2 }}>{toast.message}</div>
            </div>
            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'inherit',
                opacity: 0.6,
                cursor: 'pointer',
                padding: 2,
                marginLeft: 4,
              }}
              aria-label="Dismiss alert"
            >
              <CloseIcon size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
