import test from 'node:test';
import assert from 'node:assert/strict';

import { getPersonaById } from '../lib/personas';
import {
  buildOpenAIResponseRequest,
  extractOpenAIText,
  runStableAgent,
  streamStableAgentText,
} from '../lib/agent/openai-agent';
import { stableToolDeclarations } from '../lib/agent/stable-tools';
import { getStableIntentPolicy, type StableIntentId, type StableIntentRoute } from '../lib/agent/stable-policy';

function testRoute(intent: Exclude<StableIntentId, 'unknown'>): StableIntentRoute {
  return {
    intent,
    ...getStableIntentPolicy(intent),
  };
}

test('buildOpenAIResponseRequest includes persona context, tools, and short-call rules', () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const request = buildOpenAIResponseRequest({
    persona,
    transcript: 'My money was debited but FD is not visible.',
    history: [],
    route: testRoute('payment.failed'),
  });

  assert.match(request.instructions, /Hinglish/);
  assert.match(request.instructions, /Do not ask.*OTP/i);
  assert.match(request.instructions, /Demo verification/i);
  assert.match(request.instructions, /Every call starts unverified/i);
  assert.match(request.instructions, /Ask only for the registered mobile number last four digits on this turn/i);
  assert.match(request.instructions, /verify_read_access/i);
  assert.match(request.instructions, /get_payment_reconciliation_status/i);
  assert.match(request.instructions, /get_fd_booking_status/i);
  assert.match(request.instructions, /Do not ask for date of birth in the same reply as the mobile last-four request/i);
  assert.match(request.instructions, /Ask for date of birth only after the mobile last-four step has matched/i);
  assert.match(request.instructions, /Apni date of birth batayein/i);
  assert.match(request.instructions, /Never say DOB/i);
  assert.match(request.instructions, /mobile_step_verified/i);
  assert.match(request.instructions, /Never ask for a specific date format/i);
  assert.doesNotMatch(JSON.stringify(request), /Kripya DOB batayein|YYYY-MM-DD|YYYY dash MM dash DD|preferably/i);
  assert.doesNotMatch(request.instructions, /paidaish ki ek readable tareekh|rigid format follow/i);
  assert.match(request.instructions, /Remember the caller's original question/i);
  assert.match(request.instructions, /Do not use account tools/i);
  assert.match(request.instructions, /Fixed auth tier routing is owned by code/i);
  assert.match(request.instructions, /Main samajh sakti hoon ki aap pareshan hain\. Main abhi status check karke batati hoon\./);
  assert.match(request.instructions, /Main rates compare karne mein help kar sakti hoon, par main koi ek specific FD recommend nahi kar sakti\./);
  assert.match(request.instructions, /Understand-then-act policy/i);
  assert.match(request.instructions, /Abhi yeh detail nahi nikal pa rahi/);
  assert.doesNotMatch(request.instructions, /Main yahan guess nahi karna chahti/i);
  assert.match(request.instructions, /Never mention internal mechanics/i);
  assert.match(request.instructions, /aapka paisa safe hai/);
  assert.match(request.instructions, /worst case mein refund mil jayega, koi loss nahi hoga/);
  assert.match(request.instructions, /Never repeat the welcome, recording notice, or menu of things you can help with/i);
  assert.match(request.instructions, /For task turns, answer directly without restarting the call opening/i);
  assert.match(request.instructions, /answer only what the caller asked/i);
  assert.match(request.instructions, /do not repeat unrelated records/i);
  assert.doesNotMatch(request.instructions, /Namaste, Stable Money support par aapka swagat hai/i);
  assert.match(request.instructions, /Do not wait for the caller to speak first/i);
  assert.match(request.instructions, /Hard Rumik speech output rule/i);
  assert.match(request.instructions, /never contains semicolons, forward slashes, backslashes, brackets, or numeric digits/i);
  assert.match(request.instructions, /If any forbidden character or digit appears in your draft, rewrite the draft before answering/i);
  assert.match(request.instructions, /Official prompting guide from the Rumik team/i);
  assert.match(request.instructions, /Prompting guide/i);
  assert.doesNotMatch(request.instructions, /Voice output will be synthesized by Rumik Silk Muga/i);
  assert.doesNotMatch(request.instructions, /After the required leading tone tag/i);
  assert.doesNotMatch(request.instructions, /Rumik-friendly spoken form/i);
  assert.doesNotMatch(request.instructions, /Ananya Sharma/);
  assert.doesNotMatch(request.instructions, /cust_demo_001/);
  assert.doesNotMatch(request.instructions, /PAY-8831 from HDFC/);
  assert.doesNotMatch(request.instructions, /FD-8110 with/);
  assert.doesNotMatch(request.instructions, /₹50,000/);
  assert.doesNotMatch(request.instructions, /TKT-10031/);
  assert.doesNotMatch(request.instructions, /Shriram Finance/);
  assert.match(request.instructions, /Selected demo persona is available only for verification and tool execution/i);
  assert.equal(request.max_output_tokens, 8000);
  assert.deepEqual(request.tools?.map((tool) => tool.name), ['verify_read_access']);
  const lastInput = request.input.at(-1);
  assert.ok(lastInput && 'role' in lastInput);
  assert.equal(lastInput.role, 'user');
});

test('buildOpenAIResponseRequest routes Tier A turns without verification prompts', () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const request = buildOpenAIResponseRequest({
    persona,
    transcript: '12 months ke FD rates compare kar do',
    history: [],
    route: testRoute('fd.rates.compare'),
  });

  assert.match(request.instructions, /Current turn route: fd\.rates\.compare, Tier A/i);
  assert.match(request.instructions, /This turn can be answered without caller verification/i);
  assert.doesNotMatch(request.instructions, /After the first caller message.*last four digits/i);
});

test('buildOpenAIResponseRequest gives explicit Tier B verification instructions', () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const request = buildOpenAIResponseRequest({
    persona,
    transcript: 'Mera payment debit hua but FD nahi bana',
    history: [],
    route: testRoute('payment.failed'),
  });

  assert.match(request.instructions, /Current turn route: payment\.failed, Tier B/i);
  assert.match(request.instructions, /Current turn is Tier B and caller is not verified/i);
  assert.match(request.instructions, /Ask only for the registered mobile number last four digits on this turn/i);
  assert.match(request.instructions, /Do not ask for date of birth in the same reply as the mobile last-four request/i);
  assert.match(request.instructions, /After verification, answer the original request using the allowed account tool/i);
  assert.doesNotMatch(request.instructions, /This current turn is Tier B, so verify read access/i);
});

test('buildOpenAIResponseRequest keeps mobile last-four follow-up on the original account route', () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const request = buildOpenAIResponseRequest({
    persona,
    transcript: '3210',
    history: [
      { role: 'user', text: 'Meri FD details batao' },
      { role: 'model', text: '[neutral] Verification ke liye mobile number ke last four digits bata dijiye.' },
    ],
    route: testRoute('fd.summary'),
  });

  assert.match(request.instructions, /Current turn route: fd\.summary, Tier B/i);
  assert.match(request.instructions, /Allowed tools: verify_read_access, get_fd_summary/i);
  assert.match(request.instructions, /When the caller gives last four digits, call verify_read_access/i);
  assert.match(request.instructions, /After verification, answer the original request using the allowed account tool/i);
});

test('buildOpenAIResponseRequest keeps verify_read_access available while DOB verification is in progress', () => {
  const persona = getPersonaById('cust_demo_003');
  assert.ok(persona);

  const request = buildOpenAIResponseRequest({
    persona,
    transcript: 'November 9 1995',
    history: [
      { role: 'user', text: 'Double five nine eight.' },
      { role: 'model', text: '[neutral] Mobile last four match ho gaya. Kripya date of birth batayein.' },
    ],
    route: { intent: 'unknown', authTier: 'Tier A', tools: [] },
    toolContext: { verifiedMobileLast4: '5598' },
  });

  assert.deepEqual(request.tools?.map((tool) => tool.name), ['verify_read_access']);
  assert.match(request.instructions, /Verification is already in progress/i);
  assert.match(request.instructions, /call verify_read_access again/i);
});

