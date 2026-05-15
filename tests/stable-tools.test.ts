import test from 'node:test';
import assert from 'node:assert/strict';

import { getPersonaById } from '../lib/personas';
import {
  executeStableTool,
  executeStableToolWithContext,
  stableToolDeclarations,
} from '../lib/agent/stable-tools';
import { getStableIntentPolicy, routeStableIntent, routeStableTurn } from '../lib/agent/stable-policy';

function assertRumikSafeHinglishSummary(summary: string): void {
  assert.ok(summary.length > 0);
  assert.match(summary, /^\[neutral\] /);
  assert.doesNotMatch(summary.replace(/^\[neutral\] /, ''), /[₹;()[\]{}]/);
  assert.doesNotMatch(summary, /date of birth is required|verification complete|which payment|which FD/i);
  assert.doesNotMatch(summary, /No .* available|could not match|does not execute/i);
  assert.doesNotMatch(summary, /[\u0900-\u097F]/);
  assert.match(summary, /\b(hai|hain|ho gaya|batayein|kijiye|rupees|aapka|main|ke liye)\b/i);
}

test('stableToolDeclarations expose the exact Project.md tool contract to the agent', () => {
  const names = stableToolDeclarations.map((tool) => tool.name);

  assert.deepEqual(names, [
    'verify_read_access',
    'lookup_customer_profile',
    'get_trust_facts',
    'get_canonical_slas',
    'get_disclosure_copy',
    'get_fd_booking_status',
    'get_payment_reconciliation_status',
    'get_kyc_status',
    'get_premature_withdrawal_quote',
    'get_support_ticket_status',
    'get_payment_summary',
    'get_fd_summary',
    'get_refund_status',
    'get_fd_rates',
    'create_support_ticket',
    'send_secure_link',
    'get_support_contact',
  ]);
  assert.equal(names.includes('check_payment_status'), false);
  assert.equal(names.includes('check_kyc_status'), false);
  assert.equal(names.includes('check_fd_status'), false);
  assert.equal(names.includes('prepare_secure_link'), false);
  const verifyTool = stableToolDeclarations.find((tool) => tool.name === 'verify_read_access');
  assert.ok(verifyTool);
  assert.doesNotMatch(JSON.stringify(verifyTool.parameters), /YYYY-MM-DD|preferably/i);
});

test('executeStableTool returns Rumik-safe Hinglish summaries for every stable tool', () => {
  const persona = getPersonaById('cust_demo_004');
  assert.ok(persona);

  const samples: Array<[string, Record<string, unknown>]> = [
    ['verify_read_access', { mobile_last_4: persona.mobile_last_4 }],
    ['lookup_customer_profile', {}],
    ['get_trust_facts', {}],
    ['get_canonical_slas', {}],
    ['get_disclosure_copy', { topic: 'fd' }],
    ['get_fd_booking_status', { fd_id: 'FD-4412' }],
    ['get_payment_reconciliation_status', { reference: 'PAY-4412' }],
    ['get_kyc_status', {}],
    ['get_premature_withdrawal_quote', { fd_id: 'FD-4412' }],
    ['get_support_ticket_status', { ticket_id: 'TKT-20041' }],
    ['get_payment_summary', {}],
    ['get_fd_summary', {}],
    ['get_refund_status', {}],
    ['get_fd_rates', { tenure: '12 months' }],
    ['create_support_ticket', { issue: 'Payment delay', priority: 'high' }],
    ['send_secure_link', { action: 'premature_withdrawal', fd_id: 'FD-4412' }],
    ['get_support_contact', {}],
  ];

  for (const [toolName, args] of samples) {
    const result = executeStableTool(persona, toolName, args);
    assertRumikSafeHinglishSummary(result.summary);
  }
});

