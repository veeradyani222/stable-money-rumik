import { NextResponse } from 'next/server';

import { normalizeRumikText } from '@/lib/voice/rumik-text';

export async function POST(request: Request) {
  const apiKey = process.env.RUMIK_API_KEY;
  if (!apiKey) {
    console.error('[rumik-session]', {
      at: new Date().toISOString(),
      event: 'config:missing-api-key',
    });
    return NextResponse.json({ error: 'Missing required environment variable: RUMIK_API_KEY' }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    console.error('[rumik-session]', {
      at: new Date().toISOString(),
      event: 'request:invalid-json',
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const text = body && typeof body === 'object' ? (body as { text?: unknown }).text : null;
  if (typeof text !== 'string' || text.trim().length < 1) {
    console.error('[rumik-session]', {
      at: new Date().toISOString(),
      event: 'request:missing-text',
      body_type: typeof body,
    });
    return NextResponse.json({ error: 'Missing text' }, { status: 400 });
  }

  const baseUrl = process.env.RUMIK_BASE_URL || 'https://silk-api.rumik.ai';
  const rumikText = normalizeRumikText(text).slice(0, 2000);
  const model = process.env.RUMIK_TTS_MODEL || 'muga';
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/v1/tts/ws-connect`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: rumikText,
        model,
      }),
    });
  } catch (error) {
    console.error('[rumik-session]', {
      at: new Date().toISOString(),
      event: 'fetch:error',
      base_url: baseUrl,
      model,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Could not reach Rumik TTS session API' }, { status: 502 });
  }

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    console.error('[rumik-session]', {
      at: new Date().toISOString(),
      event: 'response:error',
      status: response.status,
      details: data,
    });
    return NextResponse.json({ error: 'Could not create Rumik TTS session', details: data }, { status: response.status });
  }

  return NextResponse.json({
    ...data,
    text: rumikText,
  });
}
