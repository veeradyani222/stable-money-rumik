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
  getDemoCallPendingRouteFromStore,
  getRequestDemoSessionId,
  markDemoCallVerifiedInStore,
  markDemoCallVerifiedMobileLastFourInStore,
} from '@/lib/session-auth';
import type { StableIntentRoute } from '@/lib/agent/stable-policy';

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

function transcriptPreview(transcript: string): string {
  const trimmed = transcript.trim().replace(/\s+/g, ' ');
  return trimmed.length > 120 ? `${trimmed.slice(0, 120)}...` : trimmed;
}

function routeLogPayload(route: StableIntentRoute | null | undefined): Record<string, unknown> | null {
  if (!route) return null;
  return {
    intent: route.intent,
    authTier: route.authTier,
    tools: route.tools,
  };
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
    const pendingRoute = verifiedMobileLast4
      ? await getDemoCallPendingRouteFromStore(pool, sessionId, callId)
      : null;
    const callVerified = await getDemoCallVerifiedFromStore(pool, sessionId, callId);
    const history = validHistory((body as { history?: unknown }).history);
    console.log('[stable-agent-api:request]', {
      session_id: sessionId,
      call_id: String(callId ?? 'default'),
      transcript_preview: transcriptPreview(transcript),
      transcript_chars: transcript.length,
      history_messages: history.length,
      call_verified: callVerified,
      verified_mobile_gate: verifiedMobileLast4 ?? null,
      pending_route: routeLogPayload(pendingRoute),
    });
    const result = await pool.query(
      `SELECT persona_id, customer_id, name, mobile_last_4, date_of_birth::text AS date_of_birth,
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
      history,
      callVerified,
      classifyUnknownIntent: true,
      toolContext: {
        createSupportTicket: (args) => createSupportTicketForSession(sessionId, args),
        sendSecureLink: (args) => sendSecureLinkForSession(sessionId, args),
        verifiedMobileLast4: verifiedMobileLast4 ?? undefined,
        pendingRoute,
        onReadAccessMobileStepVerified: (lastFour, route) => {
          return markDemoCallVerifiedMobileLastFourInStore(pool, sessionId, callId, lastFour, route);
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
