import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getDemoCallVerifiedFallbackForTests,
  getDemoCallVerifiedMobileLastFour,
  getPersistedDemoCallVerified,
  markDemoCallVerifiedFallbackForTests,
  markDemoCallVerifiedMobileLastFour,
  markPersistedDemoCallVerified,
  resetDemoCallStateForTests,
  resolveDemoSessionId,
} from '../lib/session-auth';

test('resolveDemoSessionId accepts matching explicit and cookie session ids', () => {
  const result = resolveDemoSessionId({
    explicitSessionId: 'session-1234567890',
    cookieSessionId: 'session-1234567890',
  });

  assert.deepEqual(result, { ok: true, sessionId: 'session-1234567890' });
});

test('resolveDemoSessionId rejects an explicit session id that does not match the cookie', () => {
  const result = resolveDemoSessionId({
    explicitSessionId: 'attacker-session-123',
    cookieSessionId: 'real-session-456789',
  });

  assert.deepEqual(result, {
    ok: false,
    status: 403,
    error: 'Session does not match this browser',
  });
});

test('resolveDemoSessionId preserves demo compatibility when there is no cookie', () => {
  const result = resolveDemoSessionId({
    explicitSessionId: 'shared-demo-session-123',
    cookieSessionId: undefined,
  });

  assert.deepEqual(result, { ok: true, sessionId: 'shared-demo-session-123' });
});

test('demo call verification is keyed by session and call id', () => {
  resetDemoCallStateForTests();

  assert.equal(getDemoCallVerifiedFallbackForTests('session-1234567890', 'call-a'), false);
  markDemoCallVerifiedFallbackForTests('session-1234567890', 'call-a');

  assert.equal(getDemoCallVerifiedFallbackForTests('session-1234567890', 'call-a'), true);
  assert.equal(getDemoCallVerifiedFallbackForTests('session-1234567890', 'call-b'), false);
  assert.equal(getDemoCallVerifiedFallbackForTests('session-other-1234', 'call-a'), false);
});

test('demo call mobile gate is keyed by session and call id and clears on full verify', () => {
  resetDemoCallStateForTests();

  assert.equal(getDemoCallVerifiedMobileLastFour('session-1234567890', 'call-a'), null);
  markDemoCallVerifiedMobileLastFour('session-1234567890', 'call-a', '3210');
  assert.equal(getDemoCallVerifiedMobileLastFour('session-1234567890', 'call-a'), '3210');
  assert.equal(getDemoCallVerifiedMobileLastFour('session-1234567890', 'call-b'), null);

  markDemoCallVerifiedFallbackForTests('session-1234567890', 'call-a');
  assert.equal(getDemoCallVerifiedMobileLastFour('session-1234567890', 'call-a'), null);
});

test('persisted demo call verification reads from Postgres by session and call id', async () => {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      return { rowCount: 1 };
    },
  };

  const verified = await getPersistedDemoCallVerified(pool, 'session-1234567890', 'call-a');

  assert.equal(verified, true);
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /FROM demo_call_verifications/);
  assert.deepEqual(queries[0].params, ['session-1234567890', 'call-a']);
});

test('persisted demo call verification writes an idempotent verified row', async () => {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      return { rowCount: 1 };
    },
  };

  await markPersistedDemoCallVerified(pool, 'session-1234567890', 'call-a');

  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /INSERT INTO demo_call_verifications/);
  assert.match(queries[0].sql, /ON CONFLICT/);
  assert.deepEqual(queries[0].params, ['session-1234567890', 'call-a']);
});
