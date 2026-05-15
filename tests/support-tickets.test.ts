import test from 'node:test';
import assert from 'node:assert/strict';

import { addOrReuseSupportTicket } from '../lib/agent/support-tickets';
import type { SupportTicketSeed } from '../lib/personas';

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
