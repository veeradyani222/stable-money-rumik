import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyStableIntentWithAI,
  resetIntentClassificationCacheForTests,
  resolveStableTurnRoute,
} from '../lib/agent/intent-classifier';

test('classifyStableIntentWithAI maps fuzzy Hinglish money issues to a fixed code-owned policy', async () => {
  resetIntentClassificationCacheForTests();
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  intent: 'payment.failed',
                  auth_tier: 'Tier B',
                  confidence: 0.91,
                  reason: 'Caller says amount is stuck and FD is not visible.',
                }),
              },
            ],
          },
        ],
      }),
    } as Response;
  }) as typeof fetch;

  const result = await classifyStableIntentWithAI({
    apiKey: 'test-openai-key',
    transcript: 'mera amount atak gaya hai, FD dikh nahi raha',
    history: [],
    fetcher,
  });

  assert.deepEqual(result.route, {
    intent: 'payment.failed',
    authTier: 'Tier B',
    tools: ['verify_read_access', 'get_payment_reconciliation_status'],
  });
  assert.equal(result.accepted, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.openai.com/v1/responses');
  const body = JSON.parse(String(requests[0].init?.body));
  assert.equal(body.max_output_tokens, 8000);
  assert.equal(body.prompt_cache_key, 'stable-intent-classifier-v1');
  assert.equal(body.text.format.type, 'json_schema');
  assert.equal(body.text.format.name, 'stable_intent_classification');
  assert.equal(body.text.format.strict, true);
  assert.match(body.instructions, /any language/i);
  assert.match(body.instructions, /own semantic understanding/i);
  assert.match(body.instructions, /Do not rely on keyword matching/i);
  assert.doesNotMatch(body.input[0].content, /examples/i);
  assert.doesNotMatch(body.input[0].content, /payment debit hua but FD nahi bana/);
  assert.equal(body.input[0].content.includes('"authTier":"Tier B"'), true);
  assert.deepEqual(body.text.format.schema.properties.intent.enum, [
    'payment.failed',
    'fd.book.status',
    'fd.withdraw.premature',
    'kyc.status',
    'kyc.explainer',
    'fd.rates.compare',
    'maturity.payout.delay',
    'app.real.check',
    'ticket.status',
    'grievance.escalate',
    'support.contact',
    'payment.summary',
    'fd.summary',
    'account.overview',
    'refund.status',
    'secure.action.help',
    'conversation.goodbye',
    'unknown',
  ]);
});

test('classifyStableIntentWithAI routes caller farewell to terminal goodbye policy', async () => {
  resetIntentClassificationCacheForTests();
  const fetcher = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  intent: 'conversation.goodbye',
                  auth_tier: 'Tier A',
                  confidence: 0.94,
                  reason: 'Caller is ending the conversation.',
                }),
              },
            ],
          },
        ],
      }),
    }) as Response) as typeof fetch;

  const result = await classifyStableIntentWithAI({
    apiKey: 'test-openai-key',
    transcript: 'theek hai thanks, ab main rakhta hoon',
    history: [],
    fetcher,
  });

  assert.equal(result.accepted, true);
  assert.deepEqual(result.route, {
    intent: 'conversation.goodbye',
    authTier: 'Tier A',
    tools: [],
  });
});

test('AI classifier cannot downgrade a known intent tier or tools', async () => {
  resetIntentClassificationCacheForTests();
  const fetcher = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  intent: 'payment.failed',
                  auth_tier: 'Tier A',
                  confidence: 0.92,
                  reason: 'Wrong tier from model must not own policy.',
                }),
              },
            ],
          },
        ],
      }),
    }) as Response) as typeof fetch;

  const result = await classifyStableIntentWithAI({
    apiKey: 'test-openai-key',
    transcript: 'amount stuck',
    history: [],
    fetcher,
  });

  assert.equal(result.accepted, true);
  assert.equal(result.modelAuthTier, 'Tier A');
  assert.deepEqual(result.route, {
    intent: 'payment.failed',
    authTier: 'Tier B',
    tools: ['verify_read_access', 'get_payment_reconciliation_status'],
  });
});

test('classifyStableIntentWithAI reads structured output text from any Responses message item', async () => {
  resetIntentClassificationCacheForTests();
  const fetcher = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: 'reasoning',
            summary: [],
          },
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  intent: 'fd.book.status',
                  auth_tier: 'Tier B',
                  confidence: 0.86,
                  reason: 'Caller asks whether FD was booked.',
                }),
              },
            ],
          },
        ],
      }),
    }) as Response) as typeof fetch;

  const result = await classifyStableIntentWithAI({
    apiKey: 'test-openai-key',
    transcript: 'FD book hua kya',
    history: [],
    fetcher,
  });

  assert.equal(result.accepted, true);
  assert.deepEqual(result.route, {
    intent: 'fd.book.status',
    authTier: 'Tier B',
    tools: ['verify_read_access', 'get_fd_booking_status'],
  });
});