test('stable intent policy maps user intents to fixed auth tiers and tools', () => {
  assert.deepEqual(getStableIntentPolicy('fd.rates.compare'), {
    authTier: 'Tier A',
    tools: ['get_fd_rates'],
  });
  assert.deepEqual(getStableIntentPolicy('payment.failed'), {
    authTier: 'Tier B',
    tools: ['verify_read_access', 'get_payment_reconciliation_status'],
  });
  assert.deepEqual(getStableIntentPolicy('kyc.status'), {
    authTier: 'Tier B',
    tools: ['verify_read_access', 'get_kyc_status'],
  });
  assert.deepEqual(getStableIntentPolicy('fd.withdraw.premature'), {
    authTier: 'Tier C',
    tools: ['verify_read_access', 'get_premature_withdrawal_quote', 'send_secure_link'],
  });
});

test('routeStableIntent never classifies user turns with local keyword matching', () => {
  assert.deepEqual(routeStableIntent('Mera payment debit hua but FD nahi bana'), {
    intent: 'unknown',
    authTier: 'Tier A',
    tools: [],
  });
  assert.deepEqual(routeStableIntent('मेरा पेमेंट फेल हो गया है'), {
    intent: 'unknown',
    authTier: 'Tier A',
    tools: [],
  });
  assert.deepEqual(routeStableIntent('میرا پیمنٹ فیل ہو گیا ہے'), {
    intent: 'unknown',
    authTier: 'Tier A',
    tools: [],
  });
  assert.deepEqual(routeStableIntent('Stable Money real hai kya, DICGC hai?'), {
    intent: 'unknown',
    authTier: 'Tier A',
    tools: [],
  });
});

test('routeStableIntent does not locally classify general KYC explainers', () => {
  assert.deepEqual(routeStableIntent('What is KYC?'), {
    intent: 'unknown',
    authTier: 'Tier A',
    tools: [],
  });
  assert.deepEqual(routeStableIntent('KYC kya hota hai?'), {
    intent: 'unknown',
    authTier: 'Tier A',
    tools: [],
  });
});

test('routeStableTurn does not infer verification follow-ups with local keyword matching', () => {
  assert.deepEqual(
    routeStableTurn('3210', [
      { role: 'user', text: 'Mera KYC status batao' },
      { role: 'model', text: 'Verification ke liye mobile number ke last four digits bata dijiye.' },
    ]),
    {
      intent: 'unknown',
      authTier: 'Tier A',
      tools: [],
    },
  );

  assert.deepEqual(
    routeStableTurn('14 August 1991', [
      { role: 'user', text: 'Mera payment status batao' },
      { role: 'model', text: 'Verification ke liye mobile number ke last four digits bata dijiye.' },
      { role: 'user', text: '3210' },
      { role: 'model', text: 'Kripya date of birth batayein.' },
    ]),
    {
      intent: 'unknown',
      authTier: 'Tier A',
      tools: [],
    },
  );

  assert.deepEqual(
    routeStableTurn('august fourteenth', [
      { role: 'user', text: 'Mera payment status batao' },
      { role: 'model', text: 'Verification ke liye mobile number ke last four digits bata dijiye.' },
      { role: 'user', text: '3210' },
      { role: 'model', text: 'Kripya date of birth batayein.' },
    ]),
    {
      intent: 'unknown',
      authTier: 'Tier A',
      tools: [],
    },
  );
});

test('executeStableTool verifies read access in the two-step call flow', () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const mobileResult = executeStableTool(persona, 'verify_read_access', { mobile_last_4: '3210' });

  assert.equal(mobileResult.ok, true);
  assert.match(mobileResult.summary, /date of birth batayein/i);
  assert.equal(mobileResult.data?.customer_id, 'cust_demo_001');
  assert.equal(mobileResult.data?.verification_step, 'dob_required');
  assert.equal(mobileResult.data?.verified, false);
  assert.equal(mobileResult.data?.mobile_step_verified, true);

  const dobResult = executeStableTool(persona, 'verify_read_access', {
    mobile_last_4: '3210',
    date_of_birth: '1991-08-14',
  });

  assert.equal(dobResult.ok, true);
  assert.match(dobResult.summary, /verification complete/i);
  assert.equal(dobResult.data?.verified, true);
  assert.equal(dobResult.data?.mobile_step_verified, true);
});

