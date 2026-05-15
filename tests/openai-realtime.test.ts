import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  buildOpenAIRealtimeClientSecretRequest,
  createOpenAIRealtimeClientSecret,
  realtimeTranscriptionModelSupportsPrompt,
} from '../lib/voice/openai-realtime';

test('createOpenAIRealtimeClientSecret mints a browser-safe realtime token', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalRealtimeTranscribeModel = process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL;
  const originalSttModel = process.env.OPENAI_STT_MODEL;
  const originalUsePrompt = process.env.OPENAI_REALTIME_TRANSCRIPTION_USE_PROMPT;

  const requests: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          value: 'ek_test_secret',
          expires_at: 123456,
        }),
    } as Response;
  }) as typeof fetch;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL = 'gpt-realtime-whisper';
  process.env.OPENAI_STT_MODEL = 'gpt-4o-mini-transcribe';
  delete process.env.OPENAI_REALTIME_TRANSCRIPTION_USE_PROMPT;

  try {
    const secret = await createOpenAIRealtimeClientSecret({ safetyIdentifier: 'demo-user' });

    assert.equal(secret.value, 'ek_test_secret');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://api.openai.com/v1/realtime/client_secrets');
    assert.deepEqual(requests[0].init?.headers, {
      Authorization: 'Bearer test-openai-key',
      'Content-Type': 'application/json',
      'OpenAI-Safety-Identifier': 'demo-user',
    });

    assert.deepEqual(JSON.parse(String(requests[0].init?.body)), {
      session: {
        type: 'transcription',
        audio: {
          input: {
            transcription: {
              model: 'gpt-realtime-whisper',
            },
            turn_detection: null,
          },
        },
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL = originalRealtimeTranscribeModel;
    process.env.OPENAI_STT_MODEL = originalSttModel;
    if (originalUsePrompt === undefined) delete process.env.OPENAI_REALTIME_TRANSCRIPTION_USE_PROMPT;
    else process.env.OPENAI_REALTIME_TRANSCRIPTION_USE_PROMPT = originalUsePrompt;
  }
});

test('buildOpenAIRealtimeClientSecretRequest falls back to OPENAI_STT_MODEL when realtime model is unset', () => {
  const originalRealtimeTranscribeModel = process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL;
  const originalSttModel = process.env.OPENAI_STT_MODEL;
  const originalUsePrompt = process.env.OPENAI_REALTIME_TRANSCRIPTION_USE_PROMPT;
  delete process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL;
  process.env.OPENAI_STT_MODEL = 'gpt-4o-mini-transcribe';
  delete process.env.OPENAI_REALTIME_TRANSCRIPTION_USE_PROMPT;

  try {
    const body = buildOpenAIRealtimeClientSecretRequest();

    assert.deepEqual(body, {
      session: {
        type: 'transcription',
        audio: {
          input: {
            transcription: {
              model: 'gpt-4o-mini-transcribe',
            },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 500,
              interrupt_response: false,
              create_response: false,
            },
          },
        },
      },
    });
  } finally {
    if (originalRealtimeTranscribeModel === undefined) delete process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL;
    else process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL = originalRealtimeTranscribeModel;
    if (originalSttModel === undefined) delete process.env.OPENAI_STT_MODEL;
    else process.env.OPENAI_STT_MODEL = originalSttModel;
    if (originalUsePrompt === undefined) delete process.env.OPENAI_REALTIME_TRANSCRIPTION_USE_PROMPT;
    else process.env.OPENAI_REALTIME_TRANSCRIPTION_USE_PROMPT = originalUsePrompt;
  }
});

test('realtimeTranscriptionModelSupportsPrompt rejects gpt-* models even when name contains whisper', () => {
  delete process.env.OPENAI_REALTIME_TRANSCRIPTION_USE_PROMPT;
  assert.equal(realtimeTranscriptionModelSupportsPrompt('gpt-realtime-whisper'), false);
  assert.equal(realtimeTranscriptionModelSupportsPrompt('whisper-1'), true);
});

