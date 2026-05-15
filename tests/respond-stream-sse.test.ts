import test from 'node:test';
import assert from 'node:assert/strict';

import { createSseWriter, encodeEvent } from '../app/api/agent/respond-stream/sse';

test('SSE writer ignores writes after close instead of throwing invalid state', () => {
  const chunks: Uint8Array[] = [];
  const writer = createSseWriter({
    enqueue(chunk) {
      chunks.push(chunk);
    },
    close() {
      // no-op
    },
  });

  writer.send('ready', { ok: true });
  writer.close();

  assert.doesNotThrow(() => {
    writer.send('route', { intent: 'payment.failed' });
    writer.sendRaw(new TextEncoder().encode('event: close\ndata: {}\n\n'));
    writer.close();
  });

  assert.equal(chunks.length, 1);
  assert.deepEqual(chunks[0], encodeEvent('ready', { ok: true }));
});

test('SSE writer swallows controller invalid-state errors raised by late callbacks', () => {
  let closed = false;
  const writer = createSseWriter({
    enqueue() {
      if (closed) {
        const error = new TypeError('Invalid state: Controller is already closed');
        (error as TypeError & { code?: string }).code = 'ERR_INVALID_STATE';
        throw error;
      }
    },
    close() {
      closed = true;
    },
  });

  writer.close();

  assert.doesNotThrow(() => writer.send('tool', { tool: 'verify_read_access' }));
});