test('buildOpenAIResponseRequest keeps retrying DOB after a DOB mismatch without restarting mobile verification', () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const request = buildOpenAIResponseRequest({
    persona,
    transcript: '14 August 1991',
    history: [
      { role: 'user', text: 'Mera payment status batao' },
      { role: 'model', text: '[neutral] Verification ke liye mobile number ke last four digits bata dijiye.' },
      { role: 'user', text: '3210' },
      { role: 'model', text: '[neutral] Mobile last four match ho gaya. Kripya date of birth batayein.' },
      { role: 'user', text: '1992-08-14' },
      { role: 'model', text: '[neutral] Date of birth match nahi hua. Kripya ek baar phir date of birth batayein.' },
    ],
    route: { intent: 'unknown', authTier: 'Tier A', tools: [] },
    toolContext: { verifiedMobileLast4: '3210' },
  });

  assert.deepEqual(request.tools?.map((tool) => tool.name), ['verify_read_access']);
  assert.match(request.instructions, /Verification is already in progress/i);
  assert.match(request.instructions, /Treat the latest caller turn as the date of birth answer/i);
});

test('streamStableAgentText reuses the matched mobile last four after a DOB mismatch', async () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_AGENT_MODEL;

  const firstStream = new TextEncoder().encode(
    [
      'event: response.output_item.added',
      'data: {"type":"response.output_item.added","item":{"type":"function_call","call_id":"call_verify","name":"verify_read_access","arguments":""}}',
      '',
      'event: response.function_call_arguments.done',
      'data: {"type":"response.function_call_arguments.done","item":{"type":"function_call","call_id":"call_verify","name":"verify_read_access","arguments":"{\\"mobile_last_4\\":\\"1992\\",\\"date_of_birth\\":\\"\\"}"}}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed"}',
      '',
    ].join('\n'),
  );
  const secondStream = new TextEncoder().encode(
    [
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"[neutral] Date of birth match ho gaya. Verification complete hai."}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed"}',
      '',
    ].join('\n'),
  );

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    return {
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(body.input.some((item: { type?: string }) => item.type === 'function_call_output') ? secondStream : firstStream);
          controller.close();
        },
      }),
    } as Response;
  }) as typeof fetch;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_AGENT_MODEL = 'gpt-5.1-mini';

  try {
    const debugEvents: unknown[] = [];
    const result = await streamStableAgentText(
      {
        persona,
        transcript: '14 August 1991',
        history: [
          { role: 'user', text: 'Mera payment status batao' },
          { role: 'model', text: '[neutral] Verification ke liye mobile number ke last four digits bata dijiye.' },
          { role: 'user', text: '3210' },
          { role: 'model', text: '[neutral] Mobile last four match ho gaya. Kripya date of birth batayein.' },
          { role: 'user', text: '1992-08-14' },
          { role: 'model', text: '[neutral] Date of birth match nahi hua. Kripya ek baar phir date of birth batayein.' },
        ],
        route: testRoute('payment.failed'),
        toolContext: { verifiedMobileLast4: '3210' },
      },
      () => {},
      (event) => debugEvents.push(event),
    );

    assert.equal(result.verified, true);
    assert.match(JSON.stringify(debugEvents), /"mobile_last_4":"3210"/);
    assert.doesNotMatch(JSON.stringify(debugEvents), /"mobile_last_4":"1992"/);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.OPENAI_AGENT_MODEL = originalModel;
  }
});

test('buildOpenAIResponseRequest compacts long call history while preserving the original user intent', () => {
  const persona = getPersonaById('cust_demo_004');
  assert.ok(persona);

  const request = buildOpenAIResponseRequest({
    persona,
    transcript: 'Account change karna hai',
    history: [
      { role: 'user', text: 'Mujhe bank account change karna hai because my old account is closed and I need help urgently.' },
      { role: 'model', text: '[neutral] Main help karti hoon.' },
      { role: 'user', text: 'Middle one' },
      { role: 'model', text: '[neutral] Middle two' },
      { role: 'user', text: 'Middle three' },
      { role: 'model', text: '[neutral] Middle four' },
      { role: 'user', text: 'Recent user one' },
      { role: 'model', text: '[neutral] Recent model one' },
      { role: 'user', text: 'Recent user two' },
      { role: 'model', text: '[neutral] Recent model two' },
    ],
    route: testRoute('secure.action.help'),
  });

  const messageInputs = request.input.filter((item): item is { role: 'user' | 'assistant'; content: string } => 'role' in item);
  assert.deepEqual(
    messageInputs.map((item) => item.content),
    [
      'Mujhe bank account change karna hai because my old account is closed and I need help urgently.',
      '[neutral] Main help karti hoon.',
      'Middle one',
      '[neutral] Middle two',
      'Middle three',
      '[neutral] Middle four',
      'Recent user one',
      '[neutral] Recent model one',
      'Recent user two',
      '[neutral] Recent model two',
      'Account change karna hai',
    ],
  );
  assert.doesNotMatch(JSON.stringify(request.input), /Earlier user intent/i);
});

test('buildOpenAIResponseRequest gives explicit Tier C secure-action instructions', () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const request = buildOpenAIResponseRequest({
    persona,
    transcript: 'Meri FD premature withdraw kar do',
    history: [],
    route: testRoute('fd.withdraw.premature'),
  });

  assert.match(request.instructions, /Current turn route: fd\.withdraw\.premature, Tier C/i);
  assert.match(request.instructions, /Current turn is Tier C and caller is not verified/i);
  assert.match(request.instructions, /Do not execute the sensitive action on voice/i);
  assert.match(request.instructions, /prepare secure link or ticket/i);
  assert.doesNotMatch(request.instructions, /This current turn is Tier C, so verify read access/i);
});

test('agent prompt and tool declarations require real email side effects for tickets and secure links', () => {
  const persona = getPersonaById('cust_demo_004');
  assert.ok(persona);

  const request = buildOpenAIResponseRequest({
    persona,
    transcript: 'Raise a complaint and send me the secure withdrawal link',
    history: [],
    callVerified: true,
    route: testRoute('fd.withdraw.premature'),
  });
  const createTicket = stableToolDeclarations.find((tool) => tool.name === 'create_support_ticket');
  const secureLink = stableToolDeclarations.find((tool) => tool.name === 'send_secure_link');

  assert.match(createTicket?.description ?? '', /email/i);
  assert.match(secureLink?.description ?? '', /email/i);
  assert.match(request.instructions, /call create_support_ticket/i);
  assert.match(request.instructions, /complaints, escalations, grievances/i);
  assert.match(request.instructions, /call send_secure_link/i);
  assert.match(request.instructions, /send_secure_link succeeds with email_pending: true/i);
  assert.match(request.instructions, /email_pending: true/i);
  assert.match(request.instructions, /Confirmation email thodi der mein aa jayega/i);
});

test('agent prompt requires issue context before creating a support ticket', () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const request = buildOpenAIResponseRequest({
    persona,
    transcript: 'Support ticket create kar do',
    history: [],
    route: {
      intent: 'unknown',
      authTier: 'Tier A/B',
      tools: ['create_support_ticket'],
    },
  });

  assert.match(request.instructions, /If the caller only asks to create a support ticket/i);
  assert.match(request.instructions, /ask what issue/i);
  assert.match(request.instructions, /do not call create_support_ticket yet/i);
  assert.match(request.instructions, /Main samajh gayi/i);
  assert.match(request.instructions, /create kar deti hoon/i);
  assert.match(request.instructions, /Confirmation email thodi der mein aa jayega/i);
});

test('agent keeps support ticket creation active after asking what issue the ticket is for', () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const request = buildOpenAIResponseRequest({
    persona,
    transcript: 'Actually, my KYC has been rejected and I gave the right documents, so please help me.',
    history: [
      { role: 'user', text: 'Support ticket create kar do' },
      { role: 'model', text: '[neutral] Theek hai, bataiye ticket kis issue ke liye create karu?' },
    ],
    route: testRoute('kyc.status'),
  });

  assert.deepEqual(request.tools?.map((tool) => tool.name), ['create_support_ticket']);
  assert.match(request.instructions, /Caller is answering what issue the support ticket is for/i);
  assert.match(request.instructions, /Do not switch this turn into a KYC status lookup/i);
});

test('buildOpenAIResponseRequest keeps verified callers behind tool-only account reads', () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const request = buildOpenAIResponseRequest({
    persona,
    transcript: 'Ab meri FD details batao',
    history: [],
    callVerified: true,
    route: testRoute('fd.summary'),
  });

  assert.match(request.instructions, /Call verification status: verified/i);
  assert.match(request.instructions, /Do not ask.*phone number.*date of birth again/i);
  assert.match(request.instructions, /For Tier B account-specific turns, use the allowed account tool/i);
  assert.match(request.instructions, /Caller is verified for the selected demo customer/i);
  assert.match(request.instructions, /Use account tools for all account-specific details/i);
  assert.deepEqual(request.tools?.map((tool) => tool.name), ['get_fd_summary']);
  assert.doesNotMatch(request.instructions, /Ananya Sharma/);
  assert.doesNotMatch(request.instructions, /cust_demo_001/);
  assert.doesNotMatch(request.instructions, /PAY-8831 from HDFC/);
  assert.doesNotMatch(request.instructions, /FD-8110 with/);
  assert.doesNotMatch(request.instructions, /â‚¹50,000/);
  assert.doesNotMatch(request.instructions, /TKT-10031/);
  assert.doesNotMatch(request.instructions, /Shriram Finance/);
  assert.doesNotMatch(request.instructions, /After the first caller message.*last four digits/i);
});

