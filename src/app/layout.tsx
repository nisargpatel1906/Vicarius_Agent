import type { Metadata } from 'next';
import './globals.css';
import { VicariusLogo } from '@/components/VicariusLogo';

export const metadata: Metadata = {
  title: 'Vicarius Agent — Academic Intelligence Pipeline',
  description: 'Personal AI agent pipeline watching Gmail & Google Classroom, producing deliverables, and tracking deadlines with Quiet Luxury precision.',
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
    apple: '/icon.svg',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
          {/* Executive Academic Masthead */}
          <header
            style={{
              borderBottom: '1px solid var(--outline-variant)',
              background: 'rgba(255, 248, 244, 0.94)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              position: 'sticky',
              top: 0,
              zIndex: 50,
              padding: '14px 28px',
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
                flexWrap: 'wrap',
              }}
            >
              {/* Brand Crest & Title */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <VicariusLogo size={42} variant="crest" title="Vicarius Agent Crest" />
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <h1
                      className="font-serif"
                      style={{
                        fontSize: '1.35rem',
                        fontWeight: 700,
                        letterSpacing: '-0.01em',
                        color: 'var(--on-surface)',
                        lineHeight: 1.2,
                      }}
                    >
                      Vicarius Agent
                    </h1>
                    <span
                      className="label-caps"
                      style={{
                        background: 'var(--primary-fixed)',
                        color: 'var(--on-primary-fixed)',
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: '10px',
                        fontWeight: 700,
                      }}
                    >
                      Triple Core v1.1
                    </span>
                  </div>
                  <p
                    style={{
                      fontSize: '0.78rem',
                      color: 'var(--on-surface-variant)',
                      marginTop: 2,
                    }}
                  >
                    Cognitive Heritage Pipeline • Academic Institution • Nisarg Patel
                  </p>
                </div>
              </div>

              {/* Status Bar & Global Indicators */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
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
            </div>
          </header>

          {/* Main Content Area */}
          <main
            style={{
              flex: 1,
              padding: '32px 28px',
              maxWidth: 1440,
              margin: '0 auto',
              width: '100%',
            }}
          >
            {children}
          </main>

          {/* Executive Academic Footer */}
          <footer
            style={{
              borderTop: '1px solid var(--outline-variant)',
              background: 'rgba(255, 248, 244, 0.75)',
              padding: '22px 28px',
              marginTop: 'auto',
              fontSize: '0.8rem',
              color: 'var(--on-surface-variant)',
            }}
          >
            <div
              style={{
                maxWidth: 1440,
                margin: '0 auto',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <VicariusLogo size={20} variant="mark" fill="var(--primary)" />
                <span>
                  <strong>Vicarius Academic Task Agent</strong> &copy; 2026 • Autonomous Pipeline for Academic Institution
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <span>Standard Baseline: Asia/Kolkata (IST)</span>
                <span>•</span>
                <span>Powered by Antigravity CLI & Supabase</span>
              </div>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
