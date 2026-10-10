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
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || 'https://vicarius-agent.vercel.app'
  ),
  title: {
    default: 'Vicarius Agent — Autonomous Academic Operations & LangGraph Multi-Agent Engine',
    template: '%s | Vicarius Agent',
  },
  description:
    'Open-source autonomous AI agent pipeline watching Google Classroom & Gmail, executing verified academic deliverables via self-healing LangGraph multi-agent workflows, and presenting real-time operations in a Cognitive Heritage dashboard.',
  keywords: [
    'Autonomous AI Agent',
    'LangGraph Agent Pipeline',
    'Multi-Agent System',
    'Google Classroom Automation',
    'Gmail AI Agent',
    'Next.js 15 App Router',
    'Supabase Row-Level Security',
    'Google Antigravity Engine',
    'Self-Healing AI',
    'Reflexion Architecture',
    'Academic Task Ingestion',
    'Cognitive Heritage UI',
    'Open Source AI Operations',
  ],
  authors: [{ name: 'Nisarg Patel', url: 'https://github.com/nisargpatel1906' }],
  creator: 'Nisarg Patel',
  publisher: 'Vicarius Academic Operations',
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '32x32' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    shortcut: '/favicon.ico',
    apple: '/icon.svg',
  },
  openGraph: {
    title: 'Vicarius Agent — Autonomous Academic Operations Engine',
    description:
      'Autonomous multi-agent system monitoring Google Classroom & Gmail, synthesizing verified software projects, research papers, and slide decks via LangGraph.',
    url: 'https://github.com/nisargpatel1906/Vicarius_Agent',
    type: 'website',
    locale: 'en_US',
    siteName: 'Vicarius Agent',
    images: [
      {
        url: '/workflow-diagram.svg',
        width: 1200,
        height: 630,
        alt: 'Vicarius Agent Autonomous Pipeline Architecture',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Vicarius Agent — Autonomous Academic Operations Engine',
    description:
      'Autonomous multi-agent system monitoring Google Classroom & Gmail, synthesizing verified deliverables via LangGraph.',
    creator: '@nisargpatel1906',
    images: ['/workflow-diagram.svg'],
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

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Vicarius Agent',
    applicationCategory: 'DeveloperApplication, EducationalApplication',
    operatingSystem: 'All',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    author: {
      '@type': 'Person',
      name: 'Nisarg Patel',
      url: 'https://github.com/nisargpatel1906',
    },
    description:
      'Autonomous AI agent pipeline watching Google Classroom & Gmail, executing verified academic deliverables via self-healing LangGraph multi-agent workflows.',
    softwareVersion: '1.0.0',
    license: 'https://opensource.org/licenses/MIT',
  };

  return (
    <html lang="en">
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
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
                    <strong>Vicarius Academic Task Agent</strong> &copy; 2026 &bull; Autonomous Academic Operations Pipeline
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
