import { NextResponse } from 'next/server';

import { getDeepgramGrantErrorMessage } from '@/lib/voice/deepgram-token';

export async function POST() {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Missing required environment variable: DEEPGRAM_API_KEY' }, { status: 500 });
  }

  const response = await fetch('https://api.deepgram.com/v1/auth/grant', {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ttl_seconds: 120 }),
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    return NextResponse.json(
      { error: getDeepgramGrantErrorMessage(response.status, data), details: data },
      { status: response.status },
    );
  }

  return NextResponse.json(data);
}