test('streamStableAgentText does not treat a spoken last-four answer as date of birth', async () => {
  const persona = getPersonaById('cust_demo_003');
  assert.ok(persona);

  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_AGENT_MODEL;

  const firstStream = new TextEncoder().encode(
    [
      'event: response.output_item.added',
      'data: {"type":"response.output_item.added","item":{"type":"function_call","call_id":"call_verify","name":"verify_read_access","arguments":""}}',
      '',
      'event: response.function_call_arguments.done',
      'data: {"type":"response.function_call_arguments.done","item":{"type":"function_call","call_id":"call_verify","name":"verify_read_access","arguments":"{\\"mobile_last_4\\":\\"5598\\",\\"date_of_birth\\":\\"Double five nine eight.\\"}"}}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed"}',
      '',
    ].join('\n'),
  );
  const secondStream = new TextEncoder().encode(
    [
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"[neutral] Mobile last four match ho gaya. Kripya date of birth batayein."}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed"}',
      '',
    ].join('\n'),
  );

  const bodies: unknown[] = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return {
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(bodies.length === 1 ? firstStream : secondStream);
          controller.close();
        },
      }),
    } as Response;
  }) as typeof fetch;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_AGENT_MODEL = 'gpt-5.1-mini';

  try {
    const debugEvents: unknown[] = [];
    const result = await streamStableAgentText(
      {
        persona,
        transcript: 'Double five nine eight.',
        history: [
          { role: 'user', text: 'Meri FD details batao' },
          { role: 'model', text: '[neutral] Verification ke liye mobile number ke last four digits bata dijiye.' },
        ],
        route: testRoute('fd.summary'),
      },
      () => {},
      (event) => debugEvents.push(event),
    );

    assert.equal(result.verified, false);
    assert.equal(result.text, '[neutral] Mobile last four match ho gaya. Apni date of birth batayein.');
    assert.match(JSON.stringify(debugEvents), /"mobile_last_4":"5598"/);
    assert.doesNotMatch(JSON.stringify(debugEvents), /date_of_birth/);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.OPENAI_AGENT_MODEL = originalModel;
  }
});

test('streamStableAgentText does not fill empty DOB args from a spoken last-four transcript', async () => {
  const persona = getPersonaById('cust_demo_003');
  assert.ok(persona);

  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_AGENT_MODEL;

  const firstStream = new TextEncoder().encode(
    [
      'event: response.output_item.added',
      'data: {"type":"response.output_item.added","item":{"type":"function_call","call_id":"call_verify","name":"verify_read_access","arguments":""}}',
      '',
      'event: response.function_call_arguments.done',
      'data: {"type":"response.function_call_arguments.done","item":{"type":"function_call","call_id":"call_verify","name":"verify_read_access","arguments":"{\\"mobile_last_4\\":\\"5598\\",\\"date_of_birth\\":\\"\\"}"}}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed"}',
      '',
    ].join('\n'),
  );
  const secondStream = new TextEncoder().encode(
    [
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"[neutral] Mobile last four match ho gaya. Kripya date of birth batayein."}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed"}',
      '',
    ].join('\n'),
  );

  const bodies: unknown[] = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return {
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(bodies.length === 1 ? firstStream : secondStream);
          controller.close();
        },
      }),
    } as Response;
  }) as typeof fetch;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_AGENT_MODEL = 'gpt-5.1-mini';

  try {
    const debugEvents: unknown[] = [];
    const result = await streamStableAgentText(
      {
        persona,
        transcript: 'Double five nine eight.',
        history: [
          { role: 'user', text: 'Meri FD details batao' },
          { role: 'model', text: '[neutral] Verification ke liye mobile number ke last four digits bata dijiye.' },
        ],
        route: testRoute('fd.summary'),
      },
      () => {},
      (event) => debugEvents.push(event),
    );

    assert.equal(result.verified, false);
    assert.equal(result.text, '[neutral] Mobile last four match ho gaya. Apni date of birth batayein.');
    assert.match(JSON.stringify(debugEvents), /"mobile_last_4":"5598"/);
    assert.doesNotMatch(JSON.stringify(debugEvents), /date_of_birth/);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.OPENAI_AGENT_MODEL = originalModel;
  }
});

test('buildOpenAIResponseRequest exposes FD summary tool after verification', () => {
  const persona = getPersonaById('cust_demo_003');
  assert.ok(persona);

  const request = buildOpenAIResponseRequest({
    persona,
    transcript: 'Meri FD batao',
    history: [],
    callVerified: true,
    route: testRoute('fd.summary'),
  });

  assert.deepEqual(request.tools?.map((tool) => tool.name), ['get_fd_summary']);
  assert.match(request.instructions, /Call verification status: verified/i);
});

test('buildOpenAIResponseRequest exposes account read tools without model-filled lookup args', () => {
  const persona = getPersonaById('cust_demo_003');
  assert.ok(persona);

  const unverifiedRequest = buildOpenAIResponseRequest({
    persona,
    transcript: 'Mera FD status batao',
    history: [],
    route: testRoute('fd.book.status'),
  });

  const verifyTool = unverifiedRequest.tools?.find((tool) => tool.name === 'verify_read_access');
  assert.ok(verifyTool);
  assert.deepEqual(verifyTool.parameters.properties, {});
  assert.deepEqual(verifyTool.parameters.required, []);

  const verifiedRoutes: Array<Exclude<StableIntentId, 'unknown'>> = [
    'payment.failed',
    'fd.book.status',
    'fd.withdraw.premature',
    'kyc.status',
    'ticket.status',
    'payment.summary',
    'fd.summary',
    'refund.status',
  ];

  for (const intent of verifiedRoutes) {
    const request = buildOpenAIResponseRequest({
      persona,
      transcript: 'Account detail batao',
      history: [],
      callVerified: true,
      route: testRoute(intent),
    });

    for (const tool of request.tools ?? []) {
      if (tool.name === 'send_secure_link') continue;
      assert.deepEqual(tool.parameters.properties, {}, `${tool.name} should expose no model-filled args`);
      assert.deepEqual(tool.parameters.required, [], `${tool.name} should require no model-filled args`);
    }
  }
});

test('extractOpenAIText returns text from response output messages', () => {
  const text = extractOpenAIText({
    output: [
      {
        type: 'message',
        content: [{ type: 'output_text', text: 'Namaste, I can help.' }],
      },
    ],
  });

  assert.equal(text, 'Namaste, I can help.');
});

test('runStableAgent sends requests to OpenAI Responses API', async () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_AGENT_MODEL;

  const requests: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        output: [{ type: 'message', content: [{ type: 'output_text', text: '[neutral] Ji, main help karti hoon.' }] }],
      }),
    } as Response;
  }) as typeof fetch;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_AGENT_MODEL = 'gpt-5.1-mini';

  try {
    const result = await runStableAgent({
      persona,
      transcript: 'FD issue hai',
      history: [],
      route: testRoute('fd.book.status'),
    });

    assert.equal(result.text, '[neutral] Ji, main help karti hoon.');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://api.openai.com/v1/responses');
    assert.deepEqual(requests[0].init?.headers, {
      Authorization: 'Bearer test-openai-key',
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(String(requests[0].init?.body));
    assert.equal(body.model, 'gpt-5.1-mini');
    assert.equal(body.tools[0].type, 'function');
    assert.equal(body.max_output_tokens, 8000);
    assert.deepEqual(body.reasoning, { effort: 'low' });
    assert.deepEqual(body.text, { verbosity: 'low' });
    assert.equal('temperature' in body, false);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.OPENAI_AGENT_MODEL = originalModel;
  }
});

