import test from 'node:test';
import assert from 'node:assert/strict';

import { addOrReuseSupportTicket, createSupportTicketForSession } from '../lib/agent/support-tickets';
import type { GmailMessageInput, GmailSendResult } from '../lib/gmail';
import type { SupportTicketSeed } from '../lib/personas';

function queryResult<T>(rows: T[], rowCount = rows.length) {
  return { rowCount, rows };
}

test('addOrReuseSupportTicket appends a new support ticket', () => {
  const existing: SupportTicketSeed[] = [];

  const result = addOrReuseSupportTicket(existing, {
    issue: 'I want to raise a support ticket',
    priority: 'medium',
    now: new Date('2026-05-12T10:00:00.000Z'),
  });

  assert.equal(result.created, true);
  assert.equal(result.tickets.length, 1);
  assert.equal(result.ticket.issue, 'I want to raise a support ticket');
  assert.equal(result.ticket.status, 'open');
  assert.match(result.ticket.ticket_id, /^TKT-/);
});

test('addOrReuseSupportTicket reuses an open ticket for the same issue', () => {
  const existing: SupportTicketSeed[] = [
    {
      ticket_id: 'TKT-12345',
      issue: 'Payment debited but FD not booked',
      priority: 'high',
      status: 'open',
      sla: 'within 48 hours',
      escalation_reason: 'Customer requested support ticket',
      created_at: '2026-05-11T10:00:00.000Z',
    },
  ];

  const result = addOrReuseSupportTicket(existing, {
    issue: ' payment debited but fd not booked ',
    priority: 'medium',
    now: new Date('2026-05-12T10:00:00.000Z'),
  });

  assert.equal(result.created, false);
  assert.equal(result.ticket.ticket_id, 'TKT-12345');
  assert.equal(result.tickets.length, 1);
});

test('createSupportTicketForSession creates a ticket and queues email for the demo user', async () => {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const emails: GmailMessageInput[] = [];
  const pool = {
    query: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (/SELECT email, open_tickets/i.test(sql)) {
        return queryResult([{ email: 'customer@example.com', open_tickets: [] }] as unknown as T[]);
      }
      if (/UPDATE demo_users/i.test(sql)) return queryResult([] as T[], 0);
      return queryResult([] as T[], 0);
    },
  };

  const result = await createSupportTicketForSession(
    'demo-session-1234567890',
    { issue: 'Payment debited but FD not booked', priority: 'high' },
    {
      pool,
      now: new Date('2026-05-15T08:00:00.000Z'),
      sendEmail: async (message): Promise<GmailSendResult> => {
        emails.push(message);
        return { sent: true, to: message.to };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.summary, 'Support ticket create ho gaya hai. Confirmation email thodi der mein aa jayega.');
  assert.equal(result.data?.ticket_id, 'TKT-00000');
  assert.equal(result.data?.email_pending, true);
  assert.equal(result.data?.email_to, 'customer@example.com');
  assert.equal(emails.length, 1);
  assert.equal(emails[0]?.to, 'customer@example.com');
  assert.match(emails[0]?.subject ?? '', /Support ticket TKT-00000/i);
  assert.match(emails[0]?.text ?? '', /Payment debited but FD not booked/);
  assert.equal(queries.some((query) => /UPDATE demo_users/i.test(query.sql)), true);
});

test('createSupportTicketForSession returns before the confirmation email finishes sending', async () => {
  let finishEmail!: (result: GmailSendResult) => void;
  const emailPromise = new Promise<GmailSendResult>((resolve) => {
    finishEmail = resolve;
  });
  const pool = {
    query: async <T = Record<string, unknown>>(sql: string) => {
      if (/SELECT email, open_tickets/i.test(sql)) {
        return queryResult([{ email: 'customer@example.com', open_tickets: [] }] as unknown as T[]);
      }
      return queryResult([] as T[], 0);
    },
  };

  const ticketPromise = createSupportTicketForSession(
    'demo-session-1234567890',
    { issue: 'KYC help needed', priority: 'medium' },
    {
      pool,
      now: new Date('2026-05-15T08:00:00.000Z'),
      sendEmail: async () => emailPromise,
    },
  );

  const raced = await Promise.race([
    ticketPromise.then((result) => ({ type: 'result' as const, result })),
    new Promise<{ type: 'timeout' }>((resolve) => {
      setTimeout(() => resolve({ type: 'timeout' }), 20);
    }),
  ]);

  finishEmail({ sent: true, to: 'customer@example.com' });

  assert.equal(raced.type, 'result');
  if (raced.type === 'result') {
    assert.equal(raced.result.ok, true);
    assert.equal(raced.result.data?.email_pending, true);
  }
});

test('createSupportTicketForSession handles background email failures without console logging or delaying the ticket', async () => {
  const pool = {
    query: async <T = Record<string, unknown>>(sql: string) => {
      if (/SELECT email, open_tickets/i.test(sql)) {
        return queryResult([{ email: 'customer@example.com', open_tickets: [] }] as unknown as T[]);
      }
      return queryResult([] as T[], 0);
    },
  };

  const result = await createSupportTicketForSession(
    'demo-session-1234567890',
    { issue: 'KYC help needed', priority: 'medium' },
    {
      pool,
      now: new Date('2026-05-15T08:00:00.000Z'),
      sendEmail: async (): Promise<GmailSendResult> => ({
        sent: false,
        to: 'customer@example.com',
        error: 'Gmail configuration is missing.',
      }),
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(result.ok, true);
  assert.equal(result.summary, 'Support ticket create ho gaya hai. Confirmation email thodi der mein aa jayega.');
  assert.equal(result.data?.email_pending, true);
});
