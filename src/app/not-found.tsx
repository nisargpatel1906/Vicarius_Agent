'use client';

import React, { useEffect } from 'react';
import { VicariusLogo } from '@/components/VicariusLogo';
import { ClassroomIcon, UserIcon, ExternalLinkIcon } from '@/components/Icons';

export default function NotFound() {
  useEffect(() => {
    document.title = '404 • Archival Manuscript Not Found | Vicarius Agent';
  }, []);

  return (
    <div
      style={{
        minHeight: '75vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 16px',
        width: '100%',
      }}
    >
      <div
        className="heritage-card"
        style={{
          maxWidth: 580,
          width: '100%',
          padding: '48px 32px',
          textAlign: 'center',
          position: 'relative',
          overflow: 'hidden',
          background: 'var(--surface)',
          boxShadow: 'var(--shadow-modal)',
        }}
      >
        <VicariusLogo
          size={240}
          variant="watermark"
          fill="#8B6F3E"
          style={{ right: '-50px', bottom: '-50px', opacity: 0.05 }}
        />

        <div style={{ display: 'inline-flex', marginBottom: 20 }}>
          <VicariusLogo size={48} variant="crest" />
        </div>

        <div style={{ marginBottom: 12 }}>
          <span
            className="label-caps"
            style={{
              background: 'var(--surface-container-high)',
              color: 'var(--on-surface-variant)',
              padding: '4px 12px',
              borderRadius: 20,
              fontSize: '11px',
              fontWeight: 700,
              border: '1px solid var(--outline-variant)',
            }}
          >
            404 &bull; Archival Record Not Found
          </span>
        </div>

        <h1
          className="font-serif"
          style={{
            fontSize: '1.9rem',
            fontWeight: 700,
            color: 'var(--on-surface)',
            marginBottom: 12,
            letterSpacing: '-0.02em',
          }}
        >
          Manuscript Unavailable
        </h1>

        <p
          style={{
            fontSize: '0.92rem',
            color: 'var(--on-surface-variant)',
            lineHeight: 1.6,
            maxWidth: 440,
            margin: '0 auto 28px auto',
          }}
        >
          The requested document, terminal route, or academic record could not be located in the Vicarius archival registry. It may have been relocated, archived, or restricted.
        </p>

        {/* Navigation Action Buttons to prevent dead-end navigation */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <a
            href="/"
            className="btn-heritage-primary"
            style={{
              textDecoration: 'none',
              padding: '10px 24px',
              fontSize: '0.92rem',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              justifyContent: 'center',
              width: 'min(320px, 100%)',
            }}
          >
            <ClassroomIcon size={16} color="#FFF9F6" />
            <span>Return to Operations Command</span>
          </a>

          <div
            style={{
              display: 'flex',
              gap: 10,
              flexWrap: 'wrap',
              justifyContent: 'center',
              marginTop: 4,
            }}
          >
            <a
              href="/?tab=profile"
              className="btn-heritage-secondary"
              style={{
                textDecoration: 'none',
                fontSize: '0.82rem',
                padding: '8px 14px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <UserIcon size={14} color="var(--primary)" />
              <span>Student Profile Vault</span>
            </a>

            <a
              href="/api/health"
              target="_blank"
              rel="noreferrer"
              className="btn-heritage-secondary"
              style={{
                textDecoration: 'none',
                fontSize: '0.82rem',
                padding: '8px 14px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <ExternalLinkIcon size={13} color="var(--primary)" />
              <span>System Health</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