test('runStableAgent executes an OpenAI tool call and sends the tool result back', async () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_AGENT_MODEL;

  let callCount = 0;
  const requestBodies: unknown[] = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    callCount += 1;
    requestBodies.push(JSON.parse(String(init?.body)));

    if (callCount === 1) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          output: [
            {
              type: 'function_call',
              call_id: 'call_123',
              name: 'get_fd_booking_status',
              arguments: '{"fd_id":"FD-8110"}',
            },
          ],
        }),
      } as Response;
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        output: [{ type: 'message', content: [{ type: 'output_text', text: '[neutral] FD details mil gaye.' }] }],
      }),
    } as Response;
  }) as typeof fetch;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_AGENT_MODEL = 'gpt-5.1-mini';

  try {
    const result = await runStableAgent({
      persona,
      transcript: 'FD status batao',
      history: [],
    });

    assert.equal(result.text, '[neutral] Is account specific tool ke liye pehle read access verification zaroori hai.');
    assert.deepEqual(result.toolCalls, ['get_fd_booking_status']);
    assert.equal(callCount, 1);
    assert.equal(requestBodies.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.OPENAI_AGENT_MODEL = originalModel;
  }
});

test('runStableAgent executes verification without console logging', async () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_AGENT_MODEL;

  let callCount = 0;
  globalThis.fetch = (async (_url: string | URL | Request) => {
    callCount += 1;
    if (callCount === 1) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          output: [
            {
              type: 'function_call',
              call_id: 'call_verify_log',
              name: 'verify_read_access',
              arguments: '{"mobile_last_4":"3210","date_of_birth":"1991-08-14"}',
            },
          ],
        }),
      } as Response;
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        output: [{ type: 'message', content: [{ type: 'output_text', text: '[neutral] Verification complete.' }] }],
      }),
    } as Response;
  }) as typeof fetch;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_AGENT_MODEL = 'gpt-5.1-mini';

  try {
    const result = await runStableAgent({
      persona,
      transcript: '1991-08-14',
      history: [],
      toolContext: { verifiedMobileLast4: '3210' },
    });

    assert.equal(result.verified, true);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.OPENAI_AGENT_MODEL = originalModel;
  }
});

test('runStableAgent can continue from DOB verification to the original account tool', async () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_AGENT_MODEL;
  const originalDisableAiDob = process.env.STABLE_DISABLE_AI_DOB;

  let callCount = 0;
  const requestBodies: unknown[] = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    callCount += 1;
    requestBodies.push(JSON.parse(String(init?.body)));

    if (callCount === 1) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          output: [
            {
              type: 'function_call',
              call_id: 'call_verify',
              name: 'verify_read_access',
              arguments: '{"mobile_last_4":"3210","date_of_birth":"1991-08-14"}',
            },
          ],
        }),
      } as Response;
    }

    if (callCount === 2) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          output: [
            {
              type: 'function_call',
              call_id: 'call_payment',
              name: 'get_payment_reconciliation_status',
              arguments: '{"reference":"PAY-8831"}',
            },
          ],
        }),
      } as Response;
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        output: [{ type: 'message', content: [{ type: 'output_text', text: '[neutral] Payment pending reconciliation mein hai.' }] }],
      }),
    } as Response;
  }) as typeof fetch;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_AGENT_MODEL = 'gpt-5.1-mini';
  process.env.STABLE_DISABLE_AI_DOB = '1';

  try {
    const result = await runStableAgent({
      persona,
      transcript: '1991-08-14',
      history: [
        { role: 'user', text: 'Mera payment status batao' },
        { role: 'model', text: '[neutral] Verification ke liye mobile number ke last four digits bata dijiye.' },
        { role: 'user', text: '3210' },
        { role: 'model', text: '[neutral] DOB bata dijiye.' },
      ],
      route: testRoute('payment.failed'),
      skipAiMobileVerification: true,
    });

    assert.equal(result.text, '[neutral] Payment pending reconciliation mein hai.');
    assert.deepEqual(result.toolCalls, ['verify_read_access', 'get_payment_reconciliation_status']);
    assert.equal(result.verified, true);
    assert.equal(callCount, 3);
    assert.equal(requestBodies.length, 3);
    assert.match(JSON.stringify(requestBodies.at(-1)), /PAY-8831/);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.OPENAI_AGENT_MODEL = originalModel;
    process.env.STABLE_DISABLE_AI_DOB = originalDisableAiDob;
  }
});

test('runStableAgent uses the matched mobile last four when DOB tool args carry a stale mismatch', async () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_AGENT_MODEL;

  let callCount = 0;
  globalThis.fetch = (async () => {
    callCount += 1;
    if (callCount === 1) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          output: [
            {
              type: 'function_call',
              call_id: 'call_dob_with_stale_mobile',
              name: 'verify_read_access',
              arguments: '{"mobile_last_4":"5498","date_of_birth":"1991-08-14"}',
            },
          ],
        }),
      } as Response;
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        output: [{ type: 'message', content: [{ type: 'output_text', text: '[neutral] Verification complete.' }] }],
      }),
    } as Response;
  }) as typeof fetch;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_AGENT_MODEL = 'gpt-5.1-mini';

  try {
    const result = await runStableAgent({
      persona,
      transcript: '14 August 1991',
      history: [
        { role: 'user', text: 'Mera payment status batao' },
        { role: 'model', text: '[neutral] Verification ke liye mobile number ke last four digits bata dijiye.' },
        { role: 'user', text: '5498' },
        { role: 'model', text: '[neutral] Ye match nahi hua. Last four digits dobara bata dijiye.' },
        { role: 'user', text: '3210' },
        { role: 'model', text: '[neutral] Kripya date of birth batayein.' },
      ],
      route: testRoute('payment.failed'),
      toolContext: { verifiedMobileLast4: '3210' },
    });

    assert.equal(result.verified, true);
    assert.equal(result.text, '[neutral] Verification complete.');
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.OPENAI_AGENT_MODEL = originalModel;
  }
});

test('runStableAgent keeps the matched mobile last four while retrying DOB after a DOB mismatch', async () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_AGENT_MODEL;

  let callCount = 0;
  globalThis.fetch = (async () => {
    callCount += 1;
    if (callCount === 1) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          output: [
            {
              type: 'function_call',
              call_id: 'call_dob_retry',
              name: 'verify_read_access',
              arguments: '{"mobile_last_4":"1992","date_of_birth":"1991-08-14"}',
            },
          ],
        }),
      } as Response;
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        output: [{ type: 'message', content: [{ type: 'output_text', text: '[neutral] Verification complete.' }] }],
      }),
    } as Response;
  }) as typeof fetch;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_AGENT_MODEL = 'gpt-5.1-mini';

  try {
    const result = await runStableAgent({
      persona,
      transcript: '14 August 1991',
      history: [
        { role: 'user', text: 'Mera payment status batao' },
        { role: 'model', text: '[neutral] Verification ke liye mobile number ke last four digits bata dijiye.' },
        { role: 'user', text: '3210' },
        { role: 'model', text: '[neutral] Mobile last four match ho gaya. Kripya date of birth batayein.' },
        { role: 'user', text: '1992-08-14' },
        { role: 'model', text: '[neutral] Date of birth match nahi hua. Kripya ek baar phir date of birth batayein.' },
      ],
      route: testRoute('payment.failed'),
      toolContext: { verifiedMobileLast4: '3210' },
    });

    assert.equal(result.verified, true);
    assert.equal(result.text, '[neutral] Verification complete.');
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.OPENAI_AGENT_MODEL = originalModel;
  }
});

test('runStableAgent preserves verified call state on later turns', async () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_AGENT_MODEL;

  let callCount = 0;
  const requestBodies: unknown[] = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    callCount += 1;
    requestBodies.push(JSON.parse(String(init?.body)));

    if (callCount === 1) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          output: [
            {
              type: 'function_call',
              call_id: 'call_kyc_status',
              name: 'get_kyc_status',
              arguments: '{}',
            },
          ],
        }),
      } as Response;
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        output: [{ type: 'message', content: [{ type: 'output_text', text: '[neutral] Aapka KYC pending review hai.' }] }],
      }),
    } as Response;
  }) as typeof fetch;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_AGENT_MODEL = 'gpt-5.1-mini';

  try {
    const result = await runStableAgent({
      persona,
      transcript: 'Ab mera KYC status batao',
      history: [{ role: 'model', text: '[neutral] Verification complete. Payment pending hai.' }],
      callVerified: true,
      route: testRoute('kyc.status'),
    });

    assert.match(result.text, /^\[neutral\] Aapka KYC pending review hai/);
    assert.equal(result.verified, true);
    assert.deepEqual(result.toolCalls, ['get_kyc_status']);
    assert.equal(callCount, 2);
    const initialRequest = requestBodies[0] as { instructions: string };
    assert.match(initialRequest.instructions, /Call verification status: verified/i);
    assert.doesNotMatch(initialRequest.instructions, /After the first caller message.*last four digits/i);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.OPENAI_AGENT_MODEL = originalModel;
  }
});

