import test from 'node:test';
import assert from 'node:assert/strict';

import { createRumikChunkBuffer, flushRumikChunkBuffer, pushRumikTextDelta } from '../lib/voice/rumik-streaming';

test('pushRumikTextDelta emits complete speakable sentences and keeps partial text pending', () => {
  const buffer = createRumikChunkBuffer();

  assert.deepEqual(pushRumikTextDelta(buffer, '[neutral] Ji, main account check kar rahi hoon. Aapka KYC '), [
    '[neutral] Ji, main account check kar rahi hoon.',
  ]);
  assert.equal(buffer.pending, 'Aapka KYC ');

  assert.deepEqual(pushRumikTextDelta(buffer, 'pending review mein hai.'), ['Aapka KYC pending review mein hai.']);
  assert.equal(buffer.pending, '');
});

test('pushRumikTextDelta does not split on commas mid-sentence', () => {
  const buffer = createRumikChunkBuffer();

  const chunks = pushRumikTextDelta(
    buffer,
    '[neutral] Ji, maine aapka payment status check kar liya hai, amount partner bank se reconcile ho raha hai',
  );

  assert.deepEqual(chunks, []);
  assert.equal(buffer.pending, '[neutral] Ji, maine aapka payment status check kar liya hai, amount partner bank se reconcile ho raha hai');
});

test('pushRumikTextDelta still emits sentence boundaries normally', () => {
  const buffer = createRumikChunkBuffer();

  const chunks = pushRumikTextDelta(
    buffer,
    '[neutral] Mobile verification complete ho gaya hai. Apni date of birth batayein.',
  );

  assert.deepEqual(chunks, [
    '[neutral] Mobile verification complete ho gaya hai.',
    'Apni date of birth batayein.',
  ]);
  assert.equal(buffer.pending, '');
});

test('pushRumikTextDelta uses a long-text fallback only when needed', () => {
  const buffer = createRumikChunkBuffer();

  const chunks = pushRumikTextDelta(
    buffer,
    '[neutral] Ji main aapka payment status check kar raha hoon aur details ko verify karne ke liye thoda aur wait kijiye please abhi main system se latest response le rahi hoon aur thoda patience rakhiyega',
  );

  assert.equal(chunks.length, 1);
  assert.match(chunks[0], /^\[neutral\] /);
  assert.equal(buffer.pending.length > 0, true);
});

test('flushRumikChunkBuffer emits remaining pending text once the stream ends', () => {
  const buffer = createRumikChunkBuffer();

  assert.deepEqual(pushRumikTextDelta(buffer, '[happy] Payment successful hai'), []);
  assert.equal(flushRumikChunkBuffer(buffer), '[happy] Payment successful hai');
  assert.equal(buffer.pending, '');
});
