import test from 'node:test';
import assert from 'node:assert/strict';

import { matchCallerDobWithPersonaAi } from '@/lib/agent/dob-verification-ai';

test('matchCallerDobWithPersonaAi returns unclear when utterance is empty', async () => {
  const r = await matchCallerDobWithPersonaAi({
    apiKey: 'sk-test',
    callerUtterance: '   ',
    recordIsoDate: '1991-08-14',
    fetcher: async () => new Response('should not be called', { status: 500 }),
  });
  assert.equal(r.verdict, 'unclear');
  assert.equal(r.modelAnswered, false);
});

test('matchCallerDobWithPersonaAi reads output_parsed verdict', async () => {
  const fetcher: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        output_parsed: { verdict: 'match', reason: 'Caller stated 14 Aug 1991.' },
      }),
      { status: 200 },
    );

  const r = await matchCallerDobWithPersonaAi({
    apiKey: 'sk-test',
    callerUtterance: '14th August 1991',
    recordIsoDate: '1991-08-14',
    fetcher,
  });
  assert.equal(r.verdict, 'match');
  assert.equal(r.modelAnswered, true);
});

test('matchCallerDobWithPersonaAi returns unclear on HTTP error', async () => {
  const fetcher: typeof fetch = async () => new Response('bad', { status: 500 });
  const r = await matchCallerDobWithPersonaAi({
    apiKey: 'sk-test',
    callerUtterance: 'some words',
    recordIsoDate: '1991-08-14',
    fetcher,
  });
  assert.equal(r.verdict, 'unclear');
  assert.equal(r.modelAnswered, false);
});

test('matchCallerDobWithPersonaAi returns unclear on malformed JSON body', async () => {
  const fetcher: typeof fetch = async () =>
    new Response(JSON.stringify({ output_text: '{"verdict":"maybe"}' }), { status: 200 });

  const r = await matchCallerDobWithPersonaAi({
    apiKey: 'sk-test',
    callerUtterance: 'some words',
    recordIsoDate: '1991-08-14',
    fetcher,
  });
  assert.equal(r.verdict, 'unclear');
  assert.equal(r.modelAnswered, false);
});