test('runStableAgent lets AI compose caller-facing text after account tool calls', async () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_AGENT_MODEL;

  let callCount = 0;
  const requestBodies: unknown[] = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    callCount += 1;
    requestBodies.push(JSON.parse(String(init?.body)));
    if (callCount === 2) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          output: [{ type: 'message', content: [{ type: 'output_text', text: '[neutral] Aapka KYC pending review hai.' }] }],
        }),
      } as Response;
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: 'function_call',
            call_id: 'call_kyc_status',
            name: 'get_kyc_status',
            arguments: '{}',
          },
        ],
      }),
    } as Response;
  }) as typeof fetch;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_AGENT_MODEL = 'gpt-5.1-mini';

  try {
    const result = await runStableAgent({
      persona,
      transcript: 'Ab mera KYC status batao',
      history: [],
      callVerified: true,
      route: testRoute('kyc.status'),
    });

    assert.equal(callCount, 2);
    assert.deepEqual(result.toolCalls, ['get_kyc_status']);
    assert.equal(result.verified, true);
    assert.equal(result.text, '[neutral] Aapka KYC pending review hai.');
    assert.match(JSON.stringify(requestBodies.at(-1)), /function_call_output/);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.OPENAI_AGENT_MODEL = originalModel;
  }
});

test('runStableAgent lets AI reassure before payment tool answers', async () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_AGENT_MODEL;

  let callCount = 0;
  globalThis.fetch = (async () => {
    callCount += 1;
    if (callCount === 2) {
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
                  text: '[neutral] Main samajh sakti hoon ki aap pareshan hain. PAY-8831 payment pending reconciliation mein hai. Aapka paisa safe hai.',
                },
              ],
            },
          ],
        }),
      } as Response;
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: 'function_call',
            call_id: 'call_payment',
            name: 'get_payment_reconciliation_status',
            arguments: '{"reference":"PAY-8831"}',
          },
        ],
      }),
    } as Response;
  }) as typeof fetch;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_AGENT_MODEL = 'gpt-5.1-mini';

  try {
    const result = await runStableAgent({
      persona,
      transcript: 'Mera payment debit hua but FD nahi bana',
      history: [],
      callVerified: true,
      route: testRoute('payment.failed'),
    });

    assert.deepEqual(result.toolCalls, ['get_payment_reconciliation_status']);
    assert.equal(result.verified, true);
    assert.equal(
      result.text,
      '[neutral] Main samajh sakti hoon ki aap pareshan hain. PAY-8831 payment pending reconciliation mein hai. Aapka paisa safe hai.',
    );
    assert.equal(callCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.OPENAI_AGENT_MODEL = originalModel;
  }
});

test('runStableAgent uses a no-tool recovery response when OpenAI returns no usable output', async () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_AGENT_MODEL;

  let callCount = 0;
  const requestBodies: unknown[] = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    callCount += 1;
    requestBodies.push(JSON.parse(String(init?.body)));
    if (callCount === 4) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          output: [{ type: 'message', content: [{ type: 'output_text', text: '[neutral] Maaf kijiye, ab main help karti hoon.' }] }],
        }),
      } as Response;
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({ output: [] }),
    } as Response;
  }) as typeof fetch;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_AGENT_MODEL = 'gpt-5.1-mini';

  try {
    const result = await runStableAgent({
      persona,
      transcript: 'Kya aap meri KYC status bata sakte ho?',
      history: [],
    });

    assert.equal(result.text, '[neutral] Maaf kijiye, ab main help karti hoon.');
    assert.deepEqual(result.toolCalls, []);
    assert.equal(callCount, 4);
    assert.equal((requestBodies.at(-1) as { tools?: unknown[] }).tools?.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.OPENAI_AGENT_MODEL = originalModel;
  }
});

test('runStableAgent still returns fallback when no-tool recovery has no usable output', async () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_AGENT_MODEL;

  let callCount = 0;
  globalThis.fetch = (async () => {
    callCount += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ output: [] }),
    } as Response;
  }) as typeof fetch;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_AGENT_MODEL = 'gpt-5.1-mini';

  try {
    const result = await runStableAgent({
      persona,
      transcript: 'Kya aap meri KYC status bata sakte ho?',
      history: [],
    });

    assert.match(result.text, /response banane mein issue/i);
    assert.deepEqual(result.toolCalls, []);
    assert.equal(callCount, 4);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.OPENAI_AGENT_MODEL = originalModel;
  }
});

test('runStableAgent retries recovery with a larger budget when recovery is incomplete before visible text', async () => {
  const persona = getPersonaById('cust_demo_004');
  assert.ok(persona);

  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_AGENT_MODEL;

  let callCount = 0;
  const requestBodies: unknown[] = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    callCount += 1;
    requestBodies.push(JSON.parse(String(init?.body)));

    if (callCount === 4) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'resp_recovery_incomplete',
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          output: [{ type: 'reasoning' }],
          usage: {
            input_tokens: 4930,
            output_tokens: 192,
            total_tokens: 5122,
          },
        }),
      } as Response;
    }

    if (callCount === 5) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          output: [{ type: 'message', content: [{ type: 'output_text', text: '[neutral] Ye secure change voice par complete nahi ho sakta. Main secure link bhejne mein help karti hoon.' }] }],
        }),
      } as Response;
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: `resp_empty_${callCount}`,
        status: 'completed',
        output: [],
      }),
    } as Response;
  }) as typeof fetch;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_AGENT_MODEL = 'gpt-5.1-mini';

  try {
    const result = await runStableAgent({
      persona,
      transcript: 'Account change karna hai',
      history: Array.from({ length: 10 }, (_, index) => ({
        role: index % 2 === 0 ? 'user' : 'model',
        text: index % 2 === 0 ? 'Help chahiye' : '[neutral] Ji, batayein.',
      })),
      route: testRoute('secure.action.help'),
    });

    assert.equal(result.text, '[neutral] Ye secure change voice par complete nahi ho sakta. Main secure link bhejne mein help karti hoon.');
    assert.equal(callCount, 5);
    assert.equal((requestBodies[3] as { max_output_tokens?: number }).max_output_tokens, 8000);
    assert.equal((requestBodies[4] as { max_output_tokens?: number }).max_output_tokens, 8000);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.OPENAI_AGENT_MODEL = originalModel;
  }
});

test('runStableAgent silently retries an empty OpenAI response before using fallback copy', async () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_AGENT_MODEL;

  let callCount = 0;
  globalThis.fetch = (async () => {
    callCount += 1;
    if (callCount === 1) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ output: [] }),
      } as Response;
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        output: [{ type: 'message', content: [{ type: 'output_text', text: '[neutral] KYC ka matlab identity verification hota hai.' }] }],
      }),
    } as Response;
  }) as typeof fetch;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_AGENT_MODEL = 'gpt-5.1-mini';

  try {
    const result = await runStableAgent({
      persona,
      transcript: 'What is KYC?',
      history: [],
    });

    assert.equal(result.text, '[neutral] KYC ka matlab identity verification hota hai.');
    assert.deepEqual(result.toolCalls, []);
    assert.equal(callCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.OPENAI_AGENT_MODEL = originalModel;
  }
});

test('runStableAgent stops a repeated tool loop with a no-tool recovery response', async () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_AGENT_MODEL;
  const originalDisableAiDob = process.env.STABLE_DISABLE_AI_DOB;

  let callCount = 0;
  const requestBodies: unknown[] = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    callCount += 1;
    requestBodies.push(JSON.parse(String(init?.body)));
    if (callCount === 3) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          output: [{ type: 'message', content: [{ type: 'output_text', text: '[neutral] Verification complete hai. Ab KYC status check kar sakti hoon.' }] }],
        }),
      } as Response;
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: 'function_call',
            id: `fc_${callCount}`,
            call_id: `call_${callCount}`,
            name: 'verify_read_access',
            arguments: JSON.stringify({ mobile_last_4: '3210', date_of_birth: '1991-08-14' }),
          },
        ],
      }),
    } as Response;
  }) as typeof fetch;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_AGENT_MODEL = 'gpt-5.1-mini';
  process.env.STABLE_DISABLE_AI_DOB = '1';

  try {
    const result = await runStableAgent({
      persona,
      transcript: 'Meri KYC status batao. Mobile last four 3210 aur date of birth 14 August 1991 hai.',
      history: [],
      route: testRoute('kyc.status'),
    });

    assert.equal(result.text, '[neutral] Verification complete hai. Ab KYC status check kar sakti hoon.');
    assert.deepEqual(result.toolCalls, ['verify_read_access']);
    assert.equal(result.verified, true);
    assert.equal(callCount, 3);
    assert.equal((requestBodies.at(-1) as { tools?: unknown[] }).tools?.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.OPENAI_AGENT_MODEL = originalModel;
    process.env.STABLE_DISABLE_AI_DOB = originalDisableAiDob;
  }
});

