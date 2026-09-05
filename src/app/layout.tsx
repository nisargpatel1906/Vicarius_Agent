import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import './globals.css';
import { VicariusLogo } from '@/components/VicariusLogo';
import { DashboardHeader } from '@/components/DashboardHeader';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#fff8f4',
};

export const metadata: Metadata = {
  title: {
    default: 'Vicarius Agent — Academic Intelligence Pipeline',
    template: '%s | Vicarius Agent',
  },
  description:
    'Personal autonomous AI agent pipeline watching Google Classroom & Gmail, producing verified academic deliverables with Cognitive Heritage precision.',
  keywords: [
    'Academic AI',
    'Google Classroom Agent',
    'Autonomous Pipeline',
    'Vicarius Agent',
    'Academic Institution',
    'Antigravity Engine',
  ],
  authors: [{ name: 'Nisarg Patel' }],
  creator: 'Nisarg Patel',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '32x32' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    shortcut: '/favicon.ico',
    apple: '/icon.svg',
  },
  openGraph: {
    title: 'Vicarius Agent — Academic Intelligence Pipeline',
    description:
      'Personal autonomous AI agent pipeline watching Google Classroom & Gmail, producing verified academic deliverables with Quiet Luxury precision.',
    type: 'website',
    locale: 'en_IN',
    siteName: 'Vicarius Agent',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Vicarius Agent — Academic Intelligence Pipeline',
    description:
      'Personal autonomous AI agent pipeline watching Google Classroom & Gmail, producing verified academic deliverables.',
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const token = cookieStore.get('vicarius_access_token')?.value?.trim();
  const primaryToken = process.env.DASHBOARD_ACCESS_TOKEN?.trim();
  const ingestToken = process.env.INGEST_SECRET_TOKEN?.trim();
  const validTokens = [primaryToken, ingestToken].filter(Boolean) as string[];

  // If no security tokens configured (local dev) or if authenticated via cookie
  const isAuthorized = validTokens.length === 0 || (!!token && validTokens.includes(token));

  return (
    <html lang="en">
      <body>
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', width: '100%', maxWidth: '100vw', overflowX: 'hidden' }}>
          {isAuthorized && <DashboardHeader isAuthorized={isAuthorized} />}

          {/* Main Content Area */}
          <main
            style={{
              flex: 1,
              padding: isAuthorized ? 'var(--page-padding)' : '0',
              maxWidth: isAuthorized ? 1440 : '100%',
              margin: '0 auto',
              width: '100%',
              boxSizing: 'border-box',
              display: isAuthorized ? 'block' : 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {children}
          </main>

          {isAuthorized && (
            <footer
              style={{
                borderTop: '1px solid var(--outline-variant)',
                background: 'rgba(255, 248, 244, 0.85)',
                padding: '18px var(--page-padding)',
                marginTop: 'auto',
                fontSize: '0.8rem',
                color: 'var(--on-surface-variant)',
                boxSizing: 'border-box',
                width: '100%',
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
                    <strong>Vicarius Academic Task Agent</strong> &copy; 2026 &bull; Autonomous Pipeline for Academic Institution
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                  <a
                    href="/"
                    style={{ color: 'inherit', textDecoration: 'none', fontWeight: 500 }}
                    title="Operations Dashboard"
                  >
                    Operations Command
                  </a>
                  <span>&bull;</span>
                  <a
                    href="/api/health"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'inherit', textDecoration: 'none', fontWeight: 500 }}
                    title="Inspect System Telemetry & Quotas"
                  >
                    System Health
                  </a>
                  <span>&bull;</span>
                  <span>Asia/Kolkata (IST)</span>
                </div>
              </div>
            </footer>
          )}
        </div>
      </body>
    </html>
  );
}
