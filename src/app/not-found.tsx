'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { VicariusLogo } from '@/components/VicariusLogo';

export default function NotFound() {
  const [keyInput, setKeyInput] = useState('');
  const [showKeyField, setShowKeyField] = useState(false);

  const handleUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyInput.trim()) return;
    window.location.href = `/?token=${encodeURIComponent(keyInput.trim())}`;
  };

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
            margin: '0 auto 28px auto',
          }}
        >
          The requested document, terminal, or academic resource could not be located in the archival registry. It may have been relocated, classified, or restricted.
        </p>

        {showKeyField ? (
          <form
            onSubmit={handleUnlock}
            style={{
              display: 'flex',
              gap: 8,
              maxWidth: 360,
              margin: '0 auto',
            }}
          >
            <input
              type="password"
              placeholder="Enter operator access key..."
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              className="stationery-input"
              style={{ flex: 1, fontSize: '0.88rem' }}
              autoFocus
            />
            <button
              type="submit"
              className="btn-heritage-primary"
              style={{ padding: '8px 16px', fontSize: '0.85rem' }}
            >
              Unlock
            </button>
          </form>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 14, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setShowKeyField(true)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--outline)',
                fontSize: '0.82rem',
                cursor: 'pointer',
                textDecoration: 'underline',
                padding: '6px 10px',
              }}
            >
              Authorized Operator Access &rarr;
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
