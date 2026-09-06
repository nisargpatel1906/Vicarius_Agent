'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Task } from '@/lib/types';

export interface AgentWorldProps {
  tasks: Task[];
  selectedTask: Task | null;
  onSelectTask?: (task: Task) => void;
  className?: string;
  style?: React.CSSProperties;
}

// Landmark Coordinates in SVG Canvas (1020 x 540)
interface LandmarkPoint {
  id: string;
  name: string;
  subtitle: string;
  x: number;
  y: number;
  stageName: string;
  langGraphNodes: string[];
  toolsUsed: string[];
  description: string;
  iconType: 'home' | 'academy' | 'foundry' | 'qa' | 'shipping';
}

const LANDMARKS: LandmarkPoint[] = [
  {
    id: 'home',
    name: 'Telegram Base & Home',
    subtitle: 'Student Residence & Idle Porch',
    x: 120,
    y: 330,
    stageName: 'Idle / Directive Intake',
    langGraphNodes: ['START', 'User Directive', 'END'],
    toolsUsed: ['Telegram Bot API', 'Supabase Realtime', 'Gmail / Classroom Ingest'],
    description:
      'Where academic directives originate from Telegram, Google Classroom, and Gmail. Vicarius rests here by the porch with tea between missions.',
    iconType: 'home',
  },
  {
    id: 'academy',
    name: 'Thinker Academy',
    subtitle: 'Research & Strategy Library',
    x: 320,
    y: 170,
    stageName: 'Planning & Deep Thinking',
    langGraphNodes: ['extractor', 'planner', 'thinker', 'thinker_validator'],
    toolsUsed: ['Claude 3.7 Sonnet', 'Gemini 2.5 Pro', 'Reflexion Rubrics'],
    description:
      'Extracts requirements, syllabus constraints, and citation styles. Formulates step-by-step execution blueprints and quality criteria.',
    iconType: 'academy',
  },
  {
    id: 'foundry',
    name: "Nisarg's PC Foundry",
    subtitle: 'Local Machine & Coder Workshop',
    x: 520,
    y: 340,
    stageName: 'Antigravity CLI Synthesis',
    langGraphNodes: ['coder', 'worker.worker', 'task_work_dir'],
    toolsUsed: ['Antigravity CLI (agy)', 'python-pptx', 'docx', 'PyTorch / GPU'],
    description:
      'Local execution on your PC. Compiles Python scripts, runs headless builds, generates master slide decks, and builds code deliverables.',
    iconType: 'foundry',
  },
  {
    id: 'qa',
    name: 'QA & Verification Gate',
    subtitle: 'Inspection Observatory',
    x: 720,
    y: 170,
    stageName: 'Rubric & Slide Audit',
    langGraphNodes: ['verifier', 'diagnoser', 'thinker_validator'],
    toolsUsed: ['Slide Count Checker', 'Citation Liveness HTTP', 'Format Integrity'],
    description:
      'Inspects deliverables against exact requirements: validates slide counts (e.g. 17 slides), runs HTTP HEAD citation checks, and executes test suites.',
    iconType: 'qa',
  },
  {
    id: 'shipping',
    name: 'Shipping Station & Dock',
    subtitle: 'Google Drive & Cloud Port',
    x: 900,
    y: 330,
    stageName: 'Packaging & Delivery Dispatch',
    langGraphNodes: ['deliverer', 'escalator', 'END'],
    toolsUsed: ['Google Drive API v3', 'Telegram sendDocument', 'Google Calendar API'],
    description:
      'Packages ZIP archives, uploads deliverables to public Google Drive folders, schedules calendar reminders, and sends verified completion alerts to Telegram.',
    iconType: 'shipping',
  },
];

// Waypoint Interpolation for Avatar Movement
interface WaypointStep {
  fromIndex: number;
  toIndex: number;
  actionText: string;
  thought: string;
  isStationary: boolean;
}

const SIMULATION_STEPS: WaypointStep[] = [
  {
    fromIndex: 0,
    toIndex: 0,
    actionText: 'Resting at Telegram Base',
    thought: 'Idle by the fireplace. Monitoring student coursework channels...',
    isStationary: true,
  },
  {
    fromIndex: 0,
    toIndex: 1,
    actionText: 'Commuting to Thinker Academy',
    thought: 'New academic directive received! Walking to research library...',
    isStationary: false,
  },
  {
    fromIndex: 1,
    toIndex: 1,
    actionText: 'Formulating Blueprint in Academy',
    thought: 'Extracting rubrics with Claude 3.7 Sonnet. Drafting execution plan...',
    isStationary: true,
  },
  {
    fromIndex: 1,
    toIndex: 2,
    actionText: "Walking to Nisarg's PC Foundry",
    thought: 'Blueprint locked! Commuting to the PC workshop to forge deliverables...',
    isStationary: false,
  },
  {
    fromIndex: 2,
    toIndex: 2,
    actionText: 'Compiling Code in Antigravity CLI',
    thought: 'Synthesizing 17-slide master deck in local workspace via python-pptx...',
    isStationary: true,
  },
  {
    fromIndex: 2,
    toIndex: 3,
    actionText: 'Walking to QA & Verification Gate',
    thought: 'Build produced! Carrying deliverables to the inspection observatory...',
    isStationary: false,
  },
  {
    fromIndex: 3,
    toIndex: 3,
    actionText: 'Running Rubric & Citation Audits',
    thought: 'Checking 17 slides count, citation URLs, and formatting standards...',
    isStationary: true,
  },
  {
    fromIndex: 3,
    toIndex: 4,
    actionText: 'Commuting to Shipping Station',
    thought: 'Verification 100% PASSED! Taking deliverables to Google Drive dock...',
    isStationary: false,
  },
  {
    fromIndex: 4,
    toIndex: 4,
    actionText: 'Uploading to Google Drive & Telegram',
    thought: 'Drive link generated! Broadcasting completion payload to Telegram...',
    isStationary: true,
  },
  {
    fromIndex: 4,
    toIndex: 0,
    actionText: 'Mission Complete! Returning Home',
    thought: 'Student mission delivered! Journeying back along the garden path to rest.',
    isStationary: false,
  },
];

