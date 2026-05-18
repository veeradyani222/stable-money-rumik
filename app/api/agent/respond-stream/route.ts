import { NextResponse } from 'next/server';

import {
  AGENT_MAX_HISTORY_MESSAGES,
  OpenAIRequestError,
  streamStableAgentText,
  type AgentHistoryMessage,
} from '@/lib/agent/openai-agent';
import { createSupportTicketForSession } from '@/lib/agent/support-tickets';
import { sendSecureLinkForSession } from '@/lib/agent/secure-links';
import type { StableIntentRoute } from '@/lib/agent/stable-policy';
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
import { createSseWriter } from './sse';

function getTurnPolicyFromRoute(input: {
  route: StableIntentRoute;
  callVerified: boolean;
  verifiedMobileLast4: string | null;
}) {
  const { route } = input;
  const isTerminalGoodbye = route.intent === 'conversation.goodbye';
  return {
    suppressFiller: isTerminalGoodbye,
    endCallAfterResponse: isTerminalGoodbye,
  };
}

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
    const pendingRoute = verifiedMobileLast4
      ? await getDemoCallPendingRouteFromStore(pool, sessionId, callId)
      : null;
    const callVerified = await getDemoCallVerifiedFromStore(pool, sessionId, callId);
    const history = validHistory((body as { history?: unknown }).history);
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

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const writer = createSseWriter(controller);
        try {
          writer.send('ready', { ok: true });
          const answer = await streamStableAgentText(
            {
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
            },
            (delta) => {
              writer.send('delta', { delta });
            },
            (debugEvent) => {
              if (debugEvent.type === 'timing') {
                writer.send('timing', debugEvent.timing);
              } else if (debugEvent.type === 'route') {
                writer.send('route', debugEvent.route);
                const turnPolicy = {
                  event: 'policy',
                  data: getTurnPolicyFromRoute({
                    route: debugEvent.route,
                    callVerified,
                    verifiedMobileLast4,
                  }),
                };
                writer.send(turnPolicy.event, turnPolicy.data);
              } else if (debugEvent.type === 'stream') {
                writer.send('stream', debugEvent.event);
              } else {
                writer.send('tool', debugEvent.tool);
              }
            },
          );
          if (answer.verified) await markDemoCallVerifiedInStore(pool, sessionId, callId);
          writer.send('done', answer);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Could not generate response';
          const status = error instanceof OpenAIRequestError ? error.status : 500;
          writer.send('error', { error: message, status });
        } finally {
          writer.sendRaw(new TextEncoder().encode('event: close\ndata: {}\n\n'));
          writer.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'Content-Type': 'text/event-stream; charset=utf-8',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not generate response';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
