import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { buildPersonaBrief, getPersonaSuggestions } from '@/lib/agent/persona-suggestions';
import { getPool } from '@/lib/db';
import { buildPersonaFromDemoUserRow } from '@/lib/demo-users';
import { DEMO_SESSION_COOKIE } from '@/lib/session-cookie';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const cookieStore = await cookies();
  const sessionId = url.searchParams.get('session_id') || cookieStore.get(DEMO_SESSION_COOKIE)?.value || '';
  if (sessionId.length < 10) {
    return NextResponse.json({ error: 'Missing or invalid session_id' }, { status: 400 });
  }

  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT email, persona_id, customer_id, name, mobile_last_4, date_of_birth::text AS date_of_birth,
        kyc_status, kyc_rejection_reason, kyc_eta, kyc_next_step,
        payments, fixed_deposits, open_tickets, secure_links
       FROM demo_users
       WHERE session_id = $1
       LIMIT 1`,
      [sessionId],
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const row = result.rows[0] as { email: string } & Parameters<typeof buildPersonaFromDemoUserRow>[0];
    if (!row.persona_id) {
      return NextResponse.json({ error: 'Persona not selected yet' }, { status: 409 });
    }

    const persona = buildPersonaFromDemoUserRow(row);
    if (!persona) {
      return NextResponse.json({ error: 'Persona is not available in this build' }, { status: 404 });
    }

    return NextResponse.json({
      session_id: sessionId,
      email: row.email,
      persona,
      brief: buildPersonaBrief(persona),
      suggestions: getPersonaSuggestions(persona),
    });
  } catch {
    return NextResponse.json({ error: 'Could not load agent session' }, { status: 500 });
  }
}