test('executeStableTool uses verified mobile gate so DOB retries do not need mobile_last_4 again', () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const wrongDob = executeStableTool(persona, 'verify_read_access', {
    mobile_last_4: '3210',
    date_of_birth: '1992-01-01',
  });
  assert.equal(wrongDob.ok, false);
  assert.equal(wrongDob.data?.mobile_step_verified, true);

  const retryWithoutMobile = executeStableTool(
    persona,
    'verify_read_access',
    { date_of_birth: '1991-08-14' },
    { verifiedMobileLast4: persona.mobile_last_4 },
  );
  assert.equal(retryWithoutMobile.ok, true);
  assert.equal(retryWithoutMobile.data?.verified, true);
});

test('executeStableToolWithContext invokes onReadAccessMobileStepVerified when mobile matches', async () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);
  const marks: string[] = [];
  const result = await executeStableToolWithContext(
    persona,
    'verify_read_access',
    { mobile_last_4: persona.mobile_last_4 },
    {
      onReadAccessMobileStepVerified: (four) => {
        marks.push(four);
      },
    },
  );
  assert.equal(result.data?.mobile_step_verified, true);
  assert.deepEqual(marks, [persona.mobile_last_4]);
});

test('executeStableTool verifies spoken natural-language dates without timezone drift', () => {
  const persona = getPersonaById('cust_demo_003');
  assert.ok(persona);

  const dobResult = executeStableTool(persona, 'verify_read_access', {
    mobile_last_4: '5598',
    date_of_birth: 'November 9 1995',
  });

  assert.equal(dobResult.ok, true);
  assert.match(dobResult.summary, /verification complete/i);
  assert.equal(dobResult.data?.verified, true);
  assert.equal(dobResult.data?.mobile_step_verified, true);
});

test('executeStableTool verifies DOB from conversational transcripts', () => {
  const persona = getPersonaById('cust_demo_003');
  assert.ok(persona);

  const dobResult = executeStableTool(persona, 'verify_read_access', {
    mobile_last_4: '5598',
    date_of_birth: "yeah so my date of birth is November the 9th, 1995 — that's correct",
  });

  assert.equal(dobResult.ok, true);
  assert.equal(dobResult.data?.verified, true);
});

test('executeStableTool returns dob_parse_failed when DOB text is not a parseable date', () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const gibberish = executeStableTool(persona, 'verify_read_access', {
    mobile_last_4: '3210',
    date_of_birth: 'purple elephant forty two',
  });
  assert.equal(gibberish.ok, false);
  assert.equal(gibberish.data?.verification_step, 'dob_required');
  assert.equal(gibberish.data?.dob_parse_failed, true);
  assert.match(gibberish.summary, /Ek baar phir clearly bata dijiye, date, month aur year/i);
  assert.doesNotMatch(gibberish.summary, /paidaish|readable tareekh|rigid format/i);
});

test('executeStableTool keeps legacy verification aliases working internally', () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const mobileResult = executeStableTool(persona, 'find_customer_by_mobile_last_4', { mobile_last_4: '3210' });
  const dobResult = executeStableTool(persona, 'verify_customer_dob', { date_of_birth: '1991-08-14' });

  assert.equal(mobileResult.ok, true);
  assert.equal(mobileResult.data?.verification_step, 'dob_required');
  assert.equal(dobResult.ok, true);
  assert.equal(dobResult.data?.verified, true);
});

test('executeStableTool rejects mismatched verification without exposing customer records', () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const mobileResult = executeStableTool(persona, 'verify_read_access', { mobile_last_4: '9999' });
  const dobResult = executeStableTool(persona, 'verify_read_access', {
    mobile_last_4: '3210',
    date_of_birth: '1992-08-14',
  });

  assert.equal(mobileResult.ok, false);
  assert.match(mobileResult.summary, /match nahi hua/i);
  assert.equal(mobileResult.data?.verified, false);
  assert.equal(mobileResult.data?.mobile_step_verified, false);
  assert.equal('payments' in (mobileResult.data ?? {}), false);
  assert.equal(dobResult.ok, false);
  assert.match(dobResult.summary, /date of birth match nahi hua/i);
  assert.equal(dobResult.data?.mobile_step_verified, true);
});

