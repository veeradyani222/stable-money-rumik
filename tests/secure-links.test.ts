import test from 'node:test';
import assert from 'node:assert/strict';

import { sendSecureLinkForSession } from '../lib/agent/secure-links';
import type { GmailMessageInput, GmailSendResult } from '../lib/gmail';
import type { SecureLinkSeed } from '../lib/personas';

function queryResult<T>(rows: T[], rowCount = rows.length) {
  return { rowCount, rows };
}

test('sendSecureLinkForSession emails a matching secure link and marks it sent', async () => {
  const emails: GmailMessageInput[] = [];
  const updates: SecureLinkSeed[][] = [];
  const secureLinks: SecureLinkSeed[] = [
    {
      action: 'premature_withdrawal',
      fd_id: 'FD-4412',
      status: 'ready_to_send',
      expires_in: '15 minutes',
    },
  ];
  const pool = {
    query: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
      if (/SELECT email, secure_links/i.test(sql)) {
        return queryResult([{ email: 'customer@example.com', secure_links: secureLinks }] as unknown as T[]);
      }
      if (/UPDATE demo_users/i.test(sql)) {
        updates.push(JSON.parse(String(params[1])) as SecureLinkSeed[]);
        return queryResult([] as T[], 0);
      }
      return queryResult([] as T[], 0);
    },
  };

  const result = await sendSecureLinkForSession(
    'demo-session-1234567890',
    { action: 'premature_withdrawal', fd_id: 'FD-4412' },
    {
      pool,
      appBaseUrl: 'https://demo.stable.test',
      sendEmail: async (message): Promise<GmailSendResult> => {
        emails.push(message);
        return { sent: true, to: message.to };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.match(result.summary, /secure link email bhej diya/i);
  assert.equal(result.data?.email_sent, true);
  assert.equal(result.data?.email_to, 'customer@example.com');
  assert.equal(result.data?.status, 'sent');
  assert.equal(result.data?.secure_url, 'https://demo.stable.test/secure-action?session_id=demo-session-1234567890&action=premature_withdrawal&fd_id=FD-4412');
  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.[0]?.status, 'sent');
  assert.equal(emails.length, 1);
  assert.equal(emails[0]?.to, 'customer@example.com');
  assert.match(emails[0]?.subject ?? '', /Secure link for premature withdrawal/i);
  assert.match(emails[0]?.text ?? '', /FD-4412/);
  assert.match(emails[0]?.text ?? '', /15 minutes/);
});

test('sendSecureLinkForSession does not email when no matching ready secure link exists', async () => {
  let emails = 0;
  const pool = {
    query: async <T = Record<string, unknown>>(sql: string) => {
      if (/SELECT email, secure_links/i.test(sql)) {
        return queryResult([{ email: 'customer@example.com', secure_links: [] }] as unknown as T[]);
      }
      return queryResult([] as T[], 0);
    },
  };

  const result = await sendSecureLinkForSession(
    'demo-session-1234567890',
    { action: 'premature_withdrawal', fd_id: 'FD-4412' },
    {
      pool,
      sendEmail: async (): Promise<GmailSendResult> => {
        emails += 1;
        return { sent: true, to: 'customer@example.com' };
      },
    },
  );

  assert.equal(result.ok, false);
  assert.match(result.summary, /ready secure link available nahi hai/i);
  assert.equal(result.data?.state, 'not_found');
  assert.equal(emails, 0);
});