export function AgentWorld({
  tasks,
  selectedTask,
  onSelectTask,
  className = '',
  style = {},
}: AgentWorldProps) {
  // Mode: 'live' (tracks active task) | 'simulation' (interactive playback)
  const [mode, setMode] = useState<'live' | 'simulation'>('live');
  const [simStepIndex, setSimStepIndex] = useState<number>(0);
  const [simProgress, setSimProgress] = useState<number>(0); // 0 to 1 between landmarks
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [speedMultiplier, setSpeedMultiplier] = useState<number>(1);
  const [activeLandmarkDetail, setActiveLandmarkDetail] = useState<LandmarkPoint | null>(null);

  // Derive the active task to monitor
  const activeTask = useMemo(() => {
    if (selectedTask) return selectedTask;
    // Look for currently active task
    const running = tasks.find((t) =>
      ['claimed', 'building', 'verifying', 'extracting'].includes(t.status)
    );
    if (running) return running;
    // Look for queued
    const queued = tasks.find((t) => t.status === 'queued' && !t.archived);
    if (queued) return queued;
    // Default to most recently updated task
    return tasks[0] || null;
  }, [tasks, selectedTask]);

  // Map real task status to campus landmark & step
  const liveStageInfo = useMemo(() => {
    if (!activeTask) {
      return {
        stepIndex: 0,
        landmarkIndex: 0,
        progress: 0,
        action: 'Resting at Home Base',
        thought: 'Awaiting student directives from Telegram or Google Classroom.',
        isMoving: false,
      };
    }

    switch (activeTask.status) {
      case 'new':
      case 'extracting':
      case 'queued':
        return {
          stepIndex: 1,
          landmarkIndex: 0,
          progress: 0.25,
          action: `Queued Directive: "${activeTask.title}"`,
          thought: `Received directive for ${activeTask.course || 'Academic Course'}. Preparing to head to Academy.`,
          isMoving: true,
        };
      case 'claimed':
        return {
          stepIndex: 2,
          landmarkIndex: 1,
          progress: 0.9,
          action: 'Planner & Thinker Active',
          thought: `Formulating execution strategy with Claude 3.7 Sonnet for "${activeTask.title}"...`,
          isMoving: false,
        };
      case 'building':
        return {
          stepIndex: 4,
          landmarkIndex: 2,
          progress: 0.6,
          action: `PC Foundry: Coder Building Deliverables`,
          thought: `Antigravity CLI executing in local workspace (${activeTask.task_type}). Compiling artifacts...`,
          isMoving: false,
        };
      case 'verifying':
        return {
          stepIndex: 6,
          landmarkIndex: 3,
          progress: 0.8,
          action: 'Observatory: QA Verification',
          thought: `Auditing deliverable artifacts against PRD rubric and slide count constraints...`,
          isMoving: false,
        };
      case 'done':
        return {
          stepIndex: 8,
          landmarkIndex: 4,
          progress: 1.0,
          action: 'Delivery Shipped to Drive & Telegram',
          thought: `Task "${activeTask.title}" delivered to Google Drive folder and Telegram! Vicarius resting at base.`,
          isMoving: false,
        };
      case 'flagged':
        return {
          stepIndex: 3,
          landmarkIndex: 3,
          progress: 0.5,
          action: 'Needs Clarification / Review',
          thought: 'Task escalated for student input or human review in dashboard.',
          isMoving: false,
        };
      default:
        return {
          stepIndex: 0,
          landmarkIndex: 0,
          progress: 0,
          action: 'Idle at Telegram Base',
          thought: 'Campus quiet. Ready for next academic assignment.',
          isMoving: false,
        };
    }
  }, [activeTask]);

  // Simulation playback timer
  useEffect(() => {
    if (mode !== 'simulation' || !isPlaying) return;

    const intervalTime = 50 / speedMultiplier;
    const timer = setInterval(() => {
      setSimProgress((prev) => {
        const step = SIMULATION_STEPS[simStepIndex];
        const stepRate = step.isStationary ? 0.02 : 0.015;
        const next = prev + stepRate;
        if (next >= 1) {
          // Advance step
          setSimStepIndex((currStep) => (currStep + 1) % SIMULATION_STEPS.length);
          return 0;
        }
        return next;
      });
    }, intervalTime);

    return () => clearInterval(timer);
  }, [mode, isPlaying, simStepIndex, speedMultiplier]);

  // Compute current Agent position (x, y)
  const agentPos = useMemo(() => {
    let fromLandmark: LandmarkPoint;
    let toLandmark: LandmarkPoint;
    let t = 0;
    let isMoving = false;
    let facingLeft = false;

    if (mode === 'simulation') {
      const step = SIMULATION_STEPS[simStepIndex];
      fromLandmark = LANDMARKS[step.fromIndex];
      toLandmark = LANDMARKS[step.toIndex];
      t = simProgress;
      isMoving = !step.isStationary;
      // Facing direction (if moving back to home, face left)
      facingLeft = step.toIndex < step.fromIndex || (step.fromIndex === 4 && step.toIndex === 0);
    } else {
      // Live Mode
      const lm = LANDMARKS[liveStageInfo.landmarkIndex];
      fromLandmark = lm;
      toLandmark = lm;
      t = liveStageInfo.progress;
      isMoving = liveStageInfo.isMoving;
    }

    // Bézier curved path interpolation between points
    if (fromLandmark.id === toLandmark.id) {
      return {
        x: fromLandmark.x,
        y: fromLandmark.y + 45,
        isMoving,
        facingLeft,
      };
    }

    // If moving from shipping back to home, use a lower scenic curved loop
    const isReturnLoop = fromLandmark.id === 'shipping' && toLandmark.id === 'home';
    const midX = (fromLandmark.x + toLandmark.x) / 2;
    const midY = isReturnLoop ? 480 : (fromLandmark.y + toLandmark.y) / 2 - 40;

    // Quadratic Bézier curve calculation
    const u = 1 - t;
    const x = u * u * fromLandmark.x + 2 * u * t * midX + t * t * toLandmark.x;
    const y = u * u * (fromLandmark.y + 45) + 2 * u * t * midY + t * t * (toLandmark.y + 45);

    return { x, y, isMoving, facingLeft };
  }, [mode, simStepIndex, simProgress, liveStageInfo]);

  // Active status caption & thought bubble
  const currentAction = mode === 'simulation'
    ? SIMULATION_STEPS[simStepIndex].actionText
    : liveStageInfo.action;

  const currentThought = mode === 'simulation'
    ? SIMULATION_STEPS[simStepIndex].thought
    : liveStageInfo.thought;

  const activeLandmarkId = mode === 'simulation'
    ? (SIMULATION_STEPS[simStepIndex].isStationary
        ? LANDMARKS[SIMULATION_STEPS[simStepIndex].toIndex].id
        : null)
    : LANDMARKS[liveStageInfo.landmarkIndex].id;

  return (
    <div
      className={`heritage-card ${className}`}
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: 'linear-gradient(180deg, #fffaf5 0%, #fdf5ea 100%)',
        border: '1px solid var(--outline-variant)',
        borderRadius: 12,
        padding: '24px 20px',
        boxShadow: 'var(--shadow-diffused)',
        ...style,
      }}
    >
      {/* Header & Mode Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 16,
          marginBottom: 16,
          borderBottom: '1px solid var(--outline-variant)',
          paddingBottom: 16,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: '1.25rem' }}>🏰</span>
            <h3
              className="heading-h3"
              style={{
                fontFamily: "'Noto Serif', serif",
                color: 'var(--on-surface)',
                margin: 0,
                fontSize: '1.2rem',
              }}
            >
              Living Agent Campus & Autonomous City
            </h3>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 12,
                background: mode === 'live' ? '#e2f0d9' : '#fff1e5',
                color: mode === 'live' ? '#276a3c' : 'var(--primary)',
                border: '1px solid currentColor',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'currentColor',
                }}
              />
              {mode === 'live' ? 'Live State Tracking' : 'Interactive Simulation'}
            </span>
          </div>
          <p style={{ color: 'var(--on-surface-variant)', fontSize: '0.86rem', margin: 0 }}>
            {mode === 'live'
              ? `Synchronized with Supabase & LangGraph: tracking ${activeTask ? `"${activeTask.title}"` : 'idle state'}`
              : 'Interactive walkthrough demonstrating the 5-stage academic execution journey.'}
          </p>
        </div>

        {/* Mode Switcher & Controls */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div
            style={{
              display: 'inline-flex',
              background: 'var(--surface-container)',
              borderRadius: 6,
              padding: 3,
              border: '1px solid var(--outline-variant)',
            }}
          >
            <button
              type="button"
              onClick={() => setMode('live')}
              style={{
                padding: '6px 14px',
                border: 'none',
                borderRadius: 4,
                fontSize: '0.82rem',
                fontWeight: mode === 'live' ? 700 : 500,
                background: mode === 'live' ? 'var(--surface)' : 'transparent',
                color: mode === 'live' ? 'var(--primary)' : 'var(--on-surface-variant)',
                boxShadow: mode === 'live' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              📡 Live State
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('simulation');
                setIsPlaying(true);
              }}
              style={{
                padding: '6px 14px',
                border: 'none',
                borderRadius: 4,
                fontSize: '0.82rem',
                fontWeight: mode === 'simulation' ? 700 : 500,
                background: mode === 'simulation' ? 'var(--surface)' : 'transparent',
                color: mode === 'simulation' ? 'var(--primary)' : 'var(--on-surface-variant)',
                boxShadow: mode === 'simulation' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              🎮 Tour Simulation
            </button>
          </div>

          {/* Simulation Controls (Visible when in simulation mode) */}
          {mode === 'simulation' && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: 'var(--surface-container-low)',
                padding: '4px 8px',
                borderRadius: 6,
                border: '1px solid var(--outline-variant)',
              }}
            >
              <button
                type="button"
                onClick={() => setIsPlaying(!isPlaying)}
                className="btn-heritage-secondary"
                style={{ padding: '4px 10px', fontSize: '0.8rem', minHeight: 28 }}
                title={isPlaying ? 'Pause Simulation' : 'Play Simulation'}
              >
                {isPlaying ? '⏸ Pause' : '▶ Play'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setSimStepIndex((curr) => (curr + 1) % SIMULATION_STEPS.length);
                  setSimProgress(0);
                }}
                className="btn-heritage-secondary"
                style={{ padding: '4px 10px', fontSize: '0.8rem', minHeight: 28 }}
                title="Step to next landmark"
              >
                ⏭ Step
              </button>

              <button
                type="button"
                onClick={() => {
                  setSimStepIndex(0);
                  setSimProgress(0);
                }}
                className="btn-heritage-secondary"
                style={{ padding: '4px 8px', fontSize: '0.8rem', minHeight: 28 }}
                title="Reset to home"
              >
                🔄 Reset
              </button>

              {/* Speed Multiplier */}
              <div style={{ display: 'inline-flex', gap: 2, marginLeft: 4 }}>
                {[1, 2, 4].map((spd) => (
                  <button
                    key={spd}
                    type="button"
                    onClick={() => setSpeedMultiplier(spd)}
                    style={{
                      border: 'none',
                      padding: '2px 6px',
                      borderRadius: 3,
                      fontSize: '0.72rem',
                      fontWeight: speedMultiplier === spd ? 700 : 500,
                      background: speedMultiplier === spd ? 'var(--primary)' : 'transparent',
                      color: speedMultiplier === spd ? '#fff' : 'var(--on-surface-variant)',
                      cursor: 'pointer',
                    }}
                  >
                    {spd}x
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Task Quick Selector (In Live mode) */}
          {mode === 'live' && tasks.length > 0 && (
            <select
              value={activeTask?.id || ''}
              onChange={(e) => {
                const found = tasks.find((t) => t.id === e.target.value);
                if (found && onSelectTask) onSelectTask(found);
              }}
              style={{
                fontSize: '0.8rem',
                padding: '6px 10px',
                borderRadius: 4,
                border: '1px solid var(--outline-variant)',
                background: 'var(--surface)',
                color: 'var(--on-surface)',
                maxWidth: 220,
              }}
            >
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.status.toUpperCase()}: {t.title.slice(0, 24)}...
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* SVG Canvas Stage */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          borderRadius: 8,
          border: '1px solid var(--outline-variant)',
          background: '#f8efe3',
          backgroundImage: `
            radial-gradient(circle at 50% 10%, rgba(228, 194, 137, 0.25) 0%, transparent 60%),
            linear-gradient(to bottom, #faf4ec 0%, #f3e6d3 100%)
          `,
          boxShadow: 'inset 0 2px 10px rgba(35, 26, 15, 0.05)',
        }}
      >
        <svg
          viewBox="0 0 1020 540"
          style={{ width: '100%', height: 'auto', display: 'block' }}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            {/* Gradients */}
            <linearGradient id="pathGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#d1c5b6" stopOpacity="0.8" />
              <stop offset="50%" stopColor="#8b6f3e" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#d1c5b6" stopOpacity="0.8" />
            </linearGradient>

            <linearGradient id="activePathGlow" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#8b6f3e" />
              <stop offset="100%" stopColor="#705728" />
            </linearGradient>

            <linearGradient id="roofCottage" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#8b6f3e" />
              <stop offset="100%" stopColor="#5a4316" />
            </linearGradient>

            <linearGradient id="stoneWall" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#fff8f4" />
              <stop offset="100%" stopColor="#ede1c8" />
            </linearGradient>

            <radialGradient id="lampGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffdea9" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#e4c289" stopOpacity="0" />
            </radialGradient>

            <filter id="shadowFilter" x="-10%" y="-10%" width="120%" height="120%">
              <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#231a0f" floodOpacity="0.12" />
            </filter>

            <filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Background Decorative Campus Features */}
          {/* Garden Lawns & Rolling Courtyards */}
          <ellipse cx="220" cy="270" rx="140" ry="60" fill="#e9e0cb" opacity="0.45" />
          <ellipse cx="620" cy="240" rx="170" ry="70" fill="#e9e0cb" opacity="0.45" />
          <ellipse cx="510" cy="450" rx="360" ry="60" fill="#e2d6be" opacity="0.35" />

          {/* Campus Decorative Trees */}
          {[
            { cx: 70, cy: 260, r: 18 },
            { cx: 220, cy: 110, r: 16 },
            { cx: 430, cy: 200, r: 20 },
            { cx: 620, cy: 120, r: 18 },
            { cx: 820, cy: 220, r: 16 },
            { cx: 960, cy: 260, r: 22 },
          ].map((tree, idx) => (
            <g key={`tree-${idx}`} opacity="0.65">
              <ellipse cx={tree.cx} cy={tree.cy + tree.r} rx={tree.r * 0.8} ry={5} fill="#cec6b3" />
              <circle cx={tree.cx} cy={tree.cy} r={tree.r} fill="#625a46" opacity="0.3" />
              <circle cx={tree.cx - 2} cy={tree.cy - 3} r={tree.r * 0.8} fill="#7b735d" opacity="0.4" />
            </g>
          ))}

          {/* Cobblestone Paved Paths Connecting the 5 Landmarks */}
          {/* Path 1: Home (120, 330) -> Academy (320, 170) */}
          <path
            d="M 120 375 C 180 375, 240 215, 320 215"
            fill="none"
            stroke="#d5c7b3"
            strokeWidth="18"
            strokeLinecap="round"
          />
          <path
            d="M 120 375 C 180 375, 240 215, 320 215"
            fill="none"
            stroke="#f5ebe0"
            strokeWidth="12"
            strokeLinecap="round"
          />

          {/* Path 2: Academy (320, 170) -> PC Foundry (520, 340) */}
          <path
            d="M 320 215 C 400 215, 440 385, 520 385"
            fill="none"
            stroke="#d5c7b3"
            strokeWidth="18"
            strokeLinecap="round"
          />
          <path
            d="M 320 215 C 400 215, 440 385, 520 385"
            fill="none"
            stroke="#f5ebe0"
            strokeWidth="12"
            strokeLinecap="round"
          />

          {/* Path 3: PC Foundry (520, 340) -> QA Observatory (720, 170) */}
          <path
            d="M 520 385 C 600 385, 640 215, 720 215"
            fill="none"
            stroke="#d5c7b3"
            strokeWidth="18"
            strokeLinecap="round"
          />
          <path
            d="M 520 385 C 600 385, 640 215, 720 215"
            fill="none"
            stroke="#f5ebe0"
            strokeWidth="12"
            strokeLinecap="round"
          />

          {/* Path 4: QA Observatory (720, 170) -> Shipping Port (900, 330) */}
          <path
            d="M 720 215 C 800 215, 840 375, 900 375"
            fill="none"
            stroke="#d5c7b3"
            strokeWidth="18"
            strokeLinecap="round"
          />
          <path
            d="M 720 215 C 800 215, 840 375, 900 375"
            fill="none"
            stroke="#f5ebe0"
            strokeWidth="12"
            strokeLinecap="round"
          />

          {/* Path 5 (Return Road): Shipping Port (900, 330) -> Home Base (120, 330) via Scenic Lower Loop */}
          <path
            d="M 900 375 C 800 505, 220 505, 120 375"
            fill="none"
            stroke="#d5c7b3"
            strokeWidth="18"
            strokeLinecap="round"
          />
          <path
            d="M 900 375 C 800 505, 220 505, 120 375"
            fill="none"
            stroke="#f5ebe0"
            strokeWidth="12"
            strokeLinecap="round"
          />

          {/* Animated Waypoint Dash Line on active segment */}
          <path
            d="M 120 375 C 180 375, 240 215, 320 215 C 400 215, 440 385, 520 385 C 600 385, 640 215, 720 215 C 800 215, 840 375, 900 375 C 800 505, 220 505, 120 375"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="2.5"
            className="waypoint-active-path"
            opacity="0.75"
          />

          {/* ─────────────────────────────────────────────────────────────
              5 ARCHITECTURAL LANDMARKS
              ───────────────────────────────────────────────────────────── */}

          {/* 1. TELEGRAM BASE & HOME (x: 120, y: 330) */}
          <g
            transform="translate(120, 330)"
            filter="url(#shadowFilter)"
            style={{ cursor: 'pointer' }}
            onClick={() => setActiveLandmarkDetail(LANDMARKS[0])}
          >
            {/* Active Glow Aura */}
            {activeLandmarkId === 'home' && (
              <circle cx="0" cy="10" r="68" fill="#e4c289" opacity="0.3" className="landmark-active-aura" />
            )}
            {/* Shadow */}
            <ellipse cx="0" cy="40" rx="46" ry="12" fill="#231a0f" opacity="0.16" />
            {/* Cottage Base Walls */}
            <rect x="-38" y="-12" width="76" height="50" rx="3" fill="url(#stoneWall)" stroke="#7f7669" strokeWidth="1.5" />
            {/* Cozy Stone Foundation */}
            <rect x="-40" y="30" width="80" height="8" rx="2" fill="#d1c5b6" />
            {/* Roof */}
            <polygon points="-48,-12 0,-50 48,-12" fill="url(#roofCottage)" stroke="#5a4316" strokeWidth="1.5" />
            {/* Chimney */}
            <rect x="22" y="-45" width="12" height="22" fill="#8b6f3e" stroke="#5a4316" strokeWidth="1" />
            <ellipse cx="28" cy="-45" rx="6" ry="2" fill="#5a4316" />
            {/* Front Door */}
            <rect x="-10" y="10" width="20" height="28" rx="2" fill="#705728" stroke="#392f23" strokeWidth="1" />
            <circle cx="6" cy="24" r="1.5" fill="#ffdea9" />
            {/* Windows with warm light */}
            <rect x="-30" y="4" width="14" height="14" rx="2" fill="#ffeaa7" stroke="#8b6f3e" strokeWidth="1" />
            <line x1="-23" y1="4" x2="-23" y2="18" stroke="#8b6f3e" strokeWidth="0.8" />
            <line x1="-30" y1="11" x2="-16" y2="11" stroke="#8b6f3e" strokeWidth="0.8" />
            <rect x="16" y="4" width="14" height="14" rx="2" fill="#ffeaa7" stroke="#8b6f3e" strokeWidth="1" />
            <line x1="23" y1="4" x2="23" y2="18" stroke="#8b6f3e" strokeWidth="0.8" />
            {/* Porch Lantern */}
            <circle cx="-16" cy="16" r="3" fill="#ffd166" />
            <circle cx="-16" cy="16" r="8" fill="url(#lampGlow)" />
            {/* Telegram Crest Banner */}
            <circle cx="0" cy="-24" r="10" fill="#229ed9" />
            <path d="M -5 -24 L 5 -27 L 1 -21 L -1 -22 Z" fill="#fff" />
            {/* Label Card */}
            <rect x="-56" y="46" width="112" height="22" rx="4" fill="#fff8f4" stroke="#d1c5b6" strokeWidth="1" />
            <text x="0" y="60" textAnchor="middle" fontSize="10" fontWeight="700" fill="#231a0f" fontFamily="'Noto Serif', serif">
              1. Telegram Base
            </text>
          </g>

          {/* 2. THE THINKER & STRATEGY ACADEMY (x: 320, y: 170) */}
          <g
            transform="translate(320, 170)"
            filter="url(#shadowFilter)"
            style={{ cursor: 'pointer' }}
            onClick={() => setActiveLandmarkDetail(LANDMARKS[1])}
          >
            {activeLandmarkId === 'academy' && (
              <circle cx="0" cy="15" r="72" fill="#e4c289" opacity="0.3" className="landmark-active-aura" />
            )}
            <ellipse cx="0" cy="46" rx="54" ry="14" fill="#231a0f" opacity="0.16" />
            {/* Neoclassical Academy Library */}
            <rect x="-46" y="-10" width="92" height="52" rx="3" fill="url(#stoneWall)" stroke="#7f7669" strokeWidth="1.5" />
            {/* Marble Columns */}
            {[-34, -12, 10, 32].map((colX) => (
              <g key={`col-${colX}`}>
                <rect x={colX} y="-10" width="6" height="52" fill="#fffaf5" stroke="#d1c5b6" strokeWidth="0.8" />
                <rect x={colX - 2} y="-13" width="10" height="3" fill="#d1c5b6" />
                <rect x={colX - 2} y="39" width="10" height="3" fill="#d1c5b6" />
              </g>
            ))}
            {/* Pediment & Triangular Roof */}
            <polygon points="-52,-12 0,-54 52,-12" fill="#8b6f3e" stroke="#5a4316" strokeWidth="1.5" />
            {/* Pediment Inner Inset */}
            <polygon points="-40,-16 0,-46 40,-16" fill="#fdebd9" />
            {/* Owl / Thinking Constellation Emblem */}
            <circle cx="0" cy="-28" r="8" fill="#705728" />
            <polygon points="0,-33 3,-27 8,-26 4,-22 5,-17 0,-20 -5,-17 -4,-22 -8,-26 -3,-27" fill="#ffdea9" />
            {/* Archway Entrance */}
            <path d="M -12 42 L -12 16 A 12 12 0 0 1 12 16 L 12 42 Z" fill="#392f23" />
            {/* Label Card */}
            <rect x="-62" y="52" width="124" height="22" rx="4" fill="#fff8f4" stroke="#d1c5b6" strokeWidth="1" />
            <text x="0" y="66" textAnchor="middle" fontSize="10" fontWeight="700" fill="#231a0f" fontFamily="'Noto Serif', serif">
              2. Thinker Academy
            </text>
          </g>

          {/* 3. NISARG'S PC FOUNDRY & CODER WORKSHOP (x: 520, y: 340) */}
          <g
            transform="translate(520, 340)"
            filter="url(#shadowFilter)"
            style={{ cursor: 'pointer' }}
            onClick={() => setActiveLandmarkDetail(LANDMARKS[2])}
          >
            {activeLandmarkId === 'foundry' && (
              <circle cx="0" cy="15" r="74" fill="#8b6f3e" opacity="0.3" className="landmark-active-aura" />
            )}
            <ellipse cx="0" cy="46" rx="58" ry="14" fill="#231a0f" opacity="0.18" />
            {/* High-Tech Industrial Workshop */}
            <rect x="-48" y="-15" width="96" height="58" rx="4" fill="#f1e0ce" stroke="#705728" strokeWidth="1.5" />
            {/* Steel Frame Roof & Exhaust Vent */}
            <polygon points="-52,-15 -42,-44 42,-44 52,-15" fill="#705728" stroke="#392f23" strokeWidth="1.5" />
            <rect x="-10" y="-52" width="20" height="8" rx="2" fill="#5a4316" />
            <line x1="-6" y1="-44" x2="-6" y2="-52" stroke="#d1c5b6" strokeWidth="1" />
            <line x1="6" y1="-44" x2="6" y2="-52" stroke="#d1c5b6" strokeWidth="1" />
            {/* Dual Glowing Monitor Screens */}
            <rect x="-38" y="-4" width="34" height="24" rx="2" fill="#1e1e1e" stroke="#7f7669" strokeWidth="1" />
            <rect x="-35" y="-1" width="28" height="18" fill="#0d1117" />
            {/* Code Lines on Screen */}
            <line x1="-32" y1="3" x2="-14" y2="3" stroke="#58a6ff" strokeWidth="1.2" />
            <line x1="-32" y1="7" x2="-18" y2="7" stroke="#7ee787" strokeWidth="1.2" />
            <line x1="-32" y1="11" x2="-22" y2="11" stroke="#ff7b72" strokeWidth="1.2" />
            <rect x="-20" y="10" width="3" height="3" fill="#fff" className="terminal-cursor" />
            {/* Second Monitor */}
            <rect x="4" y="-4" width="34" height="24" rx="2" fill="#1e1e1e" stroke="#7f7669" strokeWidth="1" />
            <rect x="7" y="-1" width="28" height="18" fill="#0d1117" />
            {/* PPTX Presentation Preview Graphic */}
            <rect x="10" y="2" width="10" height="8" fill="#d24726" rx="1" />
            <text x="15" y="8" textAnchor="middle" fontSize="6" fill="#fff" fontWeight="700">P</text>
            <line x1="10" y1="13" x2="30" y2="13" stroke="#e4c289" strokeWidth="1" />
            {/* Antigravity CLI Forge Anvil */}
            <rect x="-12" y="24" width="24" height="16" rx="2" fill="#705728" />
            <polygon points="-8,24 0,18 8,24" fill="#e4c289" />
            {/* Label Card */}
            <rect x="-64" y="52" width="128" height="22" rx="4" fill="#fff8f4" stroke="#d1c5b6" strokeWidth="1" />
            <text x="0" y="66" textAnchor="middle" fontSize="10" fontWeight="700" fill="#231a0f" fontFamily="'Noto Serif', serif">
              3. Nisarg's PC Foundry
            </text>
          </g>

          {/* 4. THE QA & VERIFICATION GATE (x: 720, y: 170) */}
          <g
            transform="translate(720, 170)"
            filter="url(#shadowFilter)"
            style={{ cursor: 'pointer' }}
            onClick={() => setActiveLandmarkDetail(LANDMARKS[3])}
          >
            {activeLandmarkId === 'qa' && (
              <circle cx="0" cy="15" r="70" fill="#276a3c" opacity="0.25" className="landmark-active-aura" />
            )}
            <ellipse cx="0" cy="46" rx="52" ry="14" fill="#231a0f" opacity="0.16" />
            {/* Verification Observatory Tower */}
            <rect x="-42" y="-10" width="84" height="52" rx="4" fill="url(#stoneWall)" stroke="#7f7669" strokeWidth="1.5" />
            {/* Observatory Dome */}
            <path d="M -32 -10 A 32 32 0 0 1 32 -10 Z" fill="#625a46" stroke="#392f23" strokeWidth="1.5" />
            <rect x="-6" y="-42" width="12" height="12" fill="#7b735d" />
            {/* Magnifying Inspection Glass */}
            <circle cx="0" cy="8" r="14" fill="#e2f0d9" stroke="#276a3c" strokeWidth="2" opacity="0.85" />
            <path d="M -5 8 L -1 12 L 7 4" fill="none" stroke="#276a3c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            {/* Rubric Checklist Boards */}
            <rect x="-34" y="4" width="12" height="18" rx="1" fill="#fff" stroke="#d1c5b6" strokeWidth="0.8" />
            <line x1="-31" y1="8" x2="-25" y2="8" stroke="#276a3c" strokeWidth="1" />
            <line x1="-31" y1="12" x2="-25" y2="12" stroke="#276a3c" strokeWidth="1" />
            <line x1="-31" y1="16" x2="-25" y2="16" stroke="#276a3c" strokeWidth="1" />
            {/* Slide Count Counter Badge */}
            <rect x="22" y="4" width="14" height="18" rx="2" fill="#fdebd9" stroke="#8b6f3e" strokeWidth="1" />
            <text x="29" y="16" textAnchor="middle" fontSize="9" fontWeight="700" fill="#705728">
              17
            </text>
            {/* Label Card */}
            <rect x="-58" y="52" width="116" height="22" rx="4" fill="#fff8f4" stroke="#d1c5b6" strokeWidth="1" />
            <text x="0" y="66" textAnchor="middle" fontSize="10" fontWeight="700" fill="#231a0f" fontFamily="'Noto Serif', serif">
              4. QA Inspection Gate
            </text>
          </g>

          {/* 5. SHIPPING STATION & GOOGLE DRIVE DOCK (x: 900, y: 330) */}
          <g
            transform="translate(900, 330)"
            filter="url(#shadowFilter)"
            style={{ cursor: 'pointer' }}
            onClick={() => setActiveLandmarkDetail(LANDMARKS[4])}
          >
            {activeLandmarkId === 'shipping' && (
              <circle cx="0" cy="15" r="74" fill="#4285f4" opacity="0.25" className="landmark-active-aura" />
            )}
            <ellipse cx="0" cy="46" rx="54" ry="14" fill="#231a0f" opacity="0.16" />
            {/* Airship Dispatch Port */}
            <rect x="-44" y="-12" width="88" height="54" rx="4" fill="url(#stoneWall)" stroke="#705728" strokeWidth="1.5" />
            {/* Cloud Airship Tower Arch */}
            <polygon points="-48,-12 0,-48 48,-12" fill="#705728" stroke="#392f23" strokeWidth="1.5" />
            {/* Cloud Crane & Signal Tower */}
            <line x1="0" y1="-48" x2="0" y2="-72" stroke="#5a4316" strokeWidth="2.5" />
            <circle cx="0" cy="-74" r="5" fill="#ffd166" />
            <circle cx="0" cy="-74" r="12" fill="url(#lampGlow)" />
            {/* Signal Waves */}
            <circle cx="0" cy="-74" r="18" fill="none" stroke="#e4c289" strokeWidth="1" opacity="0.6" strokeDasharray="3 3" />
            {/* Google Drive Logo Plaque */}
            <g transform="translate(0, 10) scale(0.7)">
              <polygon points="0,-18 16,10 8,10 -4,-11" fill="#4285f4" />
              <polygon points="0,-18 -16,10 -8,10 4,-11" fill="#0f9d58" />
              <polygon points="-12,10 12,10 18,2 -6,2" fill="#f4b400" />
            </g>
            {/* Package Crates ready for delivery */}
            <rect x="-36" y="24" width="14" height="14" rx="1" fill="#d1c5b6" stroke="#7f7669" strokeWidth="1" />
            <line x1="-36" y1="31" x2="-22" y2="31" stroke="#8b6f3e" strokeWidth="1" />
            <rect x="22" y="24" width="14" height="14" rx="1" fill="#d1c5b6" stroke="#7f7669" strokeWidth="1" />
            <line x1="22" y1="31" x2="36" y2="31" stroke="#8b6f3e" strokeWidth="1" />
            {/* Label Card */}
            <rect x="-60" y="52" width="120" height="22" rx="4" fill="#fff8f4" stroke="#d1c5b6" strokeWidth="1" />
            <text x="0" y="66" textAnchor="middle" fontSize="10" fontWeight="700" fill="#231a0f" fontFamily="'Noto Serif', serif">
              5. Shipping Station
            </text>
          </g>

          {/* ─────────────────────────────────────────────────────────────
              THE SCHOLAR AGENT AVATAR ("VICARIUS")
              ───────────────────────────────────────────────────────────── */}
          <g
            transform={`translate(${agentPos.x}, ${agentPos.y})`}
            filter="url(#shadowFilter)"
          >
            {/* Walking Dust Particles when moving */}
            {agentPos.isMoving && (
              <g opacity="0.65">
                <circle cx={agentPos.facingLeft ? 18 : -18} cy="8" r="3" fill="#d1c5b6" />
                <circle cx={agentPos.facingLeft ? 24 : -24} cy="6" r="2" fill="#d1c5b6" />
              </g>
            )}

            {/* Avatar Shadow */}
            <ellipse cx="0" cy="12" rx="14" ry="4" fill="#231a0f" opacity="0.28" />

            {/* Character Group with Horizontal Flip if facing left */}
            <g
              transform={agentPos.facingLeft ? 'scale(-1, 1)' : 'scale(1, 1)'}
              className={agentPos.isMoving ? 'agent-walking' : 'agent-idle'}
            >
              {/* Stepping Legs */}
              <g>
                <line
                  x1="-4"
                  y1="2"
                  x2="-5"
                  y2="10"
                  stroke="#392f23"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                />
                <rect x="-7" y="9" width="5" height="3" rx="1" fill="#231a0f" />
                <line
                  x1="4"
                  y1="2"
                  x2="5"
                  y2="10"
                  stroke="#392f23"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                />
                <rect x="3" y="9" width="5" height="3" rx="1" fill="#231a0f" />
              </g>

              {/* Scholar Overcoat Body */}
              <path
                d="M -10 -14 L -12 2 L 12 2 L 10 -14 Z"
                fill="#705728"
                stroke="#392f23"
                strokeWidth="1"
              />

              {/* Satchel / Briefcase */}
              <rect
                x="6"
                y="-8"
                width="8"
                height="10"
                rx="1"
                fill="#8b6f3e"
                stroke="#5a4316"
                strokeWidth="1"
              />
              <line x1="6" y1="-4" x2="14" y2="-4" stroke="#ffdea9" strokeWidth="0.8" />
              {/* Satchel Strap */}
              <line x1="-8" y1="-14" x2="6" y2="-4" stroke="#5a4316" strokeWidth="1.2" />

              {/* White Academic Collar */}
              <polygon points="-4,-14 0,-9 4,-14" fill="#fff" />
              <polygon points="-2,-11 0,-6 2,-11" fill="#ba1a1a" />

              {/* Head & Hair */}
              <circle cx="0" cy="-20" r="7" fill="#fcd7b6" />
              {/* Glasses */}
              <rect x="-4" y="-22" width="3.5" height="3" rx="0.5" fill="none" stroke="#392f23" strokeWidth="0.8" />
              <rect x="0.5" y="-22" width="3.5" height="3" rx="0.5" fill="none" stroke="#392f23" strokeWidth="0.8" />
              <line x1="-0.5" y1="-21" x2="0.5" y2="-21" stroke="#392f23" strokeWidth="0.8" />
              {/* Scholar Cap / Hair */}
              <path d="M -7 -22 C -7 -28, 7 -28, 7 -22 Z" fill="#392f23" />
              <polygon points="-9,-25 0,-30 9,-25 0,-21" fill="#231a0f" />
              <circle cx="0" cy="-30" r="1.5" fill="#e4c289" />
              <line x1="0" y1="-30" x2="7" y2="-25" stroke="#e4c289" strokeWidth="0.8" />
            </g>

            {/* Real-time Thought Bubble HUD above Vicarius */}
            <g transform="translate(0, -48)" className="agent-thought-bubble">
              {/* Bubble Tail */}
              <polygon points="-4,0 0,6 4,0" fill="#fff8f4" stroke="#d1c5b6" strokeWidth="1" />
              <line x1="-3" y1="0" x2="3" y2="0" stroke="#fff8f4" strokeWidth="2" />
              {/* Bubble Box */}
              <rect
                x="-110"
                y="-32"
                width="220"
                height="32"
                rx="6"
                fill="#fff8f4"
                stroke="#8b6f3e"
                strokeWidth="1.2"
                filter="url(#shadowFilter)"
              />
              <circle cx="-94" cy="-16" r="6" fill="#705728" />
              <text x="-94" y="-13" textAnchor="middle" fontSize="8" fill="#fff" fontWeight="700">
                V
              </text>
              <text
                x="-82"
                y="-13"
                fontSize="9.5"
                fontWeight="700"
                fill="#231a0f"
                fontFamily="'Manrope', sans-serif"
              >
                {currentAction.length > 28 ? currentAction.slice(0, 26) + '...' : currentAction}
              </text>
            </g>
          </g>
        </svg>
      </div>

      {/* Realtime Action & Thought Broadcast Strip */}
      <div
        style={{
          marginTop: 16,
          background: 'var(--surface-container-low)',
          border: '1px solid var(--outline-variant)',
          borderRadius: 8,
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 280 }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: '50%',
              background: 'var(--primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: '1rem',
              flexShrink: 0,
              boxShadow: '0 2px 6px rgba(112, 87, 40, 0.25)',
            }}
          >
            🎓
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  fontSize: '0.9rem',
                  fontWeight: 700,
                  color: 'var(--on-surface)',
                  fontFamily: "'Noto Serif', serif",
                }}
              >
                Vicarius: {currentAction}
              </span>
              <span
                style={{
                  fontSize: '10px',
                  padding: '1px 6px',
                  borderRadius: 10,
                  background: 'var(--surface-container-high)',
                  color: 'var(--primary)',
                  fontWeight: 600,
                }}
              >
                {agentPos.isMoving ? 'In Transit 🚶' : 'At Station 📍'}
              </span>
            </div>
            <p
              style={{
                fontSize: '0.82rem',
                color: 'var(--on-surface-variant)',
                margin: 0,
                fontStyle: 'italic',
              }}
            >
              &ldquo;{currentThought}&rdquo;
            </p>
          </div>
        </div>

        {/* Landmark Info Trigger */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {LANDMARKS.map((lm, idx) => (
            <button
              key={lm.id}
              type="button"
              onClick={() => setActiveLandmarkDetail(lm)}
              style={{
                fontSize: '0.76rem',
                padding: '4px 8px',
                borderRadius: 4,
                border: '1px solid var(--outline-variant)',
                background: activeLandmarkId === lm.id ? 'var(--primary)' : 'var(--surface)',
                color: activeLandmarkId === lm.id ? '#fff' : 'var(--on-surface-variant)',
                cursor: 'pointer',
                fontWeight: activeLandmarkId === lm.id ? 700 : 500,
                transition: 'all 0.15s ease',
              }}
            >
              {idx + 1}. {lm.name.split(' ')[0]}
            </button>
          ))}
        </div>
      </div>

      {/* Landmark Detail Modal / Drawer (when landmark clicked) */}
      {activeLandmarkDetail && (
        <div
          style={{
            marginTop: 16,
            background: 'var(--surface)',
            border: '1px solid var(--outline)',
            borderRadius: 8,
            padding: '16px 20px',
            boxShadow: 'var(--shadow-modal)',
            animation: 'fadeIn 0.2s ease',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              marginBottom: 10,
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: '1.2rem' }}>
                  {activeLandmarkDetail.iconType === 'home'
                    ? '🏠'
                    : activeLandmarkDetail.iconType === 'academy'
                    ? '🏛️'
                    : activeLandmarkDetail.iconType === 'foundry'
                    ? '⚙️'
                    : activeLandmarkDetail.iconType === 'qa'
                    ? '🔍'
                    : '🚀'}
                </span>
                <h4
                  className="heading-h4"
                  style={{
                    fontFamily: "'Noto Serif', serif",
                    margin: 0,
                    color: 'var(--on-surface)',
                  }}
                >
                  {activeLandmarkDetail.name}
                </h4>
                <span
                  style={{
                    fontSize: '11px',
                    padding: '2px 8px',
                    borderRadius: 10,
                    background: 'var(--surface-container)',
                    color: 'var(--primary)',
                    fontWeight: 600,
                  }}
                >
                  {activeLandmarkDetail.stageName}
                </span>
              </div>
              <p style={{ fontSize: '0.84rem', color: 'var(--on-surface-variant)', margin: '4px 0 0 0' }}>
                {activeLandmarkDetail.description}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setActiveLandmarkDetail(null)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--on-surface-variant)',
                cursor: 'pointer',
                fontSize: '1.2rem',
                lineHeight: 1,
                padding: 4,
              }}
            >
              ✕
            </button>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 12,
              marginTop: 12,
              paddingTop: 12,
              borderTop: '1px solid var(--outline-variant)',
            }}
          >
            <div>
              <span
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: 'var(--primary)',
                  display: 'block',
                  marginBottom: 6,
                }}
              >
                LangGraph StateGraph Nodes
              </span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {activeLandmarkDetail.langGraphNodes.map((node) => (
                  <span
                    key={node}
                    style={{
                      fontSize: '0.78rem',
                      fontFamily: 'monospace',
                      background: 'var(--surface-container-high)',
                      padding: '2px 8px',
                      borderRadius: 4,
                      color: 'var(--on-surface)',
                      border: '1px solid var(--outline-variant)',
                    }}
                  >
                    {node}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <span
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: 'var(--primary)',
                  display: 'block',
                  marginBottom: 6,
                }}
              >
                Local Tools & Engine APIs
              </span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {activeLandmarkDetail.toolsUsed.map((tool) => (
                  <span
                    key={tool}
                    style={{
                      fontSize: '0.78rem',
                      background: '#fff',
                      padding: '2px 8px',
                      borderRadius: 4,
                      color: 'var(--on-surface)',
                      border: '1px solid var(--outline-variant)',
                    }}
                  >
                    {tool}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