test('classifyStableIntentWithAI retries once when a completed classifier response has no usable JSON', async () => {
  resetIntentClassificationCacheForTests();
  let calls = 0;
  const requestBodies: Array<{ max_output_tokens?: number }> = [];
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    requestBodies.push(JSON.parse(String(init?.body)));
    return {
      ok: true,
      status: 200,
      json: async () =>
        calls === 1
          ? {
              status: 'completed',
              output: [
                {
                  type: 'reasoning',
                  summary: [],
                },
              ],
            }
          : {
              status: 'completed',
              output: [
                {
                  type: 'message',
                  content: [
                    {
                      type: 'output_text',
                      text: JSON.stringify({
                        intent: 'refund.status',
                        auth_tier: 'Tier B',
                        confidence: 0.9,
                        reason: 'Caller asks about refund ETA.',
                      }),
                    },
                  ],
                },
              ],
            },
    } as Response;
  }) as typeof fetch;

  const result = await classifyStableIntentWithAI({
    apiKey: 'test-openai-key',
    transcript: 'refund kab milega',
    history: [],
    fetcher,
  });

  assert.equal(calls, 2);
  assert.deepEqual(
    requestBodies.map((body) => body.max_output_tokens),
    [8000, 8000],
  );
  assert.equal(result.accepted, true);
  assert.deepEqual(result.route, {
    intent: 'refund.status',
    authTier: 'Tier B',
    tools: ['verify_read_access', 'get_refund_status'],
  });
});

test('classifyStableIntentWithAI handles OpenAI HTTP failures without console logging', async () => {
  resetIntentClassificationCacheForTests();
  const fetcher = (async () =>
    ({
      ok: false,
      status: 503,
      text: async () => 'upstream overloaded',
    }) as Response) as typeof fetch;

  const result = await classifyStableIntentWithAI({
    apiKey: 'test-openai-key',
    transcript: 'mujhe mere payments ke bare me batao',
    history: [{ role: 'user', text: 'hello' }],
    fetcher,
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'classifier_status_503');
});

test('resolveStableTurnRoute uses AI as the primary router even when keyword routing would match and caches the result', async () => {
  resetIntentClassificationCacheForTests();
  let calls = 0;
  const fetcher = (async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  intent: 'payment.failed',
                  auth_tier: 'Tier B',
                  confidence: 0.89,
                  reason: 'Amount stuck means payment issue.',
                }),
              },
            ],
          },
        ],
      }),
    } as Response;
  }) as typeof fetch;

  const first = await resolveStableTurnRoute({
    apiKey: 'test-openai-key',
    transcript: 'payment debit hua',
    history: [],
    fetcher,
  });
  const second = await resolveStableTurnRoute({
    apiKey: 'test-openai-key',
    transcript: 'payment debit hua',
    history: [],
    fetcher,
  });

  assert.equal(first.intent, 'payment.failed');
  assert.equal(second.intent, 'payment.failed');
  assert.equal(calls, 1);
});

test('resolveStableTurnRoute returns unknown when AI cannot accept a verification answer', async () => {
  resetIntentClassificationCacheForTests();
  let calls = 0;
  const fetcher = (async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  intent: 'unknown',
                  auth_tier: 'unknown',
                  confidence: 0.3,
                  reason: 'Just four digits without enough context.',
                }),
              },
            ],
          },
        ],
      }),
    } as Response;
  }) as typeof fetch;

  const route = await resolveStableTurnRoute({
    apiKey: 'test-openai-key',
    transcript: '1234',
    history: [
      { role: 'user', text: 'payment debit hua but FD nahi bana' },
      { role: 'model', text: 'Please confirm the last four digits of your mobile number.' },
    ],
    fetcher,
  });

  assert.equal(calls, 1);
  assert.deepEqual(route, {
    intent: 'unknown',
    authTier: 'Tier A',
    tools: [],
  });
});

test('resolveStableTurnRoute does not use local fallback for Hindi payment wording if classifier is unsure', async () => {
  resetIntentClassificationCacheForTests();
  const fetcher = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  intent: 'unknown',
                  auth_tier: 'unknown',
                  confidence: 0.2,
                  reason: 'Classifier missed the Hindi payment phrase.',
                }),
              },
            ],
          },
        ],
      }),
    }) as Response) as typeof fetch;

  const route = await resolveStableTurnRoute({
    apiKey: 'test-openai-key',
    transcript: 'मेरा पेमेंट फेल हो गया है।',
    history: [],
    fetcher,
  });

  assert.deepEqual(route, {
    intent: 'unknown',
    authTier: 'Tier A',
    tools: [],
  });
});

