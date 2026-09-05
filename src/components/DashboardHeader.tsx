'use client';

import React, { useState, useEffect } from 'react';
import { VicariusLogo } from '@/components/VicariusLogo';
import { MenuIcon, CloseIcon, ClockIcon, ZapIcon, ClassroomIcon, UserIcon, ExternalLinkIcon } from '@/components/Icons';

interface DashboardHeaderProps {
  isAuthorized?: boolean;
}

export function DashboardHeader({ isAuthorized = true }: DashboardHeaderProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState<string>('');
  const [polling, setPolling] = useState(false);

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

  // Close drawer on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Lock body scroll when drawer open
  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [drawerOpen]);

  const handleQuickPoll = async () => {
    try {
      setPolling(true);
      const res = await fetch('/api/ingest', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        window.location.reload();
      }
    } catch (err) {
      console.error('Mobile poll error:', err);
    } finally {
      setPolling(false);
      setDrawerOpen(false);
    }
  };

  if (!isAuthorized) return null;

  return (
    <header
      style={{
        borderBottom: '1px solid var(--outline-variant)',
        background: 'rgba(255, 248, 244, 0.94)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        padding: 'var(--header-padding-y) var(--page-padding)',
        boxShadow: '0 2px 12px rgba(35, 26, 15, 0.03)',
      }}
    >
      <div
        style={{
          maxWidth: 1440,
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          width: '100%',
        }}
      >
        {/* Brand Crest & Title (Clickable Link to Home) */}
        <a
          href="/"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            textDecoration: 'none',
            color: 'inherit',
          }}
          title="Return to Academic Operations Command"
        >
          <VicariusLogo size={40} variant="crest" title="Vicarius Agent Crest" />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span
                className="font-serif"
                style={{
                  fontSize: '1.25rem',
                  fontWeight: 700,
                  letterSpacing: '-0.01em',
                  color: 'var(--on-surface)',
                  lineHeight: 1.2,
                }}
              >
                Vicarius Agent
              </span>
              <span
                className="label-caps"
                style={{
                  background: 'var(--primary-fixed)',
                  color: 'var(--on-primary-fixed)',
                  padding: '2px 7px',
                  borderRadius: 4,
                  fontSize: '9.5px',
                  fontWeight: 700,
                }}
              >
                Triple Core v1.1
              </span>
            </div>
            <p
              style={{
                fontSize: '0.75rem',
                color: 'var(--on-surface-variant)',
                marginTop: 2,
              }}
            >
              Cognitive Heritage Pipeline &bull; Academic Institution
            </p>
          </div>
        </a>

        {/* Desktop Status Bar & Indicators */}
        <div className="header-desktop-status" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Live IST Clock */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'var(--surface-container-low)',
              padding: '6px 12px',
              borderRadius: 4,
              border: '1px solid var(--outline-variant)',
              fontSize: '0.78rem',
              color: 'var(--on-surface-variant)',
              fontFamily: 'monospace',
            }}
          >
            <ClockIcon size={13} color="var(--primary)" />
            <span>{currentTime || 'IST'}</span>
          </div>

          {/* Engine Version Badge */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'var(--surface-container-low)',
              padding: '6px 12px',
              borderRadius: 4,
              border: '1px solid var(--outline-variant)',
              fontSize: '0.78rem',
              color: 'var(--on-surface-variant)',
            }}
          >
            <VicariusLogo size={14} variant="mark" fill="var(--primary-container)" />
            <span>Antigravity Engine: <strong>v1.1.12</strong></span>
          </div>

          {/* System Status Pill */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'var(--surface-container-lowest)',
              padding: '6px 14px',
              borderRadius: 4,
              border: '1px solid var(--outline-variant)',
              fontSize: '0.8rem',
              boxShadow: 'var(--shadow-subtle)',
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: '#2e7d32',
                boxShadow: '0 0 6px rgba(46, 125, 50, 0.6)',
              }}
            />
            <span style={{ fontWeight: 600, color: 'var(--on-surface)' }}>
              Autonomous System Active
            </span>
          </div>
        </div>

        {/* Mobile Hamburger Toggle Button */}
        <button
          type="button"
          className="mobile-nav-toggle"
          onClick={() => setDrawerOpen(!drawerOpen)}
          aria-label={drawerOpen ? 'Close navigation drawer' : 'Open navigation drawer'}
          aria-expanded={drawerOpen}
        >
          {drawerOpen ? <CloseIcon size={20} color="var(--primary)" /> : <MenuIcon size={20} color="var(--primary)" />}
        </button>
      </div>

      {/* Mobile Slide-Over Navigation Drawer */}
      {drawerOpen && (
        <>
          <div
            className="mobile-drawer-overlay"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <div
            className="mobile-drawer-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Mobile Navigation"
          >
            {/* Drawer Top Strip */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingBottom: 16,
                borderBottom: '1px solid var(--outline-variant)',
                marginBottom: 16,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <VicariusLogo size={32} variant="crest" />
                <div>
                  <div className="font-serif" style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--on-surface)' }}>
                    Vicarius Agent
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--on-surface-variant)' }}>
                    Operations Navigation
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--outline)',
                  cursor: 'pointer',
                  padding: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                aria-label="Close drawer"
              >
                <CloseIcon size={22} />
              </button>
            </div>

            {/* System Status in Drawer */}
            <div
              style={{
                background: 'var(--surface-container-low)',
                padding: '12px 14px',
                borderRadius: 6,
                border: '1px solid var(--outline-variant)',
                marginBottom: 20,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    backgroundColor: '#2e7d32',
                    boxShadow: '0 0 6px rgba(46, 125, 50, 0.6)',
                  }}
                />
                <span style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--on-surface)' }}>
                  Autonomous System Active
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--on-surface-variant)' }}>
                <span>Engine: v1.1.12</span>
                <span style={{ fontFamily: 'monospace' }}>{currentTime}</span>
              </div>
            </div>

            {/* Navigation Links */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
              <div className="label-caps" style={{ color: 'var(--primary)', marginBottom: 4, fontSize: '10px' }}>
                Primary Modules
              </div>

              <a
                href="/"
                onClick={() => setDrawerOpen(false)}
                className="btn-heritage-secondary"
                style={{
                  textDecoration: 'none',
                  justifyContent: 'flex-start',
                  padding: '10px 14px',
                  fontSize: '0.88rem',
                }}
              >
                <ClassroomIcon size={16} color="var(--primary)" />
                <span>Academic Pipeline Stream</span>
              </a>

              <a
                href="/?tab=profile"
                onClick={() => setDrawerOpen(false)}
                className="btn-heritage-secondary"
                style={{
                  textDecoration: 'none',
                  justifyContent: 'flex-start',
                  padding: '10px 14px',
                  fontSize: '0.88rem',
                }}
              >
                <UserIcon size={16} color="var(--primary)" />
                <span>Student Profile &amp; Vault</span>
              </a>

              <a
                href="/api/health"
                target="_blank"
                rel="noreferrer"
                className="btn-heritage-secondary"
                style={{
                  textDecoration: 'none',
                  justifyContent: 'flex-start',
                  padding: '10px 14px',
                  fontSize: '0.88rem',
                }}
              >
                <ExternalLinkIcon size={14} color="var(--primary)" />
                <span>System Telemetry JSON</span>
              </a>
            </div>

            {/* Quick Action Button */}
            <div style={{ marginTop: 'auto' }}>
              <button
                type="button"
                onClick={handleQuickPoll}
                disabled={polling}
                className="btn-heritage-primary"
                style={{
                  width: '100%',
                  justifyContent: 'center',
                  padding: '12px',
                  fontSize: '0.88rem',
                }}
              >
                <ZapIcon size={15} color="#FFF9F6" />
                <span>{polling ? 'Polling Classroom & Gmail...' : 'Poll Sources Now'}</span>
              </button>

              <div
                style={{
                  textAlign: 'center',
                  fontSize: '0.72rem',
                  color: 'var(--on-surface-variant)',
                  marginTop: 14,
                }}
              >
                Vicarius Academic Agent &bull; Academic Institution
              </div>
            </div>
          </div>
        </>
      )}
    </header>
  );
}
