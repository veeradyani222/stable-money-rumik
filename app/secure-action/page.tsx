import React from 'react';

interface SecureActionPageProps {
  searchParams: Promise<{
    action?: string;
    fd_id?: string;
  }>;
}

function humanize(value: string | undefined): string {
  return (value || 'secure action').replaceAll('_', ' ');
}

export default async function SecureActionPage({ searchParams }: SecureActionPageProps) {
  const params = await searchParams;
  const action = humanize(params.action);
  const fdId = params.fd_id?.trim();

  return (
    <main style={{ minHeight: '100vh', padding: '48px 20px', background: '#f7f4ef', color: '#171717' }}>
      <section style={{ maxWidth: 680, margin: '0 auto' }}>
        <p style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: '#4f6f52' }}>Stable Money</p>
        <h1 style={{ margin: '0 0 16px', fontSize: 36, lineHeight: 1.1, letterSpacing: 0 }}>Secure action</h1>
        <p style={{ margin: '0 0 24px', fontSize: 18, lineHeight: 1.6 }}>
          Continue with {action}
          {fdId ? ` for ${fdId}` : ''}.
        </p>
        <div style={{ border: '1px solid #d8d2c8', borderRadius: 8, padding: 20, background: '#ffffff' }}>
          <p style={{ margin: 0, lineHeight: 1.6 }}>
            This demo page confirms the secure link opened correctly. The sensitive action is intentionally not
            completed on the voice call.
          </p>
        </div>
      </section>
    </main>
  );
}