test('resolveStableTurnRoute does not use local fallback for Urdu-script payment wording if classifier is unsure', async () => {
  resetIntentClassificationCacheForTests();
  const fetcher = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  intent: 'unknown',
                  auth_tier: 'unknown',
                  confidence: 0.2,
                  reason: 'Classifier missed the Urdu-script payment phrase.',
                }),
              },
            ],
          },
        ],
      }),
    }) as Response) as typeof fetch;

  const route = await resolveStableTurnRoute({
    apiKey: 'test-openai-key',
    transcript: 'میرا پیمنٹ فیل ہو گیا ہے۔',
    history: [],
    fetcher,
  });

  assert.deepEqual(route, {
    intent: 'unknown',
    authTier: 'Tier A',
    tools: [],
  });
});

test('classifyStableIntentWithAI routes payment.summary when caller asks for general payment overview', async () => {
  resetIntentClassificationCacheForTests();
  const fetcher = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  intent: 'payment.summary',
                  auth_tier: 'Tier B',
                  confidence: 0.88,
                  reason: 'Caller asking for payment history and status overview without issue framing.',
                }),
              },
            ],
          },
        ],
      }),
    }) as Response) as typeof fetch;

  const result = await classifyStableIntentWithAI({
    apiKey: 'test-openai-key',
    transcript: 'mujhe mere payments ke bare me batao',
    history: [],
    fetcher,
  });

  assert.equal(result.accepted, true);
  assert.deepEqual(result.route, {
    intent: 'payment.summary',
    authTier: 'Tier B',
    tools: ['verify_read_access', 'get_payment_summary'],
  });
});

test('classifyStableIntentWithAI routes fd.summary when caller asks for FD overview', async () => {
  resetIntentClassificationCacheForTests();
  const fetcher = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  intent: 'fd.summary',
                  auth_tier: 'Tier B',
                  confidence: 0.92,
                  reason: 'Caller asking for list of all FDs and deposit details.',
                }),
              },
            ],
          },
        ],
      }),
    }) as Response) as typeof fetch;

  const result = await classifyStableIntentWithAI({
    apiKey: 'test-openai-key',
    transcript: 'meri FDs batao',
    history: [],
    fetcher,
  });

  assert.equal(result.accepted, true);
  assert.deepEqual(result.route, {
    intent: 'fd.summary',
    authTier: 'Tier B',
    tools: ['verify_read_access', 'get_fd_summary'],
  });
});

test('classifyStableIntentWithAI routes account.overview when caller asks for general account status', async () => {
  resetIntentClassificationCacheForTests();
  const fetcher = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  intent: 'account.overview',
                  auth_tier: 'Tier A',
                  confidence: 0.85,
                  reason: 'Caller asking for general account snapshot and what they have.',
                }),
              },
            ],
          },
        ],
      }),
    }) as Response) as typeof fetch;

  const result = await classifyStableIntentWithAI({
    apiKey: 'test-openai-key',
    transcript: 'mera account batao',
    history: [],
    fetcher,
  });

  assert.equal(result.accepted, true);
  assert.deepEqual(result.route, {
    intent: 'account.overview',
    authTier: 'Tier A',
    tools: ['get_account_overview'],
  });
});

test('classifyStableIntentWithAI routes refund.status when caller asks when refund will arrive', async () => {
  resetIntentClassificationCacheForTests();
  const fetcher = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  intent: 'refund.status',
                  auth_tier: 'Tier B',
                  confidence: 0.9,
                  reason: 'Caller asking about refund timing and ETA.',
                }),
              },
            ],
          },
        ],
      }),
    }) as Response) as typeof fetch;

  const result = await classifyStableIntentWithAI({
    apiKey: 'test-openai-key',
    transcript: 'refund kab aayega',
    history: [],
    fetcher,
  });

  assert.equal(result.accepted, true);
  assert.deepEqual(result.route, {
    intent: 'refund.status',
    authTier: 'Tier B',
    tools: ['verify_read_access', 'get_refund_status'],
  });
});

test('classifyStableIntentWithAI routes secure.action.help when caller wants to change account details', async () => {
  resetIntentClassificationCacheForTests();
  const fetcher = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  intent: 'secure.action.help',
                  auth_tier: 'Tier C',
                  confidence: 0.87,
                  reason: 'Caller requesting mobile number change, requires secure link.',
                }),
              },
            ],
          },
        ],
      }),
    }) as Response) as typeof fetch;

  const result = await classifyStableIntentWithAI({
    apiKey: 'test-openai-key',
    transcript: 'mobile number change karna hai',
    history: [],
    fetcher,
  });

  assert.equal(result.accepted, true);
  assert.deepEqual(result.route, {
    intent: 'secure.action.help',
    authTier: 'Tier C',
    tools: ['send_secure_link', 'create_support_ticket'],
  });
});