test('executeStableTool reads payment reconciliation status with Project.md safe phrasing', () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const result = executeStableTool(persona, 'get_payment_reconciliation_status', { reference: 'UTR45791034' });

  assert.equal(result.ok, true);
  assert.match(result.summary, /pending reconciliation/i);
  assert.match(result.summary, /aapka paisa safe hai/i);
  assert.match(result.summary, /worst case mein refund mil jayega, koi loss nahi hoga/i);
  assert.match(result.summary, /PAY-8831/);
  assert.equal(result.data?.payment_reference, 'PAY-8831');
  assert.equal(result.data?.intent_id, 'payment.failed');
});

test('executeStableTool asks which payment when a customer has multiple payments and no reference', () => {
  const persona = getPersonaById('cust_demo_004');
  assert.ok(persona);

  const result = executeStableTool(persona, 'get_payment_reconciliation_status');

  assert.equal(result.ok, false);
  assert.match(result.summary, /Kaunsa payment/i);
  assert.match(result.summary, /PAY-4412/);
  assert.match(result.summary, /PAY-5148/);
  assert.equal(result.data?.match_count, 2);
});

test('executeStableTool can identify a payment by amount when multiple payments exist', () => {
  const persona = getPersonaById('cust_demo_004');
  assert.ok(persona);

  const result = executeStableTool(persona, 'get_payment_reconciliation_status', { reference: '60000' });

  assert.equal(result.ok, true);
  assert.match(result.summary, /PAY-5148/);
  assert.equal(result.data?.payment_reference, 'PAY-5148');
});

test('executeStableTool asks which fixed deposit when a customer has multiple FDs and no identifier', () => {
  const persona = getPersonaById('cust_demo_004');
  assert.ok(persona);

  const result = executeStableTool(persona, 'get_fd_booking_status');

  assert.equal(result.ok, false);
  assert.match(result.summary, /Kaunsi FD/i);
  assert.match(result.summary, /FD-4412/);
  assert.match(result.summary, /FD-5148/);
  assert.equal(result.data?.match_count, 2);
});

test('executeStableTool can identify a fixed deposit by bank, amount, or compact alias', () => {
  const persona = getPersonaById('cust_demo_004');
  assert.ok(persona);
  const singleFdPersona = getPersonaById('cust_demo_001');
  assert.ok(singleFdPersona);

  const bankResult = executeStableTool(persona, 'get_fd_booking_status', { fd_id: 'Mahindra Finance' });
  const amountResult = executeStableTool(persona, 'get_fd_booking_status', { fd_id: '200000' });
  const aliasResult = executeStableTool(singleFdPersona, 'get_fd_booking_status', { fd_id: 'FD8110' });

  assert.equal(bankResult.ok, true);
  assert.equal(bankResult.data?.fd_id, 'FD-5148');
  assert.equal(amountResult.ok, true);
  assert.equal(amountResult.data?.fd_id, 'FD-4412');
  assert.equal(aliasResult.ok, true);
  assert.equal(aliasResult.data?.fd_id, 'FD-8110');
});

test('executeStableTool quotes premature withdrawal and refuses irreversible execution', () => {
  const persona = getPersonaById('cust_demo_004');
  assert.ok(persona);

  const quote = executeStableTool(persona, 'get_premature_withdrawal_quote', {
    fd_id: 'FD-4412',
  });

  assert.equal(quote.ok, true);
  assert.equal(quote.data?.estimated_value, 193000);
  assert.equal(quote.data?.penalty, 7000);

  const result = executeStableTool(persona, 'send_secure_link', {
    action: 'premature_withdrawal',
    fd_id: 'FD-4412',
  });

  assert.equal(result.ok, true);
  assert.match(result.summary, /secure link/i);
  assert.match(result.summary, /execute nahi hota/i);
});

test('executeStableTool reads support ticket status for a verified caller', () => {
  const persona = getPersonaById('cust_demo_003');
  assert.ok(persona);

  const result = executeStableTool(persona, 'get_support_ticket_status', { ticket_id: 'TKT-10052' });

  assert.equal(result.ok, true);
  assert.match(result.summary, /TKT-10052/);
  assert.match(result.summary, /in progress/i);
  assert.match(result.summary, /within 48 hours/i);
  assert.equal(result.data?.ticket_id, 'TKT-10052');
  assert.equal(result.data?.status, 'in_progress');
  assert.equal(result.data?.sla, 'within 48 hours');
});

