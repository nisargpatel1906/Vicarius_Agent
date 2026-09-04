'use client';

import React, { useEffect } from 'react';
import { VicariusLogo } from '@/components/VicariusLogo';

export default function NotFound() {
  useEffect(() => {
    document.title = '404 • Page Not Found';
  }, []);

  return (
    <div
      style={{
        minHeight: '75vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 20px',
      }}
    >
      <div
        className="heritage-card"
        style={{
          maxWidth: 580,
          width: '100%',
          padding: '48px 40px',
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
            fontSize: '0.94rem',
            color: 'var(--on-surface-variant)',
            lineHeight: 1.6,
            maxWidth: 440,
            margin: '0 auto',
          }}
        >
          The requested document, terminal, or academic resource could not be located in the archival registry. It may have been relocated, classified, or restricted.
        </p>
      </div>
    </div>
  );
}
