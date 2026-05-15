import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldLogDiagnosticEvent } from '../lib/diagnostics/log-filter';

test('diagnostic log filter drops routine voice and agent events', () => {
  assert.equal(shouldLogDiagnosticEvent({ event: 'rumik:socket:open' }), false);
  assert.equal(shouldLogDiagnosticEvent({ event: 'rumik:message:binary' }), false);
  assert.equal(shouldLogDiagnosticEvent({ event: 'realtime:data-channel:open' }), false);
  assert.equal(shouldLogDiagnosticEvent({ event: 'agent:response' }), false);
});

test('diagnostic log filter keeps failures and missing configuration', () => {
  assert.equal(shouldLogDiagnosticEvent({ event: 'rumik:socket:error' }), true);
  assert.equal(shouldLogDiagnosticEvent({ event: 'rumik:opening-cache:timeout' }), true);
  assert.equal(shouldLogDiagnosticEvent({ event: 'realtime:sdp:error' }), true);
  assert.equal(shouldLogDiagnosticEvent({ event: 'config:missing-api-key' }), true);
});

test('diagnostic log filter keeps agent route and tool execution logs', () => {
  assert.equal(shouldLogDiagnosticEvent({ label: '[stable-agent:route]', event: 'route' }), true);
  assert.equal(shouldLogDiagnosticEvent({ label: '[stable-agent:tool]', event: 'start' }), true);
  assert.equal(shouldLogDiagnosticEvent({ label: '[stable-agent:tool]', event: 'result' }), true);
});
