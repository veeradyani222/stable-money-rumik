import test from 'node:test';
import assert from 'node:assert/strict';

import { matchCallerMobileLastFourAi } from '@/lib/agent/mobile-verification-ai';

test('matchCallerMobileLastFourAi returns unclear when utterance is empty', async () => {
  const r = await matchCallerMobileLastFourAi({
    apiKey: 'sk-test',
    callerUtterance: '   ',
    recordLastFour: '3210',
    fetcher: async () => new Response('should not be called', { status: 500 }),
  });
  assert.equal(r.verdict, 'unclear');
  assert.equal(r.modelAnswered, false);
  assert.equal(r.extractedLastFour, null);
});

test('matchCallerMobileLastFourAi returns unclear when record_last_four is not four digits', async () => {
  let called = false;
  const r = await matchCallerMobileLastFourAi({
    apiKey: 'sk-test',
    callerUtterance: 'one two three four',
    recordLastFour: '321',
    fetcher: async () => {
      called = true;
      return new Response('{}', { status: 200 });
    },
  });
  assert.equal(r.verdict, 'unclear');
  assert.equal(r.modelAnswered, false);
  assert.equal(called, false);
});

test('matchCallerMobileLastFourAi reads match verdict from output_parsed', async () => {
  const fetcher: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        output_parsed: { verdict: 'match', extracted_last_four: '1123', reason: 'Caller said one one two three.' },
      }),
      { status: 200 },
    );

  const r = await matchCallerMobileLastFourAi({
    apiKey: 'sk-test',
    callerUtterance: 'one one two three',
    recordLastFour: '1123',
    fetcher,
  });
  assert.equal(r.verdict, 'match');
  assert.equal(r.modelAnswered, true);
  assert.equal(r.extractedLastFour, '1123');
});

test('matchCallerMobileLastFourAi reads no_match with extracted digits', async () => {
  const fetcher: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        output_parsed: { verdict: 'no_match', extracted_last_four: '4567', reason: 'Caller stated different digits.' },
      }),
      { status: 200 },
    );

  const r = await matchCallerMobileLastFourAi({
    apiKey: 'sk-test',
    callerUtterance: 'char paanch chhe saat',
    recordLastFour: '1123',
    fetcher,
  });
  assert.equal(r.verdict, 'no_match');
  assert.equal(r.extractedLastFour, '4567');
});

test('matchCallerMobileLastFourAi accepts Urdu-script "ڈبل ون ٹو تھری" utterance and returns match', async () => {
  let receivedBody = '';
  const fetcher: typeof fetch = async (_url, init) => {
    receivedBody = String(init?.body);
    return new Response(
      JSON.stringify({
        output_parsed: { verdict: 'match', extracted_last_four: '1123', reason: 'Urdu digits map to 1 1 2 3.' },
      }),
      { status: 200 },
    );
  };

  const r = await matchCallerMobileLastFourAi({
    apiKey: 'sk-test',
    callerUtterance: 'ڈبل ون ٹو تھری',
    recordLastFour: '1123',
    fetcher,
  });
  assert.equal(r.verdict, 'match');
  assert.equal(r.extractedLastFour, '1123');
  // The user content is JSON-stringified twice (outer body and inner content), so
  // the inner record_last_four field appears with escaped quotes.
  assert.match(receivedBody, /ڈبل ون ٹو تھری/);
  assert.match(receivedBody, /record_last_four\\":\\"1123\\"/);
});

test('matchCallerMobileLastFourAi returns unclear on HTTP error', async () => {
  const fetcher: typeof fetch = async () => new Response('bad', { status: 500 });
  const r = await matchCallerMobileLastFourAi({
    apiKey: 'sk-test',
    callerUtterance: 'one two three four',
    recordLastFour: '1234',
    fetcher,
  });
  assert.equal(r.verdict, 'unclear');
  assert.equal(r.modelAnswered, false);
});

test('matchCallerMobileLastFourAi returns unclear on malformed JSON body', async () => {
  const fetcher: typeof fetch = async () =>
    new Response(JSON.stringify({ output_text: '{"verdict":"maybe"}' }), { status: 200 });

  const r = await matchCallerMobileLastFourAi({
    apiKey: 'sk-test',
    callerUtterance: 'one two three four',
    recordLastFour: '1234',
    fetcher,
  });
  assert.equal(r.verdict, 'unclear');
  assert.equal(r.modelAnswered, false);
});

test('matchCallerMobileLastFourAi ignores non-four-digit extracted_last_four', async () => {
  const fetcher: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        output_parsed: { verdict: 'unclear', extracted_last_four: '12', reason: 'Only two digits parsed.' },
      }),
      { status: 200 },
    );

  const r = await matchCallerMobileLastFourAi({
    apiKey: 'sk-test',
    callerUtterance: 'ek do',
    recordLastFour: '1234',
    fetcher,
  });
  assert.equal(r.verdict, 'unclear');
  assert.equal(r.extractedLastFour, null);
});
