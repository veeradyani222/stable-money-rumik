import test from 'node:test';
import assert from 'node:assert/strict';

import { getDeepgramGrantErrorMessage, getDeepgramListenProtocols } from '../lib/voice/deepgram-token';

test('getDeepgramGrantErrorMessage explains insufficient key permission', () => {
  const message = getDeepgramGrantErrorMessage(403, {
    err_code: 'FORBIDDEN',
    err_msg: 'Insufficient permissions.',
  });

  assert.match(message, /Member permission/i);
  assert.match(message, /Deepgram API key/i);
});

test('getDeepgramGrantErrorMessage keeps provider message for other failures', () => {
  const message = getDeepgramGrantErrorMessage(401, {
    err_msg: 'Invalid credentials.',
  });

  assert.equal(message, 'Deepgram token request failed: Invalid credentials.');
});

test('getDeepgramListenProtocols uses bearer auth for temporary JWTs', () => {
  assert.deepEqual(getDeepgramListenProtocols('ey.fake.jwt'), ['bearer', 'ey.fake.jwt']);
});
