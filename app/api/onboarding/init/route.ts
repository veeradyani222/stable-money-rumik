import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';

import { getPool } from '@/lib/db';
import { isValidEmail } from '@/lib/email';
import { createOnboardingSession, type OnboardingSession } from '@/lib/onboarding-session';
import { DEMO_SESSION_COOKIE } from '@/lib/session-cookie';

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Expected JSON object' }, { status: 400 });
  }

  const email = (body as { email?: unknown }).email;
  if (typeof email !== 'string' || !isValidEmail(email)) {
    return NextResponse.json({ error: 'Please enter a valid email address' }, { status: 400 });
  }

  const sessionId = randomUUID();
  const trimmedEmail = email.trim().toLowerCase();

  try {
    const pool = getPool();
    const client = await pool.connect();
    let onboardingSession: OnboardingSession;
    try {
      onboardingSession = await createOnboardingSession(client, {
        email: trimmedEmail,
        sessionId,
      });
    } finally {
      client.release();
    }
    const response = NextResponse.json({
      session_id: onboardingSession.sessionId,
      persona_id: onboardingSession.personaId,
    });
    response.cookies.set(DEMO_SESSION_COOKIE, sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24,
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Database error';
    const isMissingTable = message.includes('does not exist') || message.includes('relation "demo_users"');
    return NextResponse.json(
      {
        error: isMissingTable
          ? 'Database not ready: run migrations/001_demo_users.sql on your Postgres database'
          : 'Could not save your email. Try again in a moment.',
      },
      { status: 500 },
    );
  }
}
