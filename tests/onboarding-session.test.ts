import test from 'node:test';
import assert from 'node:assert/strict';

import { createOnboardingSession, type Queryable, type QueryResult } from '../lib/onboarding-session';

function queryResult<T>(rows: T[], rowCount = rows.length): QueryResult<T> {
  return { rowCount, rows };
}

test('createOnboardingSession resumes an existing email with its old persona and clears old verification', async () => {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const pool: Queryable = {
    query: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> => {
      queries.push({ sql, params });
      if (/SELECT session_id, persona_id/i.test(sql)) {
        return queryResult([{ session_id: 'old-session-1234567890', persona_id: 'cust_demo_004' }] as unknown as T[]);
      }
      if (/UPDATE demo_users/i.test(sql)) {
        return queryResult([{ persona_id: 'cust_demo_004' }] as unknown as T[]);
      }
      return queryResult([] as T[], 0);
    },
  };

  const result = await createOnboardingSession(pool, {
    email: 'tester@example.com',
    sessionId: 'new-session-1234567890',
  });

  assert.deepEqual(result, {
    sessionId: 'new-session-1234567890',
    email: 'tester@example.com',
    personaId: 'cust_demo_004',
  });
  assert.match(queries[0].sql, /^BEGIN/i);
  assert.match(queries[1].sql, /SELECT session_id, persona_id/i);
  assert.match(queries[2].sql, /DELETE FROM demo_call_verifications/i);
  assert.deepEqual(queries[2].params, ['old-session-1234567890']);
  assert.match(queries[3].sql, /DELETE FROM demo_call_mobile_verifications/i);
  assert.deepEqual(queries[3].params, ['old-session-1234567890']);
  assert.match(queries[4].sql, /UPDATE demo_users/i);
  assert.deepEqual(queries[4].params, ['new-session-1234567890', 'old-session-1234567890']);
  assert.match(queries.at(-1)?.sql ?? '', /^COMMIT/i);
});

test('createOnboardingSession creates a new row when the email is new', async () => {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const pool: Queryable = {
    query: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> => {
      queries.push({ sql, params });
      if (/SELECT session_id, persona_id/i.test(sql)) return queryResult([] as T[], 0);
      if (/INSERT INTO demo_users/i.test(sql)) return queryResult([{ persona_id: null }] as unknown as T[]);
      return queryResult([] as T[], 0);
    },
  };

  const result = await createOnboardingSession(pool, {
    email: 'new@example.com',
    sessionId: 'new-session-1234567890',
  });

  assert.equal(result.personaId, null);
  assert.equal(queries.some((query) => /DELETE FROM demo_call_verifications/i.test(query.sql)), false);
  assert.equal(queries.some((query) => /INSERT INTO demo_users/i.test(query.sql)), true);
});