test('streamStableAgentText streams OpenAI output text deltas', async () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_AGENT_MODEL;

  const encoded = new TextEncoder().encode(
    [
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"[neutral] Ji, "}',
      '',
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"main check karti hoon."}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed"}',
      '',
    ].join('\n'),
  );
  const requestBodies: unknown[] = [];

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    requestBodies.push(JSON.parse(String(init?.body)));
    return {
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoded);
          controller.close();
        },
      }),
    } as Response;
  }) as typeof fetch;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_AGENT_MODEL = 'gpt-5.1-mini';

  try {
    const chunks: string[] = [];
    const result = await streamStableAgentText(
      {
        persona,
        transcript: 'Namaste, mujhe app samajhna hai',
        history: [],
      },
      (delta) => chunks.push(delta),
    );

    assert.deepEqual(chunks, ['[neutral] Ji, ', 'main check karti hoon.']);
    assert.equal(result.text, '[neutral] Ji, main check karti hoon.');
    assert.deepEqual(result.toolCalls, []);
    assert.equal((requestBodies[0] as { stream?: boolean }).stream, true);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.OPENAI_AGENT_MODEL = originalModel;
  }
});

test('streamStableAgentText recovers before emitting deltas when OpenAI ends incomplete', async () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_AGENT_MODEL;

  const incompleteStream = new TextEncoder().encode(
    [
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"[neutral] Kripya registered mobile number ke last chaar digits batayein, main ab"}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed","response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}}}',
      '',
    ].join('\n'),
  );
  const requestBodies: unknown[] = [];

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    requestBodies.push(body);

    if (body.stream) {
      return {
        ok: true,
        status: 200,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(incompleteStream);
            controller.close();
          },
        }),
      } as Response;
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        output: [{ type: 'message', content: [{ type: 'output_text', text: '[neutral] Kripya registered mobile number ke last chaar digits batayein.' }] }],
      }),
    } as Response;
  }) as typeof fetch;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_AGENT_MODEL = 'gpt-5.1-mini';

  try {
    const chunks: string[] = [];
    const result = await streamStableAgentText(
      {
        persona,
        transcript: 'Mera payment status batao',
        history: [],
        route: testRoute('payment.failed'),
      },
      (delta) => chunks.push(delta),
    );

    assert.deepEqual(chunks, ['[neutral] Kripya registered mobile number ke last chaar digits batayein.']);
    assert.equal(result.text, '[neutral] Kripya registered mobile number ke last chaar digits batayein.');
    assert.equal(requestBodies.length, 2);
    assert.equal((requestBodies[0] as { stream?: boolean }).stream, true);
    assert.equal((requestBodies[1] as { max_output_tokens?: number }).max_output_tokens, 8000);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.OPENAI_AGENT_MODEL = originalModel;
  }
});

test('streamStableAgentText recovers when OpenAI sends response.incomplete with no text deltas', async () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_AGENT_MODEL;

  const incompleteStream = new TextEncoder().encode(
    [
      'event: response.created',
      'data: {"type":"response.created","response":{"status":"in_progress"},"sequence_number":0}',
      '',
      'event: response.incomplete',
      'data: {"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}},"sequence_number":1}',
      '',
    ].join('\n'),
  );
  const requestBodies: unknown[] = [];

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    requestBodies.push(body);

    if (body.stream) {
      return {
        ok: true,
        status: 200,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(incompleteStream);
            controller.close();
          },
        }),
      } as Response;
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        output: [{ type: 'message', content: [{ type: 'output_text', text: '[neutral] KYC status check karne ke liye mobile last four bata dijiye.' }] }],
      }),
    } as Response;
  }) as typeof fetch;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_AGENT_MODEL = 'gpt-5.1-mini';

  try {
    const chunks: string[] = [];
    const result = await streamStableAgentText(
      {
        persona,
        transcript: 'Mera kyc status batao',
        history: [],
        route: testRoute('kyc.status'),
      },
      (delta) => chunks.push(delta),
    );

    assert.deepEqual(chunks, ['[neutral] KYC status check karne ke liye mobile last four bata dijiye.']);
    assert.equal(result.text, '[neutral] KYC status check karne ke liye mobile last four bata dijiye.');
    assert.equal(requestBodies.length, 2);
    assert.equal((requestBodies[0] as { stream?: boolean }).stream, true);
    assert.equal((requestBodies[1] as { max_output_tokens?: number }).max_output_tokens, 8000);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.OPENAI_AGENT_MODEL = originalModel;
  }
});

test('streamStableAgentText sends account questions to OpenAI instead of bypassing verification', async () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_AGENT_MODEL;

  const encoded = new TextEncoder().encode(
    [
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"[neutral] Verification ke liye mobile number ke last four digits bata dijiye."}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed"}',
      '',
    ].join('\n'),
  );
  const requestBodies: unknown[] = [];

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    requestBodies.push(JSON.parse(String(init?.body)));
    return {
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoded);
          controller.close();
        },
      }),
    } as Response;
  }) as typeof fetch;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_AGENT_MODEL = 'gpt-5.1-mini';

  try {
    const chunks: string[] = [];
    const result = await streamStableAgentText(
      {
        persona,
        transcript: 'Mera payment status batao',
        history: [],
      },
      (delta) => chunks.push(delta),
    );

    assert.equal(requestBodies.length, 1);
    assert.match(result.text, /last four digits/i);
    assert.deepEqual(result.toolCalls, []);
    assert.equal(chunks.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.OPENAI_AGENT_MODEL = originalModel;
  }
});

test('streamStableAgentText falls back to non-streaming response when OpenAI stream emits retryable server_error', async () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_AGENT_MODEL;

  const streamError = new TextEncoder().encode(
    [
      'event: error',
      'data: {"type":"error","error":{"type":"server_error","code":"server_error","message":"An error occurred while processing your request.","param":null}}',
      '',
      '',
    ].join('\n'),
  );
  const requestBodies: unknown[] = [];

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    requestBodies.push(body);
    if (body.stream === true) {
      return {
        ok: true,
        status: 200,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(streamError);
            controller.close();
          },
        }),
      } as Response;
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: '[neutral] Server busy tha, ab main help karti hoon.' }],
          },
        ],
      }),
    } as Response;
  }) as typeof fetch;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_AGENT_MODEL = 'gpt-5.1-mini';

  try {
    const chunks: string[] = [];
    const result = await streamStableAgentText(
      {
        persona,
        transcript: 'Mera payment status batao',
        history: [],
        route: testRoute('payment.failed'),
      },
      (delta) => chunks.push(delta),
    );

    assert.deepEqual(chunks, []);
    assert.equal(result.text, '[neutral] Server busy tha, ab main help karti hoon.');
    assert.deepEqual(result.toolCalls, []);
    assert.equal(requestBodies.length, 2);
    assert.equal((requestBodies[0] as { stream?: boolean }).stream, true);
    assert.equal((requestBodies[1] as { stream?: boolean }).stream, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.OPENAI_AGENT_MODEL = originalModel;
  }
});