test('executeStableTool returns Project.md public facts, SLAs, disclosures, rates, and support contact', () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const trust = executeStableTool(persona, 'get_trust_facts');
  assert.equal(trust.ok, true);
  assert.match(trust.summary, /Stable Alpha Technologies Private Limited/);
  assert.match(trust.summary, /DICGC/i);

  const slas = executeStableTool(persona, 'get_canonical_slas');
  assert.equal(slas.data?.payment_reconciliation, 'booking may complete, otherwise refund usually reflects within 5 working days');
  assert.equal(slas.data?.kyc_pending_review, 'usually within 24 working hours');

  const disclosure = executeStableTool(persona, 'get_disclosure_copy', { topic: 'fd' });
  assert.match(disclosure.summary, /Stable Money is a distributor/);
  assert.match(disclosure.summary, /insured up to 5 lakh rupees/);

  const rates = executeStableTool(persona, 'get_fd_rates', { tenure: '12 months' });
  assert.equal(rates.ok, true);
  assert.match(rates.summary, /rates compare/i);
  assert.doesNotMatch(rates.summary, /best FD/i);
  assert.match(JSON.stringify(rates.data), /senior/i);

  const contact = executeStableTool(persona, 'get_support_contact');
  assert.equal(contact.ok, true);
  assert.match(contact.summary, /10 AM se 7 PM IST, Monday to Saturday/);
});

test('executeStableToolWithContext enforces Tier B auth for account reads but allows Tier A tools', async () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const blocked = await executeStableToolWithContext(persona, 'get_payment_reconciliation_status', {
    reference: 'PAY-8831',
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.data?.auth_required, true);

  const allowed = await executeStableToolWithContext(persona, 'get_trust_facts');
  assert.equal(allowed.ok, true);

  const verified = await executeStableToolWithContext(
    persona,
    'get_payment_reconciliation_status',
    { reference: 'PAY-8831' },
    { callVerified: true },
  );
  assert.equal(verified.ok, true);
  assert.equal(verified.data?.payment_reference, 'PAY-8831');
});

test('executeStableToolWithContext accepts DOB when AI says match (mocked)', async () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const priorKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'sk-test';
  const fetcher: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        output_parsed: { verdict: 'match', reason: 'Same calendar day.' },
      }),
      { status: 200 },
    );

  try {
    const result = await executeStableToolWithContext(
      persona,
      'verify_read_access',
      { mobile_last_4: persona.mobile_last_4, date_of_birth: 'fourteen eight ninety-one' },
      { fetcher },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data?.verified, true);
  } finally {
    if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = priorKey;
  }
});

test('executeStableToolWithContext overrides AI no_match when deterministic DOB matches', async () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const priorKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'sk-test';
  const fetcher: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        output_parsed: { verdict: 'no_match', reason: 'Misread transcript.' },
      }),
      { status: 200 },
    );

  try {
    const result = await executeStableToolWithContext(
      persona,
      'verify_read_access',
      { mobile_last_4: persona.mobile_last_4, date_of_birth: '1991-08-14' },
      { fetcher },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data?.verified, true);
  } finally {
    if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = priorKey;
  }
});

test('executeStableToolWithContext respects skipAiDobVerification (parse-only path)', async () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const priorKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'sk-test';
  let fetchCalls = 0;
  const fetcher: typeof fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ output_parsed: { verdict: 'no_match', reason: 'x' } }), { status: 200 });
  };

  try {
    const result = await executeStableToolWithContext(
      persona,
      'verify_read_access',
      { mobile_last_4: persona.mobile_last_4, date_of_birth: '1991-08-14' },
      { fetcher, skipAiDobVerification: true },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data?.verified, true);
    assert.equal(fetchCalls, 0);
  } finally {
    if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = priorKey;
  }
});
