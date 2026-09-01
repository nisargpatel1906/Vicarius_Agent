import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Vicarius Agent — Autonomous Academic Task Pipeline',
  description: 'Personal AI agent pipeline watching Gmail & Google Classroom, producing deliverables, and tracking deadlines.',
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
          {/* Top Header */}
          <header style={{
            borderBottom: '1px solid var(--border-color)',
            background: 'rgba(10, 15, 29, 0.85)',
            backdropFilter: 'blur(12px)',
            position: 'sticky',
            top: 0,
            zIndex: 50,
            padding: '16px 24px',
          }}>
            <div style={{
              maxWidth: 1400,
              margin: '0 auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  background: 'linear-gradient(135deg, #0ea5e9, #6366f1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 800,
                  fontSize: 20,
                  color: '#fff',
                  boxShadow: '0 0 15px rgba(14, 165, 233, 0.5)',
                }}>
                  V
                </div>
                <div>
                  <h1 style={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.02em', color: '#fff' }}>
                    Vicarius Agent
                  </h1>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Academic Institution • Nisarg Patel
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: 'rgba(30, 41, 59, 0.6)',
                  padding: '6px 14px',
                  borderRadius: 20,
                  border: '1px solid var(--border-color)',
                  fontSize: '0.8rem',
                }}>
                  <span style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    backgroundColor: '#10b981',
                    boxShadow: '0 0 8px #10b981',
                  }} />
                  <span style={{ color: 'var(--text-secondary)' }}>System Active</span>
                </div>
              </div>
            </div>
          </header>

          {/* Main Content Area */}
          <main style={{ flex: 1, padding: '24px', maxWidth: 1400, margin: '0 auto', width: '100%' }}>
            {children}
          </main>

          {/* Footer */}
          <footer style={{
            borderTop: '1px solid var(--border-color)',
            padding: '20px 24px',
            textAlign: 'center',
            fontSize: '0.8rem',
            color: 'var(--text-muted)',
            marginTop: 'auto',
          }}>
            Vicarius Academic Task Agent &copy; 2026 • Powered by Antigravity CLI & Supabase
          </footer>
        </div>
      </body>
    </html>
  );
}
