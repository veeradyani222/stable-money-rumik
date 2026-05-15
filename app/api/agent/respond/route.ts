import { NextResponse } from 'next/server';

import {
  AGENT_MAX_HISTORY_MESSAGES,
  OpenAIRequestError,
  runStableAgent,
  type AgentHistoryMessage,
} from '@/lib/agent/openai-agent';
import { createSupportTicketForSession } from '@/lib/agent/support-tickets';
import { sendSecureLinkForSession } from '@/lib/agent/secure-links';
import { getPool } from '@/lib/db';
import { buildPersonaFromDemoUserRow } from '@/lib/demo-users';
import {
  getDemoCallVerifiedFromStore,
  getDemoCallVerifiedMobileLastFourFromStore,
  getRequestDemoSessionId,
  markDemoCallVerifiedInStore,
  markDemoCallVerifiedMobileLastFourInStore,
} from '@/lib/session-auth';

function validHistory(value: unknown): AgentHistoryMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is AgentHistoryMessage => {
      if (!item || typeof item !== 'object') return false;
      const role = (item as { role?: unknown }).role;
      const text = (item as { text?: unknown }).text;
      return (role === 'user' || role === 'model') && typeof text === 'string' && text.trim().length > 0;
    })
    .slice(-AGENT_MAX_HISTORY_MESSAGES);
}

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

  const sessionResult = await getRequestDemoSessionId((body as { session_id?: unknown }).session_id);
  const transcript = (body as { transcript?: unknown }).transcript;
  if (!sessionResult.ok) {
    return NextResponse.json({ error: sessionResult.error }, { status: sessionResult.status });
  }
  if (typeof transcript !== 'string' || transcript.trim().length < 2) {
    return NextResponse.json({ error: 'Transcript is too short' }, { status: 400 });
  }

  try {
    const sessionId = sessionResult.sessionId;
    const callId = (body as { call_id?: unknown }).call_id;
    const pool = getPool();
    const verifiedMobileLast4 = await getDemoCallVerifiedMobileLastFourFromStore(pool, sessionId, callId);
    const result = await pool.query(
      `SELECT persona_id, customer_id, name, mobile_last_4, date_of_birth,
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

    const persona = buildPersonaFromDemoUserRow(result.rows[0] as Parameters<typeof buildPersonaFromDemoUserRow>[0]);
    if (!persona) {
      return NextResponse.json({ error: 'Persona not selected' }, { status: 409 });
    }

    const answer = await runStableAgent({
      persona,
      transcript: transcript.trim(),
      history: validHistory((body as { history?: unknown }).history),
      callVerified: await getDemoCallVerifiedFromStore(pool, sessionId, callId),
      classifyUnknownIntent: true,
      toolContext: {
        createSupportTicket: (args) => createSupportTicketForSession(sessionId, args),
        sendSecureLink: (args) => sendSecureLinkForSession(sessionId, args),
        verifiedMobileLast4: verifiedMobileLast4 ?? undefined,
        onReadAccessMobileStepVerified: (lastFour) => {
          return markDemoCallVerifiedMobileLastFourInStore(pool, sessionId, callId, lastFour);
        },
      },
    });
    if (answer.verified) await markDemoCallVerifiedInStore(pool, sessionId, callId);

    return NextResponse.json(answer);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not generate response';
    const status = error instanceof OpenAIRequestError ? error.status : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