test('streamStableAgentText accepts streamed tool call ids from Responses events', async () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_AGENT_MODEL;

  const streamBodies: unknown[] = [];
  const firstStream = new TextEncoder().encode(
    [
      'event: response.output_item.added',
      'data: {"type":"response.output_item.added","item":{"type":"function_call","id":"call_verify","name":"verify_read_access","arguments":""}}',
      '',
      'event: response.function_call_arguments.delta',
      'data: {"type":"response.function_call_arguments.delta","delta":"{\\"mobile_last_4\\":\\"3210\\"}"}',
      '',
      'event: response.function_call_arguments.done',
      'data: {"type":"response.function_call_arguments.done","item":{"type":"function_call","id":"call_verify","name":"verify_read_access","arguments":"{\\"mobile_last_4\\":\\"3210\\"}"}}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed"}',
      '',
    ].join('\n'),
  );
  const secondStream = new TextEncoder().encode(
    [
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"[neutral] Mobile last four match ho gaya. "} ',
      '',
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"Kripya date of birth batayein."}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed"}',
      '',
    ].join('\n'),
  );

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    streamBodies.push(body);
    if (body.stream === true) {
      const encoded = streamBodies.length === 1 ? firstStream : secondStream;
      return {
        ok: true,
        status: 200,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(encoded);
            controller.close();
          },
        }),
      } as Response;
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        output: [{ type: 'message', content: [{ type: 'output_text', text: '[neutral] Fallback response.' }] }],
      }),
    } as Response;
  }) as typeof fetch;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_AGENT_MODEL = 'gpt-5.1-mini';

  try {
    const chunks: string[] = [];
    const result = await streamStableAgentText(
      {
        persona,
        transcript: '3210',
        history: [
          { role: 'user', text: 'Mera payment status batao' },
          { role: 'model', text: '[neutral] Verification ke liye mobile number ke last four digits bata dijiye.' },
        ],
        route: testRoute('payment.failed'),
      },
      (delta) => chunks.push(delta),
    );

    assert.equal(streamBodies.length, 2);
    assert.deepEqual(result.toolCalls, ['verify_read_access']);
    assert.equal(result.text, '[neutral] Mobile last four match ho gaya. Kripya date of birth batayein.');
    assert.deepEqual(chunks, ['[neutral] Mobile last four match ho gaya. Kripya date of birth batayein.']);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.OPENAI_AGENT_MODEL = originalModel;
  }
});

test('streamStableAgentText fills empty DOB verification args from the current transcript', async () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_AGENT_MODEL;

  const streamBodies: unknown[] = [];
  const firstStream = new TextEncoder().encode(
    [
      'event: response.output_item.added',
      'data: {"type":"response.output_item.added","item":{"type":"function_call","call_id":"call_verify","name":"verify_read_access","arguments":""}}',
      '',
      'event: response.function_call_arguments.done',
      'data: {"type":"response.function_call_arguments.done","item":{"type":"function_call","call_id":"call_verify","name":"verify_read_access","arguments":"{\\"mobile_last_4\\":\\"3210\\",\\"date_of_birth\\":\\"\\"}"}}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed"}',
      '',
    ].join('\n'),
  );
  const secondStream = new TextEncoder().encode(
    [
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"[neutral] Verification complete ho gaya."}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed"}',
      '',
    ].join('\n'),
  );

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    streamBodies.push(body);
    return {
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(streamBodies.length === 1 ? firstStream : secondStream);
          controller.close();
        },
      }),
    } as Response;
  }) as typeof fetch;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_AGENT_MODEL = 'gpt-5.1-mini';

  try {
    const debugEvents: unknown[] = [];
    const result = await streamStableAgentText(
      {
        persona,
        transcript: '14 August 1991',
        history: [
          { role: 'user', text: 'Mera payment status batao' },
          { role: 'model', text: '[neutral] Verification ke liye mobile number ke last four digits bata dijiye.' },
          { role: 'user', text: '3210' },
          { role: 'model', text: '[neutral] Kripya date of birth batayein.' },
        ],
        toolContext: { verifiedMobileLast4: '3210' },
      },
      () => {},
      (event) => {
        debugEvents.push(event);
      },
    );

    assert.equal(result.verified, true);
    assert.match(JSON.stringify(debugEvents), /"date_of_birth":"14 August 1991"/);
    assert.match(JSON.stringify(debugEvents), /"verified":true/);
    assert.equal(result.text, '[neutral] Verification complete ho gaya.');
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.OPENAI_AGENT_MODEL = originalModel;
  }
});

test('streamStableAgentText continues from successful DOB verification to FD summary', async () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_AGENT_MODEL;
  const originalDisableAiDob = process.env.STABLE_DISABLE_AI_DOB;

  const verifyStream = new TextEncoder().encode(
    [
      'event: response.created',
      'data: {"type":"response.created","response":{"status":"in_progress"},"sequence_number":0}',
      '',
      'event: response.output_item.added',
      'data: {"type":"response.output_item.added","item":{"type":"function_call","call_id":"call_verify","name":"verify_read_access","arguments":""},"output_index":0,"sequence_number":1}',
      '',
      'event: response.output_item.done',
      'data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"call_verify","name":"verify_read_access","arguments":"{\\"mobile_last_4\\":\\"3210\\",\\"date_of_birth\\":\\"1991-08-14\\"}"},"output_index":0,"sequence_number":2}',
      '',
      'event: response.incomplete',
      'data: {"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}},"sequence_number":3}',
      '',
    ].join('\n'),
  );
  const fdStream = new TextEncoder().encode(
    [
      'event: response.output_item.added',
      'data: {"type":"response.output_item.added","item":{"type":"function_call","call_id":"call_fd","name":"get_fd_summary","arguments":""},"output_index":0,"sequence_number":0}',
      '',
      'event: response.output_item.done',
      'data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"call_fd","name":"get_fd_summary","arguments":"{}"},"output_index":0,"sequence_number":1}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed","response":{"status":"completed"},"sequence_number":2}',
      '',
    ].join('\n'),
  );
  const answerStream = new TextEncoder().encode(
    [
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"[neutral] Bajaj Finance mein rupees thirty thousand ki FD active hai."}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed","response":{"status":"completed"},"sequence_number":0}',
      '',
    ].join('\n'),
  );
  const requestBodies: unknown[] = [];

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    requestBodies.push(JSON.parse(String(init?.body)));
    const body = requestBodies.at(-1) as { stream?: boolean };
    assert.equal(body.stream, true);
    const encoded = requestBodies.length === 1 ? verifyStream : requestBodies.length === 2 ? fdStream : answerStream;
    return {
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoded);
          controller.close();
        },
      }),
    } as Response;
  }) as typeof fetch;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_AGENT_MODEL = 'gpt-5.1-mini';
  process.env.STABLE_DISABLE_AI_DOB = '1';

  try {
    const chunks: string[] = [];
    const result = await streamStableAgentText(
      {
        persona,
        transcript: '14 August 1991',
        history: [
          { role: 'user', text: 'Meri FD summary batao' },
          { role: 'model', text: '[neutral] Account details check karne ke liye mobile number ke last four digits batayein.' },
          { role: 'user', text: '3210' },
          { role: 'model', text: '[neutral] Mobile last four match ho gaya. Apni date of birth batayein.' },
        ],
        route: testRoute('fd.summary'),
        toolContext: { verifiedMobileLast4: '3210' },
      },
      (delta) => chunks.push(delta),
    );

    assert.deepEqual(result.toolCalls, ['verify_read_access', 'get_fd_summary']);
    assert.equal(result.verified, true);
    assert.equal(result.text, '[neutral] Bajaj Finance mein rupees thirty thousand ki FD active hai.');
    assert.deepEqual(chunks, [result.text]);
    assert.equal(requestBodies.length, 3);
    assert.deepEqual((requestBodies[1] as { tools?: Array<{ name: string }> }).tools?.map((tool) => tool.name), ['get_fd_summary']);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.OPENAI_AGENT_MODEL = originalModel;
    process.env.STABLE_DISABLE_AI_DOB = originalDisableAiDob;
  }
});

test('streamStableAgentText forces pending account tool after DOB verification instead of stopping at checking copy', async () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_AGENT_MODEL;
  const originalDisableAiDob = process.env.STABLE_DISABLE_AI_DOB;

  const verifyStream = new TextEncoder().encode(
    [
      'event: response.output_item.added',
      'data: {"type":"response.output_item.added","item":{"type":"function_call","call_id":"call_verify","name":"verify_read_access","arguments":""}}',
      '',
      'event: response.function_call_arguments.done',
      'data: {"type":"response.function_call_arguments.done","item":{"type":"function_call","call_id":"call_verify","name":"verify_read_access","arguments":"{\\"mobile_last_4\\":\\"3210\\",\\"date_of_birth\\":\\"1991-08-14\\"}"}}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed"}',
      '',
    ].join('\n'),
  );
  const checkingStream = new TextEncoder().encode(
    [
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"[neutral] Ab main aapki account details check karti hoon."}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed"}',
      '',
    ].join('\n'),
  );
  const answerStream = new TextEncoder().encode(
    [
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"[neutral] Bajaj Finance mein rupees thirty thousand ki FD active hai."}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed"}',
      '',
    ].join('\n'),
  );
  const requestBodies: unknown[] = [];

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    requestBodies.push(JSON.parse(String(init?.body)));
    const encoded = requestBodies.length === 1 ? verifyStream : requestBodies.length === 2 ? checkingStream : answerStream;
    return {
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoded);
          controller.close();
        },
      }),
    } as Response;
  }) as typeof fetch;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_AGENT_MODEL = 'gpt-5.1-mini';
  process.env.STABLE_DISABLE_AI_DOB = '1';

  try {
    const chunks: string[] = [];
    const result = await streamStableAgentText(
      {
        persona,
        transcript: '9 November 1995',
        history: [
          { role: 'user', text: 'Meri FD summary batao' },
          { role: 'model', text: '[neutral] Account details ke liye mobile last four batayein.' },
          { role: 'user', text: '3210' },
          { role: 'model', text: '[neutral] Mobile verification complete ho gaya. Ab date of birth bataiye.' },
        ],
        route: testRoute('fd.summary'),
        toolContext: { verifiedMobileLast4: '3210' },
      },
      (delta) => chunks.push(delta),
    );

    assert.deepEqual(result.toolCalls, ['verify_read_access', 'get_fd_summary']);
    assert.equal(result.text, '[neutral] Bajaj Finance mein rupees thirty thousand ki FD active hai.');
    assert.deepEqual(chunks, [result.text]);
    assert.match(JSON.stringify(requestBodies.at(-1)), /get_fd_summary/);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.OPENAI_AGENT_MODEL = originalModel;
    process.env.STABLE_DISABLE_AI_DOB = originalDisableAiDob;
  }
});