test('OPENAI_REALTIME_TRANSCRIPTION_USE_PROMPT=true does not force prompt on GPT realtime models', () => {
  const originalModel = process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL;
  const originalUsePrompt = process.env.OPENAI_REALTIME_TRANSCRIPTION_USE_PROMPT;
  process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL = 'gpt-realtime-whisper';
  process.env.OPENAI_REALTIME_TRANSCRIPTION_USE_PROMPT = 'true';
  try {
    assert.equal(realtimeTranscriptionModelSupportsPrompt('gpt-realtime-whisper'), false);
    const body = buildOpenAIRealtimeClientSecretRequest() as {
      session: { audio: { input: { transcription: Record<string, unknown> } } };
    };
    assert.equal('prompt' in body.session.audio.input.transcription, false);
  } finally {
    if (originalModel === undefined) delete process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL;
    else process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL = originalModel;
    if (originalUsePrompt === undefined) delete process.env.OPENAI_REALTIME_TRANSCRIPTION_USE_PROMPT;
    else process.env.OPENAI_REALTIME_TRANSCRIPTION_USE_PROMPT = originalUsePrompt;
  }
});

test('buildOpenAIRealtimeClientSecretRequest omits transcription prompt for non-Whisper models', () => {
  const originalModel = process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL;
  const originalUsePrompt = process.env.OPENAI_REALTIME_TRANSCRIPTION_USE_PROMPT;
  process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe';
  delete process.env.OPENAI_REALTIME_TRANSCRIPTION_USE_PROMPT;
  try {
    assert.equal(realtimeTranscriptionModelSupportsPrompt('gpt-4o-mini-transcribe'), false);
    const body = buildOpenAIRealtimeClientSecretRequest() as {
      session: { audio: { input: { transcription: Record<string, unknown> } } };
    };
    assert.equal(body.session.audio.input.transcription.model, 'gpt-4o-mini-transcribe');
    assert.equal('prompt' in body.session.audio.input.transcription, false);
  } finally {
    if (originalModel === undefined) delete process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL;
    else process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL = originalModel;
    if (originalUsePrompt === undefined) delete process.env.OPENAI_REALTIME_TRANSCRIPTION_USE_PROMPT;
    else process.env.OPENAI_REALTIME_TRANSCRIPTION_USE_PROMPT = originalUsePrompt;
  }
});

test('agent call client is wired for realtime transcription before agent response', () => {
  const clientSource = fs.readFileSync(
    path.join(process.cwd(), 'components', 'agent', 'AgentCallClient.tsx'),
    'utf8',
  );

  assert.match(clientSource, /\/api\/voice\/openai-realtime-token/);
  assert.match(clientSource, /RTCPeerConnection/);
  assert.match(clientSource, /conversation\.item\.input_audio_transcription\.completed/);
  assert.match(clientSource, /normalizeOpenAITranscript/);
  assert.match(clientSource, /askAgent\(utterance\)/);
  assert.match(clientSource, /realtime:sdp:error/);
});

test('openai realtime token route validates the demo session before minting a token', () => {
  const routeSource = fs.readFileSync(
    path.join(process.cwd(), 'app', 'api', 'voice', 'openai-realtime-token', 'route.ts'),
    'utf8',
  );

  assert.match(routeSource, /getRequestDemoSessionId/);
  assert.match(routeSource, /sessionResult\.ok/);
  assert.match(routeSource, /createOpenAIRealtimeClientSecret/);
  assert.ok(routeSource.indexOf('getRequestDemoSessionId') < routeSource.indexOf('createOpenAIRealtimeClientSecret'));
});

test('agent call client pipelines streamed text chunks into Rumik playback', () => {
  const clientSource = fs.readFileSync(
    path.join(process.cwd(), 'components', 'agent', 'AgentCallClient.tsx'),
    'utf8',
  );

  assert.match(clientSource, /waitForCompletion\?: boolean/);
  assert.match(clientSource, /playbackQueue = Promise\.resolve\(\)/);
  assert.match(clientSource, /playRumikText\(chunk,\s*\{\s*resetPlayback: false,\s*waitForCompletion: false,\s*timingLabel: 'answer'\s*\}\)/);
  assert.match(clientSource, /Promise\.all\(\[thinkingFillerPlayback,\s*playbackQueue\]\)/);
  assert.match(clientSource, /await waitForRumikPlaybackTurn\(\)/);
});
