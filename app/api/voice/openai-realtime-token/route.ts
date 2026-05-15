import { NextResponse } from 'next/server';

import { getRequestDemoSessionId } from '@/lib/session-auth';
import { createOpenAIRealtimeClientSecret, OpenAIRealtimeError } from '@/lib/voice/openai-realtime';

export async function POST(request: Request) {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const sessionId = body && typeof body === 'object' ? (body as { session_id?: unknown }).session_id : null;
  const sessionResult = await getRequestDemoSessionId(sessionId);
  if (!sessionResult.ok) {
    return NextResponse.json({ error: sessionResult.error }, { status: sessionResult.status });
  }
  const safetyIdentifier = `stable-demo-${sessionResult.sessionId}`;

  try {
    const clientSecret = await createOpenAIRealtimeClientSecret({ safetyIdentifier });
    return NextResponse.json({ client_secret: clientSecret.value, expires_at: clientSecret.expires_at });
  } catch (error) {
    if (error instanceof OpenAIRealtimeError) {
      console.error('[openai-realtime-token]', {
        status: error.status,
        detailsPreview: error.details.slice(0, 1000),
      });
      return NextResponse.json(
        { error: error.message, details: error.details },
        { status: error.status },
      );
    }

    return NextResponse.json({ error: 'OpenAI Realtime token failed' }, { status: 500 });
  }
}