test('streamStableAgentText executes streamed verification tool even when call id is missing', async () => {
  const persona = getPersonaById('cust_demo_005');
  assert.ok(persona);

  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_AGENT_MODEL;

  const verifyStream = new TextEncoder().encode(
    [
      'event: response.created',
      'data: {"type":"response.created","response":{"status":"in_progress"},"sequence_number":0}',
      '',
      'event: response.output_item.added',
      'data: {"type":"response.output_item.added","item":{"type":"function_call","name":"verify_read_access","arguments":""},"output_index":0,"sequence_number":1}',
      '',
      'event: response.output_item.done',
      'data: {"type":"response.output_item.done","item":{"type":"function_call","name":"verify_read_access","arguments":"{\\"mobile_last_4\\":\\"8820\\"}"},"output_index":0,"sequence_number":2}',
      '',
      'event: response.incomplete',
      'data: {"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}},"sequence_number":3}',
      '',
    ].join('\n'),
  );
  const verifyAnswerStream = new TextEncoder().encode(
    [
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"[neutral] Mobile last four match ho gaya. Apni date of birth batayein."}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed"}',
      '',
    ].join('\n'),
  );
  const requestBodies: unknown[] = [];

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    requestBodies.push(body);
    if (body.stream) {
      const encoded = requestBodies.length === 1 ? verifyStream : verifyAnswerStream;
      return {
        ok: true,
        status: 200,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(encoded);
            controller.close();
          },
        }),
      } as Response;
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({ output: [] }),
    } as Response;
  }) as typeof fetch;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_AGENT_MODEL = 'gpt-5.1-mini';

  try {
    const chunks: string[] = [];
    const result = await streamStableAgentText(
      {
        persona,
        transcript: '8820',
        history: [
          { role: 'user', text: 'KYC status batao' },
          { role: 'model', text: '[neutral] Pehle registered mobile ke last chaar ank batayein.' },
        ],
        route: testRoute('kyc.status'),
      },
      (delta) => chunks.push(delta),
    );

    assert.equal(result.text, '[neutral] Mobile last four match ho gaya. Apni date of birth batayein.');
    assert.deepEqual(result.toolCalls, ['verify_read_access']);
    assert.equal(result.verified, false);
    assert.deepEqual(chunks, ['[neutral] Mobile last four match ho gaya. Apni date of birth batayein.']);
    assert.equal(requestBodies.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.OPENAI_AGENT_MODEL = originalModel;
  }
});

test('streamStableAgentText handles streamed OpenAI tool calls without restarting non-streaming', async () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_AGENT_MODEL;

  const streamBodies: unknown[] = [];
  const firstStream = new TextEncoder().encode(
    [
      'event: response.output_item.added',
      'data: {"type":"response.output_item.added","item":{"type":"function_call","call_id":"call_payment","name":"get_payment_reconciliation_status","arguments":""}}',
      '',
      'event: response.function_call_arguments.delta',
      'data: {"type":"response.function_call_arguments.delta","delta":"{\\"reference\\":\\"PAY-8831\\"}"}',
      '',
      'event: response.function_call_arguments.done',
      'data: {"type":"response.function_call_arguments.done","item":{"type":"function_call","call_id":"call_payment","name":"get_payment_reconciliation_status","arguments":"{\\"reference\\":\\"PAY-8831\\"}"}}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed"}',
      '',
    ].join('\n'),
  );
  const secondStream = new TextEncoder().encode(
    [
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"[neutral] Payment pending hai, "} ',
      '',
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"main timeline check kar rahi hoon."}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed"}',
      '',
    ].join('\n'),
  );

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    streamBodies.push(JSON.parse(String(init?.body)));
    const encoded = streamBodies.length === 1 ? firstStream : secondStream;
    return {
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoded);
          controller.close();
        },
      }),
    } as Response;
  }) as typeof fetch;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_AGENT_MODEL = 'gpt-5.1-mini';

  try {
    const chunks: string[] = [];
    const debugEvents: unknown[] = [];
    const result = await streamStableAgentText(
      {
        persona,
        transcript: 'payment status batao',
        history: [],
        route: testRoute('payment.failed'),
      },
      (delta) => chunks.push(delta),
      (event) => {
        debugEvents.push(event);
      },
    );

    assert.equal(streamBodies.length, 1);
    assert.equal(result.text, '[neutral] Is account specific tool ke liye pehle read access verification zaroori hai.');
    assert.deepEqual(result.toolCalls, ['get_payment_reconciliation_status']);
    assert.deepEqual(chunks, ['[neutral] Is account specific tool ke liye pehle read access verification zaroori hai.']);
    assert.match(JSON.stringify(debugEvents), /"type":"route"/);
    assert.match(JSON.stringify(debugEvents), /"intent":"payment.failed"/);
    assert.match(JSON.stringify(debugEvents), /"type":"tool"/);
    assert.match(JSON.stringify(debugEvents), /"tool":"get_payment_reconciliation_status"/);
    assert.match(JSON.stringify(debugEvents), /"phase":"start"/);
    assert.match(JSON.stringify(debugEvents), /"phase":"result"/);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.OPENAI_AGENT_MODEL = originalModel;
  }
});

test('streamStableAgentText streams AI-composed payment tool answers', async () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_AGENT_MODEL;

  const firstStream = new TextEncoder().encode(
    [
      'event: response.output_item.added',
      'data: {"type":"response.output_item.added","item":{"type":"function_call","call_id":"call_payment","name":"get_payment_reconciliation_status","arguments":""}}',
      '',
      'event: response.function_call_arguments.done',
      'data: {"type":"response.function_call_arguments.done","item":{"type":"function_call","call_id":"call_payment","name":"get_payment_reconciliation_status","arguments":"{\\"reference\\":\\"PAY-8831\\"}"}}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed"}',
      '',
    ].join('\n'),
  );
  const secondStream = new TextEncoder().encode(
    [
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"[neutral] Main samajh sakti hoon ki aap pareshan hain. "} ',
      '',
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"PAY-8831 payment pending reconciliation mein hai."}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed"}',
      '',
    ].join('\n'),
  );
  const requestBodies: unknown[] = [];

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    requestBodies.push(JSON.parse(String(init?.body)));
    const encoded = requestBodies.length === 1 ? firstStream : secondStream;
    return {
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoded);
          controller.close();
        },
      }),
    } as Response;
  }) as typeof fetch;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_AGENT_MODEL = 'gpt-5.1-mini';

  try {
    const chunks: string[] = [];
    const result = await streamStableAgentText(
      {
        persona,
        transcript: 'Mera payment debit hua but FD nahi bana',
        history: [],
        callVerified: true,
        route: testRoute('payment.failed'),
      },
      (delta) => chunks.push(delta),
    );

    assert.deepEqual(result.toolCalls, ['get_payment_reconciliation_status']);
    assert.equal(result.verified, true);
    assert.equal(chunks.join(''), result.text);
    assert.equal(result.text, '[neutral] Main samajh sakti hoon ki aap pareshan hain. PAY-8831 payment pending reconciliation mein hai.');
    assert.equal(requestBodies.length, 2);
    assert.match(JSON.stringify(requestBodies.at(-1)), /function_call_output/);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.OPENAI_AGENT_MODEL = originalModel;
  }
});
