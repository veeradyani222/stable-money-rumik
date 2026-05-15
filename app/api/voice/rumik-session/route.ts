import { NextResponse } from 'next/server';

import { normalizeRumikText } from '@/lib/voice/rumik-text';

export async function POST(request: Request) {
  const apiKey = process.env.RUMIK_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Missing required environment variable: RUMIK_API_KEY' }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const text = body && typeof body === 'object' ? (body as { text?: unknown }).text : null;
  if (typeof text !== 'string' || text.trim().length < 1) {
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
  } catch {
    return NextResponse.json({ error: 'Could not reach Rumik TTS session API' }, { status: 502 });
  }

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    return NextResponse.json({ error: 'Could not create Rumik TTS session', details: data }, { status: response.status });
  }

  return NextResponse.json({
    ...data,
    text: rumikText,
  });
}
