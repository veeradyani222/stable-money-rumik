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

test('pushRumikTextDelta emits a long clause at a comma so first audio can start sooner', () => {
  const buffer = createRumikChunkBuffer();

  const chunks = pushRumikTextDelta(
    buffer,
    '[neutral] Ji, maine aapka payment status check kar liya hai, amount partner bank se reconcile ho raha hai',
  );

  assert.deepEqual(chunks, ['[neutral] Ji, maine aapka payment status check kar liya hai,']);
  assert.equal(buffer.pending, 'amount partner bank se reconcile ho raha hai');
});

test('flushRumikChunkBuffer emits remaining pending text once the stream ends', () => {
  const buffer = createRumikChunkBuffer();

  assert.deepEqual(pushRumikTextDelta(buffer, '[happy] Payment successful hai'), []);
  assert.equal(flushRumikChunkBuffer(buffer), '[happy] Payment successful hai');
  assert.equal(buffer.pending, '');
});
