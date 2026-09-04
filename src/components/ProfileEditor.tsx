'use client';

import React, { useState, useEffect } from 'react';
import { UserProfile } from '@/lib/types';
import { VicariusLogo } from '@/components/VicariusLogo';
import { CheckIcon, SparklesIcon, CloseIcon, ExternalLinkIcon } from '@/components/Icons';

interface ProfileEditorProps {
  initialProfile: UserProfile | null;
  onProfileUpdated?: (updated: UserProfile) => void;
  isModal?: boolean;
  onClose?: () => void;
}

export function ProfileEditor({
  initialProfile,
  onProfileUpdated,
  isModal = false,
  onClose,
}: ProfileEditorProps) {
  const [profile, setProfile] = useState<UserProfile | null>(initialProfile);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Local helper states for dynamic fields
  const [newSkill, setNewSkill] = useState('');
  const [newInterest, setNewInterest] = useState('');
  const [newAttrKey, setNewAttrKey] = useState('');
  const [newAttrVal, setNewAttrVal] = useState('');
  const [showRawJson, setShowRawJson] = useState(false);

  useEffect(() => {
    if (initialProfile) {
      setProfile(initialProfile);
    }
  }, [initialProfile]);

  if (!profile) {
    return (
      <div className="heritage-card" style={{ padding: 36, textAlign: 'center' }}>
        <div style={{ color: 'var(--on-surface-variant)', fontSize: '0.95rem' }}>
          Loading student profile database from Supabase...
        </div>
      </div>
    );
  }

  // Handle adding skill chip
  const handleAddSkill = () => {
    const trimmed = newSkill.trim();
    if (!trimmed) return;
    const currentSkills = Array.isArray(profile.skills) ? [...profile.skills] : [];
    if (!currentSkills.includes(trimmed)) {
      setProfile({ ...profile, skills: [...currentSkills, trimmed] });
    }
    setNewSkill('');
  };

  const handleRemoveSkill = (skillToRemove: string) => {
    const currentSkills = Array.isArray(profile.skills) ? profile.skills : [];
    setProfile({
      ...profile,
      skills: currentSkills.filter((s) => s !== skillToRemove),
    });
  };

  // Handle adding research interest
  const handleAddInterest = () => {
    const trimmed = newInterest.trim();
    if (!trimmed) return;
    const currentInterests = Array.isArray(profile.research_interests) ? [...profile.research_interests] : [];
    if (!currentInterests.includes(trimmed)) {
      setProfile({ ...profile, research_interests: [...currentInterests, trimmed] });
    }
    setNewInterest('');
  };

  const handleRemoveInterest = (interestToRemove: string) => {
    const currentInterests = Array.isArray(profile.research_interests) ? profile.research_interests : [];
    setProfile({
      ...profile,
      research_interests: currentInterests.filter((i) => i !== interestToRemove),
    });
  };

  // Handle custom attributes (dynamic key-values)
  const handleAddAttribute = () => {
    const key = newAttrKey.trim().toLowerCase().replace(/[\s-]+/g, '_');
    const val = newAttrVal.trim();
    if (!key || !val) return;

    const currentAttrs = typeof profile.custom_attributes === 'object' && profile.custom_attributes !== null
      ? { ...profile.custom_attributes }
      : {};

    currentAttrs[key] = val;
    setProfile({ ...profile, custom_attributes: currentAttrs });
    setNewAttrKey('');
    setNewAttrVal('');
  };

  const handleRemoveAttribute = (keyToRemove: string) => {
    const currentAttrs = typeof profile.custom_attributes === 'object' && profile.custom_attributes !== null
      ? { ...profile.custom_attributes }
      : {};
    delete currentAttrs[keyToRemove];
    setProfile({ ...profile, custom_attributes: currentAttrs });
  };

  // Submit to Supabase live via API
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      setSavedMessage('');
      setErrorMessage('');

      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });

      const json = await res.json();
      if (json.success && json.data) {
        setProfile(json.data);
        if (onProfileUpdated) {
          onProfileUpdated(json.data);
        }
        setSavedMessage('Profile & User Info successfully synchronized live to Supabase! All agents access this immediately.');
        setTimeout(() => setSavedMessage(''), 6000);
      } else {
        setErrorMessage(json.error?.message || 'Failed to update user profile in Supabase.');
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Network error updating user profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={isModal ? '' : 'heritage-card'}
      style={{
        padding: isModal ? 0 : '32px 36px',
        display: 'flex',
        flexDirection: 'column',
        gap: 28,
        position: 'relative',
      }}
    >
      {/* Header Banner */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: 16,
          borderBottom: '1px solid var(--outline-variant)',
          paddingBottom: 18,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <VicariusLogo size={42} variant="crest" />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 className="heading-h2 font-serif" style={{ fontSize: '1.45rem', color: 'var(--on-surface)', margin: 0 }}>
                Student Profile & Intelligence Vault
              </h2>
              <span
                style={{
                  background: 'var(--primary-container)',
                  color: '#fff9f6',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 4,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Supabase Live
              </span>
            </div>
            <p style={{ color: 'var(--on-surface-variant)', fontSize: '0.85rem', marginTop: 4 }}>
              Persisted in Supabase <code>public.profile</code> &amp; <code>public.user_info</code>. Autonomous planners, coders, and document generators query this database in real time.
            </p>
          </div>
        </div>

        {isModal && onClose && (
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--outline)',
              padding: 4,
            }}
          >
            <CloseIcon size={20} />
          </button>
        )}
      </div>

      {/* Alerts / Feedback */}
      {savedMessage && (
        <div
          style={{
            background: 'var(--surface-container-high)',
            border: '1px solid var(--primary)',
            color: 'var(--primary)',
            padding: '12px 18px',
            borderRadius: 6,
            fontSize: '0.9rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <CheckIcon size={18} color="var(--primary)" />
          <span>{savedMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div
          style={{
            background: 'var(--error-container)',
            border: '1px solid var(--error)',
            color: 'var(--on-error-container)',
            padding: '12px 18px',
            borderRadius: 6,
            fontSize: '0.9rem',
            fontWeight: 600,
          }}
        >
          ⚠ {errorMessage}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* SECTION 1: Personal Identity & Contact */}
        <div
          style={{
            background: 'var(--surface-container-low)',
            borderRadius: 8,
            padding: '20px 24px',
            border: '1px solid var(--outline-variant)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <SparklesIcon size={16} color="var(--primary)" />
            <h3 className="font-serif" style={{ fontSize: '1.05rem', color: 'var(--primary)', margin: 0 }}>
              1. Personal Coordinates &amp; Contact
            </h3>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--on-surface)', marginBottom: 6 }}>
                Full Legal Name
              </label>
              <input
                type="text"
                value={profile.full_name || ''}
                onChange={(e) => setProfile({ ...profile, full_name: e.target.value })}
                className="stationery-input"
                style={{ width: '100%' }}
                placeholder="e.g. Nisarg Patel"
                required
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--on-surface)', marginBottom: 6 }}>
                Preferred / First Name
              </label>
              <input
                type="text"
                value={profile.preferred_name || ''}
                onChange={(e) => setProfile({ ...profile, preferred_name: e.target.value })}
                className="stationery-input"
                style={{ width: '100%' }}
                placeholder="e.g. Nisarg"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--on-surface)', marginBottom: 6 }}>
                Academic Email
              </label>
              <input
                type="email"
                value={profile.email || ''}
                onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                className="stationery-input"
                style={{ width: '100%' }}
                placeholder="student@silveroakuni.ac.in"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--on-surface)', marginBottom: 6 }}>
                Telegram User / Chat ID
              </label>
              <input
                type="text"
                value={profile.telegram_id || ''}
                onChange={(e) => setProfile({ ...profile, telegram_id: e.target.value })}
                className="stationery-input"
                style={{ width: '100%' }}
                placeholder="e.g. 123456789"
              />
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--on-surface)', marginBottom: 6 }}>
              Student Biography / Personal Context
            </label>
            <textarea
              rows={2}
              value={profile.bio || ''}
              onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
              className="stationery-input"
              style={{ width: '100%', resize: 'vertical' }}
              placeholder="Undergraduate engineering student specializing in AI/ML, distributed architectures, and autonomous agents..."
            />
          </div>
        </div>

        {/* SECTION 2: Academic Program & Coordinates */}
        <div
          style={{
            background: 'var(--surface-container-low)',
            borderRadius: 8,
            padding: '20px 24px',
            border: '1px solid var(--outline-variant)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <SparklesIcon size={16} color="var(--primary)" />
            <h3 className="font-serif" style={{ fontSize: '1.05rem', color: 'var(--primary)', margin: 0 }}>
              2. Academic Coordinates &amp; Standing
            </h3>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--on-surface)', marginBottom: 6 }}>
                University / Institution
              </label>
              <input
                type="text"
                value={profile.university || ''}
                onChange={(e) => setProfile({ ...profile, university: e.target.value })}
                className="stationery-input"
                style={{ width: '100%' }}
                placeholder="Academic Institution"
                required
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--on-surface)', marginBottom: 6 }}>
                Department / College
              </label>
              <input
                type="text"
                value={profile.department || ''}
                onChange={(e) => setProfile({ ...profile, department: e.target.value })}
                className="stationery-input"
                style={{ width: '100%' }}
                placeholder="Computer Engineering (AIML)"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--on-surface)', marginBottom: 6 }}>
                Degree &amp; Program
              </label>
              <input
                type="text"
                value={profile.program || ''}
                onChange={(e) => setProfile({ ...profile, program: e.target.value })}
                className="stationery-input"
                style={{ width: '100%' }}
                placeholder="B.Tech, Computer Engineering (AIML)"
                required
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--on-surface)', marginBottom: 6 }}>
                Enrollment / Roll Number
              </label>
              <input
                type="text"
                value={profile.enrollment_no || ''}
                onChange={(e) => setProfile({ ...profile, enrollment_no: e.target.value })}
                className="stationery-input"
                style={{ width: '100%' }}
                placeholder="e.g. 210103100001"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--on-surface)', marginBottom: 6 }}>
                Current Semester
              </label>
              <input
                type="text"
                value={profile.current_semester || ''}
                onChange={(e) => setProfile({ ...profile, current_semester: e.target.value })}
                className="stationery-input"
                style={{ width: '100%' }}
                placeholder="Semester 4"
                required
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--on-surface)', marginBottom: 6 }}>
                Graduation Year
              </label>
              <input
                type="text"
                value={profile.graduation_year || ''}
                onChange={(e) => setProfile({ ...profile, graduation_year: e.target.value })}
                className="stationery-input"
                style={{ width: '100%' }}
                placeholder="2026"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--on-surface)', marginBottom: 6 }}>
                CGPA / Academic Target
              </label>
              <input
                type="text"
                value={profile.cgpa_or_target_grade || ''}
                onChange={(e) => setProfile({ ...profile, cgpa_or_target_grade: e.target.value })}
                className="stationery-input"
                style={{ width: '100%' }}
                placeholder="e.g. 9.4 / 10.0"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--on-surface)', marginBottom: 6 }}>
                Citation Standard
              </label>
              <select
                value={profile.default_citation_style || 'IEEE'}
                onChange={(e) => setProfile({ ...profile, default_citation_style: e.target.value })}
                className="stationery-select"
                style={{ width: '100%' }}
              >
                <option value="IEEE">IEEE (Technical & Engineering)</option>
                <option value="APA">APA 7th (Scientific & Computing)</option>
                <option value="ACM">ACM (Computing Machinery)</option>
                <option value="Harvard">Harvard Author-Date</option>
                <option value="Chicago">Chicago Manual of Style</option>
              </select>
            </div>
          </div>
        </div>

        {/* SECTION 3: Autonomous Agent Directives & Rules */}
        <div
          style={{
            background: 'var(--surface-container-low)',
            borderRadius: 8,
            padding: '20px 24px',
            border: '1px solid var(--primary-container)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <SparklesIcon size={16} color="var(--primary)" />
            <h3 className="font-serif" style={{ fontSize: '1.05rem', color: 'var(--primary)', margin: 0 }}>
              3. Autonomous Agent Directives &amp; Working Rules
            </h3>
          </div>
          <p style={{ fontSize: '0.82rem', color: 'var(--on-surface-variant)', marginBottom: 10 }}>
            Every LangGraph planner, coder, and verifier node reads these guidelines. Any instruction written here is strictly obeyed during autonomous execution.
          </p>
          <textarea
            rows={3}
            value={profile.custom_instructions || ''}
            onChange={(e) => setProfile({ ...profile, custom_instructions: e.target.value })}
            className="stationery-input"
            style={{ width: '100%', resize: 'vertical', lineHeight: 1.5 }}
            placeholder="e.g. Always use Cognitive Heritage design tokens for documents and interfaces. Deliver academic projects with rigorous mathematical proofs, comprehensive empirical evaluations, and standard APA/IEEE citations. Ensure all code is cleanly modularized with automated tests..."
          />
        </div>

        {/* SECTION 4: Academic Voice & Tone Register */}
        <div
          style={{
            background: 'var(--surface-container-low)',
            borderRadius: 8,
            padding: '20px 24px',
            border: '1px solid var(--outline-variant)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <SparklesIcon size={16} color="var(--primary)" />
            <h3 className="font-serif" style={{ fontSize: '1.05rem', color: 'var(--primary)', margin: 0 }}>
              4. Academic Voice &amp; Tone Register
            </h3>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--on-surface)', marginBottom: 4 }}>
                Academic Depth &amp; Register Note
              </label>
              <textarea
                rows={2}
                value={profile.academic_level_note || ''}
                onChange={(e) => setProfile({ ...profile, academic_level_note: e.target.value })}
                className="stationery-input"
                style={{ width: '100%', resize: 'vertical' }}
                placeholder="Comfortable with rigorous technical depth, distributed systems, machine learning architectures, and academic prose; avoids superficial generalizations."
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--on-surface)', marginBottom: 4 }}>
                Writing Voice Sample
                <span style={{ fontWeight: 400, color: 'var(--outline)', marginLeft: 6 }}>
                  (Used as tone/style rhythm anchor — never plagiarized or copied verbatim)
                </span>
              </label>
              <textarea
                rows={3}
                value={profile.writing_voice_sample || ''}
                onChange={(e) => setProfile({ ...profile, writing_voice_sample: e.target.value })}
                className="stationery-input"
                style={{ width: '100%', resize: 'vertical', fontFamily: 'var(--font-serif)', fontSize: '0.9rem' }}
                placeholder="In distributed systems, ensuring high availability often necessitates trade-offs against immediate consistency..."
              />
            </div>
          </div>
        </div>

        {/* SECTION 5: Technical Skills & Research Focus */}
        <div
          style={{
            background: 'var(--surface-container-low)',
            borderRadius: 8,
            padding: '20px 24px',
            border: '1px solid var(--outline-variant)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <SparklesIcon size={16} color="var(--primary)" />
            <h3 className="font-serif" style={{ fontSize: '1.05rem', color: 'var(--primary)', margin: 0 }}>
              5. Technical Skillset &amp; Research Focus
            </h3>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            {/* Skills */}
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--on-surface)', marginBottom: 6 }}>
                Technical Skills &amp; Stack
              </label>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <input
                  type="text"
                  value={newSkill}
                  onChange={(e) => setNewSkill(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddSkill();
                    }
                  }}
                  className="stationery-input"
                  style={{ flex: 1 }}
                  placeholder="e.g. PyTorch, Docker..."
                />
                <button
                  type="button"
                  onClick={handleAddSkill}
                  className="btn-heritage-secondary"
                  style={{ padding: '6px 14px', fontSize: '0.82rem' }}
                >
                  + Add
                </button>
              </div>

              {/* Chips */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minHeight: 36 }}>
                {Array.isArray(profile.skills) && profile.skills.map((skill) => (
                  <span
                    key={skill}
                    style={{
                      background: 'var(--surface-container-high)',
                      border: '1px solid var(--outline-variant)',
                      color: 'var(--on-surface)',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      padding: '3px 8px',
                      borderRadius: 14,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span>{skill}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveSkill(skill)}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--outline)',
                        fontSize: '0.9rem',
                        padding: 0,
                        lineHeight: 1,
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {/* Research Interests */}
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--on-surface)', marginBottom: 6 }}>
                Research &amp; Domain Focus
              </label>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <input
                  type="text"
                  value={newInterest}
                  onChange={(e) => setNewInterest(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddInterest();
                    }
                  }}
                  className="stationery-input"
                  style={{ flex: 1 }}
                  placeholder="e.g. Multi-Agent Systems..."
                />
                <button
                  type="button"
                  onClick={handleAddInterest}
                  className="btn-heritage-secondary"
                  style={{ padding: '6px 14px', fontSize: '0.82rem' }}
                >
                  + Add
                </button>
              </div>

              {/* Chips */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minHeight: 36 }}>
                {Array.isArray(profile.research_interests) && profile.research_interests.map((interest) => (
                  <span
                    key={interest}
                    style={{
                      background: 'var(--surface-container-high)',
                      border: '1px solid var(--outline-variant)',
                      color: 'var(--on-surface)',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      padding: '3px 8px',
                      borderRadius: 14,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span>{interest}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveInterest(interest)}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--outline)',
                        fontSize: '0.9rem',
                        padding: 0,
                        lineHeight: 1,
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 6: Dynamic User Info Vault (Custom Attributes) */}
        <div
          style={{
            background: 'var(--surface-container-low)',
            borderRadius: 8,
            padding: '20px 24px',
            border: '1px solid var(--outline-variant)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <SparklesIcon size={16} color="var(--primary)" />
              <h3 className="font-serif" style={{ fontSize: '1.05rem', color: 'var(--primary)', margin: 0 }}>
                6. Custom User Info Vault (Extensible Attributes)
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setShowRawJson(!showRawJson)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--primary)',
                fontSize: '0.82rem',
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              {showRawJson ? 'Hide JSON View' : 'Show Raw JSON'}
            </button>
          </div>
          <p style={{ fontSize: '0.82rem', color: 'var(--on-surface-variant)', marginBottom: 14 }}>
            Store any personalized facts, links, hardware specs, preferred tools, professor names, or custom metadata. The agent queries this dictionary whenever it needs personal context.
          </p>

          {/* New Attribute Inputs */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            <input
              type="text"
              value={newAttrKey}
              onChange={(e) => setNewAttrKey(e.target.value)}
              className="stationery-input"
              style={{ flex: 1, minWidth: 160 }}
              placeholder="Attribute Key (e.g. github, linkedin)"
            />
            <input
              type="text"
              value={newAttrVal}
              onChange={(e) => setNewAttrVal(e.target.value)}
              className="stationery-input"
              style={{ flex: 2, minWidth: 240 }}
              placeholder="Attribute Value (e.g. nisargpatel1906)"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddAttribute();
                }
              }}
            />
            <button
              type="button"
              onClick={handleAddAttribute}
              className="btn-heritage-secondary"
              style={{ padding: '8px 16px', fontSize: '0.85rem' }}
            >
              + Add Field
            </button>
          </div>

          {/* Current Attribute List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {profile.custom_attributes &&
              Object.entries(profile.custom_attributes).map(([k, v]) => (
                <div
                  key={k}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: 'var(--surface)',
                    border: '1px solid var(--outline-variant)',
                    padding: '8px 14px',
                    borderRadius: 6,
                    fontSize: '0.85rem',
                  }}
                >
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <code style={{ color: 'var(--primary)', fontWeight: 700 }}>{k}</code>
                    <span style={{ color: 'var(--outline)' }}>:</span>
                    <span style={{ color: 'var(--on-surface)' }}>{String(v)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveAttribute(k)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--error)',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                    }}
                  >
                    Delete
                  </button>
                </div>
              ))}
          </div>

          {/* Raw JSON inspection */}
          {showRawJson && (
            <div style={{ marginTop: 14 }}>
              <pre
                style={{
                  background: 'var(--inverse-surface)',
                  color: 'var(--inverse-on-surface)',
                  padding: 12,
                  borderRadius: 6,
                  fontSize: '0.78rem',
                  overflowX: 'auto',
                }}
              >
                {JSON.stringify(profile.custom_attributes || {}, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Global Save Button Bar */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 12,
            paddingTop: 12,
            borderTop: '1px solid var(--outline-variant)',
          }}
        >
          {isModal && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="btn-heritage-secondary"
            >
              Close
            </button>
          )}

          <button
            type="submit"
            disabled={saving}
            className="btn-heritage-primary"
            style={{ padding: '12px 28px', fontSize: '0.95rem', fontWeight: 700 }}
          >
            {saving ? 'Synchronizing to Supabase...' : 'Save Profile & Synchronize Agents'}
          </button>
        </div>
      </form>
    </div>
  );
}
