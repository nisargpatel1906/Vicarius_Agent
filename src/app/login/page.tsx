'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { VicariusLogo } from '@/components/VicariusLogo';
import { ShieldIcon, AlertCircleIcon, LoaderIcon, SparklesIcon, CheckCircleIcon } from '@/components/Icons';

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me',
  'https://www.googleapis.com/auth/classroom.announcements.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/calendar.events',
];

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = searchParams.get('redirect') || '/';
  const errorParam = searchParams.get('error');

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (errorParam === 'not_allowed') {
      setErrorMsg('Access Restricted: This deployment is configured for a specific Google account. Please sign in with the authorized account.');
    } else if (errorParam === 'auth_failed') {
      setErrorMsg('Authentication failed during Google sign-in. Please try again.');
    } else if (errorParam === 'missing_code') {
      setErrorMsg('OAuth authorization code was missing. Please retry sign-in.');
    }

    // Check if user already has an active session
    const checkSession = async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          router.replace(redirectPath);
        }
      } catch {}
    };
    checkSession();
  }, [errorParam, router, redirectPath]);

  const handleGoogleSignIn = async () => {
    setErrorMsg(null);
    setLoading(true);

    try {
      const supabase = createClient();
      const redirectTo = `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(redirectPath)}`;

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          scopes: GOOGLE_SCOPES.join(' '),
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });

      if (error) {
        throw error;
      }
    } catch (err: any) {
      console.error('Google Sign-in Error:', err);
      setErrorMsg(err?.message || 'Failed to initialize Google authentication. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--surface, #fff8f4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem 1.5rem',
        fontFamily: "'Manrope', sans-serif",
        color: 'var(--on-surface, #231a0f)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '480px',
          background: '#ffffff',
          borderRadius: '1.25rem',
          border: '1px solid var(--outline-variant, #d1c5b6)',
          boxShadow: '0 12px 36px rgba(112, 87, 40, 0.08)',
          overflow: 'hidden',
        }}
      >
        {/* Header Ribbon */}
        <div
          style={{
            background: 'var(--surface-container, #fdebd9)',
            padding: '2.5rem 2rem 2rem 2rem',
            textAlign: 'center',
            borderBottom: '1px solid var(--outline-variant, #d1c5b6)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.25rem' }}>
            <VicariusLogo />
          </div>
          <h1
            style={{
              fontFamily: "'Noto Serif', serif",
              fontSize: '1.75rem',
              fontWeight: 700,
              color: 'var(--primary, #705728)',
              margin: '0 0 0.5rem 0',
              letterSpacing: '-0.015em',
            }}
          >
            Vicarius Agent
          </h1>
          <p
            style={{
              fontSize: '0.925rem',
              color: 'var(--on-surface-variant, #4d463a)',
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            Autonomous Academic Executive & Workflow Engine
          </p>
        </div>

        {/* Content Body */}
        <div style={{ padding: '2rem' }}>
          {errorMsg && (
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
                padding: '0.875rem 1rem',
                borderRadius: '0.75rem',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: 'var(--error, #ba1a1a)',
                fontSize: '0.85rem',
                lineHeight: 1.45,
                marginBottom: '1.5rem',
              }}
            >
              <AlertCircleIcon size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>{errorMsg}</div>
            </div>
          )}

          <div
            style={{
              background: 'var(--surface-container-high, #f7e5d4)',
              borderRadius: '0.875rem',
              padding: '1.125rem 1.25rem',
              marginBottom: '1.75rem',
              border: '1px solid var(--outline-variant, #d1c5b6)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontWeight: 600,
                fontSize: '0.85rem',
                color: 'var(--primary, #705728)',
                marginBottom: '0.5rem',
              }}
            >
              <SparklesIcon size={16} />
              Single-Consent Universal Setup
            </div>
            <p
              style={{
                margin: 0,
                fontSize: '0.815rem',
                color: 'var(--on-surface-variant, #4d463a)',
                lineHeight: 1.5,
              }}
            >
              Signing in automatically links your academic workspace with Gmail, Google Classroom, Drive, Calendar, and Tasks without manual token configuration.
            </p>
          </div>

          {/* Single Google Sign-In Action */}
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={loading}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.875rem',
              padding: '0.875rem 1.25rem',
              borderRadius: '0.75rem',
              background: '#ffffff',
              color: '#3c4043',
              border: '1px solid #dadce0',
              fontSize: '0.95rem',
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              boxShadow: '0 2px 6px rgba(60, 64, 67, 0.08)',
              transition: 'all 0.2s ease',
              opacity: loading ? 0.8 : 1,
            }}
            onMouseOver={(e) => {
              if (!loading) {
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(60, 64, 67, 0.15)';
                e.currentTarget.style.borderColor = '#d2e3fc';
                e.currentTarget.style.background = '#fafbfc';
              }
            }}
            onMouseOut={(e) => {
              if (!loading) {
                e.currentTarget.style.boxShadow = '0 2px 6px rgba(60, 64, 67, 0.08)';
                e.currentTarget.style.borderColor = '#dadce0';
                e.currentTarget.style.background = '#ffffff';
              }
            }}
          >
            {loading ? (
              <>
                <LoaderIcon size={20} className="animate-spin" style={{ color: 'var(--primary, #705728)' }} />
                <span>Redirecting to Google...</span>
              </>
            ) : (
              <>
                {/* Official Google G Logo SVG */}
                <svg width="20" height="20" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                <span>Continue with Google</span>
              </>
            )}
          </button>

          {/* Trust and privacy badges */}
          <div
            style={{
              marginTop: '2rem',
              paddingTop: '1.5rem',
              borderTop: '1px solid var(--outline-variant, #d1c5b6)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.625rem',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.785rem',
                color: 'var(--secondary, #645e4e)',
              }}
            >
              <CheckCircleIcon size={15} style={{ color: 'var(--primary, #705728)' }} />
              <span>Self-hosted & open-source single-tenant architecture</span>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.785rem',
                color: 'var(--secondary, #645e4e)',
              }}
            >
              <ShieldIcon size={15} style={{ color: 'var(--primary, #705728)' }} />
              <span>Credentials encrypted with Row-Level Security</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
