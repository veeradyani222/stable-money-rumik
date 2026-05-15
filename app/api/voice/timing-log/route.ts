import { NextResponse } from 'next/server';

const MAX_EVENT_CHARS = 80;

function cleanString(value: unknown, maxChars: number): string {
  return typeof value === 'string' ? value.slice(0, maxChars) : '';
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;
  const event = cleanString(payload.event, MAX_EVENT_CHARS);
  if (!event) return NextResponse.json({ ok: false }, { status: 400 });

  return NextResponse.json({ ok: true });
}
