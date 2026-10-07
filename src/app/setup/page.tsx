'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { VicariusLogo } from '@/components/VicariusLogo';
import {
  CheckCircleIcon,
  AlertCircleIcon,
  LoaderIcon,
  UserIcon,
  ClassroomIcon,
  SparklesIcon,
} from '@/components/Icons';

interface SetupStatus {
  user: { id: string; email: string; name: string };
  profile: any;
  connections: {
    database: boolean;
    google: boolean;
    llm: boolean;
    groq: boolean;
    gemini: boolean;
    openrouter: boolean;
    telegramBot: boolean;
    telegramLinked: boolean;
  };
  telegramLinkCode: string;
  setupCompleted: boolean;
}

export default function SetupPage() {
  const router = useRouter();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [status, setStatus] = useState<SetupStatus | null>(null);

  // Form Fields
  const [fullName, setFullName] = useState('');
  const [preferredName, setPreferredName] = useState('');
  const [university, setUniversity] = useState('');
  const [program, setProgram] = useState('');
  const [currentSemester, setCurrentSemester] = useState('Semester 1');
  const [enrollmentNo, setEnrollmentNo] = useState('');
  const [defaultCitationStyle, setDefaultCitationStyle] = useState('IEEE');
  const [manualTelegramId, setManualTelegramId] = useState('');
  const [copied, setCopied] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/setup/status');
      if (res.status === 401) {
        router.replace('/login');
        return;
      }
      const json = await res.json();
      if (json.success && json.data) {
        setStatus(json.data);
        const p = json.data.profile;
        if (p) {
          if (p.full_name) setFullName(p.full_name);
          if (p.preferred_name) setPreferredName(p.preferred_name);
          if (p.university) setUniversity(p.university);
          if (p.program) setProgram(p.program);
          if (p.current_semester) setCurrentSemester(p.current_semester);
          if (p.enrollment_no) setEnrollmentNo(p.enrollment_no);
          if (p.default_citation_style) setDefaultCitationStyle(p.default_citation_style);
          if (p.telegram_id) setManualTelegramId(p.telegram_id);
        } else if (json.data.user?.name) {
          setFullName(json.data.user.name);
        }
      }
    } catch (err: any) {
      console.error('Error fetching setup status:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  // Poll connection status during Step 2 & Step 3 to auto-detect Telegram linking
  useEffect(() => {
    if (step >= 2) {
      const interval = setInterval(fetchStatus, 4000);
      return () => clearInterval(interval);
    }
  }, [step]);

  const handleSaveStep1 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !university.trim() || !program.trim()) {
      setErrorMsg('Please enter your full name, university, and academic program.');
      return;
    }

    setErrorMsg(null);
    setSaving(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName.trim(),
          preferred_name: preferredName.trim() || undefined,
          university: university.trim(),
          program: program.trim(),
          current_semester: currentSemester.trim(),
          enrollment_no: enrollmentNo.trim() || undefined,
          default_citation_style: defaultCitationStyle,
          setup_completed: false,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || 'Failed to save profile details');
      }
      setStep(2);
    } catch (err: any) {
      setErrorMsg(err.message || 'An error occurred saving your details.');
    } finally {
      setSaving(false);
    }
  };

  const handleFinishSetup = async () => {
    setErrorMsg(null);
    setSaving(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName.trim() || 'Student',
          university: university.trim() || 'Academic Institution',
          program: program.trim() || 'Undergraduate Degree',
          current_semester: currentSemester.trim() || 'Semester 1',
          enrollment_no: enrollmentNo.trim() || undefined,
          default_citation_style: defaultCitationStyle,
          telegram_id: manualTelegramId.trim() || undefined,
          setup_completed: true,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || 'Failed to finalize setup');
      }
      router.push('/');
      router.refresh();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to finalize workspace setup.');
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: 'var(--surface, #fff8f4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: "'Manrope', sans-serif",
          color: 'var(--primary, #705728)',
        }}
      >
        <LoaderIcon size={32} className="animate-spin" />
      </div>
    );
  }

  const linkCode = status?.telegramLinkCode || 'link_code';
  const telegramCommand = `/start link_${linkCode}`;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--surface, #fff8f4)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '3rem 1.5rem',
        fontFamily: "'Manrope', sans-serif",
        color: 'var(--on-surface, #231a0f)',
      }}
    >
      <div style={{ width: '100%', maxWidth: '640px' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
            <VicariusLogo />
          </div>
          <h1
            style={{
              fontFamily: "'Noto Serif', serif",
              fontSize: '2rem',
              fontWeight: 700,
              color: 'var(--primary, #705728)',
              margin: '0 0 0.5rem 0',
              letterSpacing: '-0.02em',
            }}
          >
            Welcome to Vicarius
          </h1>
          <p
            style={{
              fontSize: '0.95rem',
              color: 'var(--on-surface-variant, #4d463a)',
              margin: 0,
            }}
          >
            Configure your academic profile & link autonomous services in 3 simple steps
          </p>

          {/* Stepper Indicator */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '1rem',
              marginTop: '1.75rem',
            }}
          >
            {[
              { num: 1, label: 'Academic Identity' },
              { num: 2, label: 'Connections' },
              { num: 3, label: 'Telegram Link' },
            ].map((s, idx) => {
              const active = step === s.num;
              const completed = step > s.num;
              return (
                <div key={s.num} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      background: completed
                        ? '#2e7d32'
                        : active
                        ? 'var(--primary, #705728)'
                        : 'var(--outline-variant, #d1c5b6)',
                      color: completed || active ? '#ffffff' : 'var(--on-surface-variant, #4d463a)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      transition: 'all 0.2s ease',
                    }}
                  >
                    {completed ? '✓' : s.num}
                  </div>
                  <span
                    style={{
                      fontSize: '0.85rem',
                      fontWeight: active ? 700 : 500,
                      color: active ? 'var(--primary, #705728)' : 'var(--on-surface-variant, #4d463a)',
                    }}
                  >
                    {s.label}
                  </span>
                  {idx < 2 && (
                    <div
                      style={{
                        width: '32px',
                        height: '2px',
                        background: completed ? '#2e7d32' : 'var(--outline-variant, #d1c5b6)',
                        margin: '0 0.25rem',
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Card Container */}
        <div
          style={{
            background: '#ffffff',
            borderRadius: '1.25rem',
            border: '1px solid var(--outline-variant, #d1c5b6)',
            boxShadow: '0 8px 32px rgba(112, 87, 40, 0.06)',
            padding: '2.25rem',
          }}
        >
          {errorMsg && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.875rem 1rem',
                borderRadius: '0.75rem',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: 'var(--error, #ba1a1a)',
                fontSize: '0.875rem',
                marginBottom: '1.75rem',
              }}
            >
              <AlertCircleIcon size={18} />
              <div>{errorMsg}</div>
            </div>
          )}

          {/* STEP 1: Academic Identity */}
          {step === 1 && (
            <form onSubmit={handleSaveStep1}>
              <div style={{ marginBottom: '1.5rem' }}>
                <h2
                  style={{
                    fontFamily: "'Noto Serif', serif",
                    fontSize: '1.35rem',
                    fontWeight: 700,
                    margin: '0 0 0.35rem 0',
                    color: 'var(--primary, #705728)',
                  }}
                >
                  Step 1: Your Academic Details
                </h2>
                <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--on-surface-variant, #4d463a)' }}>
                  This personalizes AI drafts, citation formats, and deliverables.
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                    Full Legal Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Alex Johnson"
                    style={{
                      width: '100%',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '0.5rem',
                      border: '1px solid var(--outline-variant, #d1c5b6)',
                      fontSize: '0.9rem',
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                    Preferred First Name
                  </label>
                  <input
                    type="text"
                    value={preferredName}
                    onChange={(e) => setPreferredName(e.target.value)}
                    placeholder="e.g. Alex"
                    style={{
                      width: '100%',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '0.5rem',
                      border: '1px solid var(--outline-variant, #d1c5b6)',
                      fontSize: '0.9rem',
                    }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                  University / College *
                </label>
                <input
                  type="text"
                  required
                  value={university}
                  onChange={(e) => setUniversity(e.target.value)}
                  placeholder="e.g. Stanford University"
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.85rem',
                    borderRadius: '0.5rem',
                    border: '1px solid var(--outline-variant, #d1c5b6)',
                    fontSize: '0.9rem',
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                    Program / Major *
                  </label>
                  <input
                    type="text"
                    required
                    value={program}
                    onChange={(e) => setProgram(e.target.value)}
                    placeholder="e.g. B.S. Computer Science"
                    style={{
                      width: '100%',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '0.5rem',
                      border: '1px solid var(--outline-variant, #d1c5b6)',
                      fontSize: '0.9rem',
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                    Current Semester / Year
                  </label>
                  <input
                    type="text"
                    value={currentSemester}
                    onChange={(e) => setCurrentSemester(e.target.value)}
                    placeholder="e.g. Semester 4"
                    style={{
                      width: '100%',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '0.5rem',
                      border: '1px solid var(--outline-variant, #d1c5b6)',
                      fontSize: '0.9rem',
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.75rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                    Student / Enrollment No. (Optional)
                  </label>
                  <input
                    type="text"
                    value={enrollmentNo}
                    onChange={(e) => setEnrollmentNo(e.target.value)}
                    placeholder="e.g. 24010012"
                    style={{
                      width: '100%',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '0.5rem',
                      border: '1px solid var(--outline-variant, #d1c5b6)',
                      fontSize: '0.9rem',
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                    Default Citation Style
                  </label>
                  <select
                    value={defaultCitationStyle}
                    onChange={(e) => setDefaultCitationStyle(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '0.5rem',
                      border: '1px solid var(--outline-variant, #d1c5b6)',
                      fontSize: '0.9rem',
                      background: '#ffffff',
                    }}
                  >
                    <option value="IEEE">IEEE (Technical / Engineering)</option>
                    <option value="APA">APA 7th (Sciences / Psychology)</option>
                    <option value="Harvard">Harvard (Business / General)</option>
                    <option value="MLA">MLA 9th (Humanities)</option>
                    <option value="Chicago">Chicago Manual (History / Lit)</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={saving}
                style={{
                  width: '100%',
                  padding: '0.875rem',
                  borderRadius: '0.75rem',
                  background: 'var(--primary, #705728)',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: '0.95rem',
                  border: 'none',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                }}
              >
                {saving ? <LoaderIcon size={18} className="animate-spin" /> : null}
                <span>Continue to Step 2 →</span>
              </button>
            </form>
          )}

          {/* STEP 2: Connections Check */}
          {step === 2 && (
            <div>
              <div style={{ marginBottom: '1.5rem' }}>
                <h2
                  style={{
                    fontFamily: "'Noto Serif', serif",
                    fontSize: '1.35rem',
                    fontWeight: 700,
                    margin: '0 0 0.35rem 0',
                    color: 'var(--primary, #705728)',
                  }}
                >
                  Step 2: Connected Services
                </h2>
                <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--on-surface-variant, #4d463a)' }}>
                  Verification of linked Google APIs, database storage, and AI inference engines.
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', marginBottom: '2rem' }}>
                {/* Supabase Database */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '1rem',
                    borderRadius: '0.75rem',
                    background: 'var(--surface-container, #fdebd9)',
                    border: '1px solid var(--outline-variant, #d1c5b6)',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Supabase PostgreSQL Database</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--on-surface-variant, #4d463a)' }}>
                      Row-Level Security & Encrypted Credential Vault
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#2e7d32', fontWeight: 600, fontSize: '0.825rem' }}>
                    <CheckCircleIcon size={16} />
                    Connected
                  </div>
                </div>

                {/* Google OAuth & Scopes */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '1rem',
                    borderRadius: '0.75rem',
                    background: 'var(--surface-container, #fdebd9)',
                    border: '1px solid var(--outline-variant, #d1c5b6)',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Google Academic Suite (OAuth 2.0)</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--on-surface-variant, #4d463a)' }}>
                      Gmail, Google Classroom, Google Drive, Calendar & Tasks
                    </div>
                  </div>
                  {status?.connections.google ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#2e7d32', fontWeight: 600, fontSize: '0.825rem' }}>
                      <CheckCircleIcon size={16} />
                      Connected
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#b45309', fontWeight: 600, fontSize: '0.825rem' }}>
                      <AlertCircleIcon size={16} />
                      Consent Needed
                    </div>
                  )}
                </div>

                {/* LLM Engine */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '1rem',
                    borderRadius: '0.75rem',
                    background: 'var(--surface-container, #fdebd9)',
                    border: '1px solid var(--outline-variant, #d1c5b6)',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>AI Reasoning & Generation</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--on-surface-variant, #4d463a)' }}>
                      Groq, Google Gemini 2.5 / 1.5 Pro, or OpenRouter fallback
                    </div>
                  </div>
                  {status?.connections.llm ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#2e7d32', fontWeight: 600, fontSize: '0.825rem' }}>
                      <CheckCircleIcon size={16} />
                      Active
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--error, #ba1a1a)', fontWeight: 600, fontSize: '0.825rem' }}>
                      <AlertCircleIcon size={16} />
                      Missing API Key
                    </div>
                  )}
                </div>

                {/* Telegram Bot */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '1rem',
                    borderRadius: '0.75rem',
                    background: 'var(--surface-container, #fdebd9)',
                    border: '1px solid var(--outline-variant, #d1c5b6)',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Telegram Bot Dispatcher</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--on-surface-variant, #4d463a)' }}>
                      Push notifications, interactive questions & voice transcription
                    </div>
                  </div>
                  {status?.connections.telegramBot ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#2e7d32', fontWeight: 600, fontSize: '0.825rem' }}>
                      <CheckCircleIcon size={16} />
                      Bot Ready
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#b45309', fontWeight: 600, fontSize: '0.825rem' }}>
                      <AlertCircleIcon size={16} />
                      Optional
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '1rem' }}>
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  style={{
                    flex: 1,
                    padding: '0.875rem',
                    borderRadius: '0.75rem',
                    background: 'transparent',
                    color: 'var(--on-surface, #231a0f)',
                    border: '1px solid var(--outline-variant, #d1c5b6)',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  ← Back to Step 1
                </button>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  style={{
                    flex: 2,
                    padding: '0.875rem',
                    borderRadius: '0.75rem',
                    background: 'var(--primary, #705728)',
                    color: '#ffffff',
                    fontWeight: 600,
                    fontSize: '0.95rem',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  Continue to Telegram Link →
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: Telegram Link */}
          {step === 3 && (
            <div>
              <div style={{ marginBottom: '1.5rem' }}>
                <h2
                  style={{
                    fontFamily: "'Noto Serif', serif",
                    fontSize: '1.35rem',
                    fontWeight: 700,
                    margin: '0 0 0.35rem 0',
                    color: 'var(--primary, #705728)',
                  }}
                >
                  Step 3: Connect Telegram Assistant
                </h2>
                <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--on-surface-variant, #4d463a)' }}>
                  Pair your Telegram chat to receive real-time task alerts and review deliverables on mobile.
                </p>
              </div>

              {/* Status Box */}
              {status?.connections.telegramLinked ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '1.125rem 1.25rem',
                    borderRadius: '0.75rem',
                    background: '#ecfdf5',
                    border: '1px solid #a7f3d0',
                    color: '#065f46',
                    marginBottom: '1.75rem',
                  }}
                >
                  <CheckCircleIcon size={20} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.925rem' }}>Telegram Linked!</div>
                    <div style={{ fontSize: '0.825rem' }}>
                      Your Telegram chat is active and connected to Vicarius Agent.
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    background: 'var(--surface-container-high, #f7e5d4)',
                    borderRadius: '0.875rem',
                    padding: '1.25rem',
                    marginBottom: '1.75rem',
                    border: '1px solid var(--outline-variant, #d1c5b6)',
                  }}
                >
                  <div style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem' }}>
                    Send this message to your Telegram bot:
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: '#ffffff',
                      border: '1px solid var(--outline-variant, #d1c5b6)',
                      borderRadius: '0.5rem',
                      padding: '0.625rem 0.875rem',
                      fontFamily: 'monospace',
                      fontSize: '0.95rem',
                      color: 'var(--primary, #705728)',
                    }}
                  >
                    <span>{telegramCommand}</span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(telegramCommand);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                      style={{
                        background: 'var(--primary, #705728)',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '0.375rem',
                        padding: '0.35rem 0.75rem',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>

                  <p
                    style={{
                      margin: '0.75rem 0 0 0',
                      fontSize: '0.785rem',
                      color: 'var(--on-surface-variant, #4d463a)',
                      lineHeight: 1.45,
                    }}
                  >
                    Your bot will immediately reply with a confirmation and store your chat ID automatically.
                  </p>
                </div>
              )}

              {/* Manual Chat ID Fallback */}
              <div style={{ marginBottom: '2rem' }}>
                <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                  Or Enter Your Telegram Chat ID Manually:
                </label>
                <input
                  type="text"
                  value={manualTelegramId}
                  onChange={(e) => setManualTelegramId(e.target.value)}
                  placeholder="e.g. 7464950137 (optional)"
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.85rem',
                    borderRadius: '0.5rem',
                    border: '1px solid var(--outline-variant, #d1c5b6)',
                    fontSize: '0.9rem',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '1rem' }}>
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  style={{
                    flex: 1,
                    padding: '0.875rem',
                    borderRadius: '0.75rem',
                    background: 'transparent',
                    color: 'var(--on-surface, #231a0f)',
                    border: '1px solid var(--outline-variant, #d1c5b6)',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  ← Back to Step 2
                </button>
                <button
                  type="button"
                  onClick={handleFinishSetup}
                  disabled={saving}
                  style={{
                    flex: 2,
                    padding: '0.875rem',
                    borderRadius: '0.75rem',
                    background: 'var(--primary, #705728)',
                    color: '#ffffff',
                    fontWeight: 600,
                    fontSize: '0.95rem',
                    border: 'none',
                    cursor: saving ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                  }}
                >
                  {saving ? <LoaderIcon size={18} className="animate-spin" /> : null}
                  <span>Complete Setup & Launch Dashboard 🚀</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
