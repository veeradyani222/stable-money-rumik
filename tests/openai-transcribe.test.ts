import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { OPENAI_ROMAN_TRANSCRIPT_PROMPT, transcribeOpenAIAudio } from '../lib/voice/openai-transcribe';

type CapturedRequest = { url: string; method?: string; headers?: HeadersInit; body?: BodyInit | null };

test('transcribeOpenAIAudio sends webm audio to the configured OpenAI STT model', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalSttModel = process.env.OPENAI_STT_MODEL;

  const capturedRequests: CapturedRequest[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    capturedRequests.push({
      url: String(url),
      method: init?.method,
      headers: init?.headers,
      body: init?.body,
    });

    return {
      ok: true,
      status: 200,
      json: async () => ({ text: 'haan mujhe fd status chahiye' }),
    } as Response;
  }) as typeof fetch;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_STT_MODEL = 'gpt-4o-transcribe';

  try {
    const transcript = await transcribeOpenAIAudio({
      data: Buffer.from('audio-bytes'),
      mimeType: 'audio/webm',
      filename: 'utterance.webm',
    });

    assert.equal(transcript, 'haan mujhe fd status chahiye');
    const capturedRequest = capturedRequests[0];
    assert.ok(capturedRequest);
    assert.equal(capturedRequest.url, 'https://api.openai.com/v1/audio/transcriptions');
    assert.equal(capturedRequest.method, 'POST');
    assert.deepEqual(capturedRequest.headers, { Authorization: 'Bearer test-openai-key' });
    assert.ok(capturedRequest.body instanceof FormData);
    assert.equal(capturedRequest.body.get('model'), 'gpt-4o-transcribe');
    assert.equal(capturedRequest.body.get('response_format'), 'json');
    assert.equal(capturedRequest.body.get('temperature'), '0');
    assert.match(String(capturedRequest.body.get('prompt')), /Hindi, or Hinglish/);
    assert.match(String(capturedRequest.body.get('prompt')), /Never output Devanagari, Arabic, Urdu, or Farsi script/);
    assert.ok(capturedRequest.body.get('file') instanceof File);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.OPENAI_STT_MODEL = originalSttModel;
  }
});

test('transcription prompt avoids domain-specific example phrases that can leak into output', () => {
  assert.doesNotMatch(OPENAI_ROMAN_TRANSCRIPT_PROMPT, /KYC status/i);
  assert.doesNotMatch(OPENAI_ROMAN_TRANSCRIPT_PROMPT, /kya aap mujhe mere/i);
});

test('transcribeOpenAIAudio removes leaked prompt example prefix from transcript', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;

  globalThis.fetch = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({
        text: 'Kya aap mujhe mere KYC status ke baare mein bata sakte hain? mujhe FD status batao',
      }),
    }) as Response) as typeof fetch;

  process.env.OPENAI_API_KEY = 'test-openai-key';

  try {
    const transcript = await transcribeOpenAIAudio({
      data: Buffer.from('audio-bytes'),
      mimeType: 'audio/webm',
      filename: 'utterance.webm',
    });

    assert.equal(transcript, 'mujhe FD status batao');
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalApiKey;
  }
});

test('transcribeOpenAIAudio requires OPENAI_API_KEY', async () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  try {
    await assert.rejects(
      () =>
        transcribeOpenAIAudio({
          data: Buffer.from('audio-bytes'),
          mimeType: 'audio/webm',
        }),
      /Missing required environment variable: OPENAI_API_KEY/,
    );
  } finally {
    process.env.OPENAI_API_KEY = originalApiKey;
  }
});

test('openai transcription route, helper, and call client are wired for OpenAI STT', () => {
  const helperSource = fs.readFileSync(
    path.join(process.cwd(), 'lib', 'voice', 'openai-transcribe.ts'),
    'utf8',
  );
  const routeSource = fs.readFileSync(
    path.join(process.cwd(), 'app', 'api', 'voice', 'openai-transcribe', 'route.ts'),
    'utf8',
  );
  const clientSource = fs.readFileSync(
    path.join(process.cwd(), 'components', 'agent', 'AgentCallClient.tsx'),
    'utf8',
  );

  assert.doesNotMatch(helperSource, /console\.(?:log|debug|info|warn|error)\s*\(/);
  assert.doesNotMatch(helperSource, /shouldLogDiagnosticEvent/);
  assert.doesNotMatch(helperSource, /logOpenAITranscribe\('request:prepared'/);
  assert.doesNotMatch(helperSource, /logOpenAITranscribe\('response:success'/);
  assert.doesNotMatch(routeSource, /console\.(?:log|debug|info|warn|error)\s*\(/);
  assert.doesNotMatch(routeSource, /shouldLogDiagnosticEvent/);
  assert.doesNotMatch(routeSource, /logOpenAITranscribeRoute\('request:received'/);
  assert.doesNotMatch(routeSource, /logOpenAITranscribeRoute\('response:success'/);
  assert.match(clientSource, /\/api\/voice\/openai-transcribe/);
});
