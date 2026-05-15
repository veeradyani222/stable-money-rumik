import { getPool } from '@/lib/db';
import type { StableToolResult } from '@/lib/agent/stable-tools';
import type { SupportTicketSeed } from '@/lib/personas';

export interface SupportTicketInput {
  issue: string;
  priority: 'low' | 'medium' | 'high';
  now?: Date;
}

export interface SupportTicketChange {
  created: boolean;
  ticket: SupportTicketSeed;
  tickets: SupportTicketSeed[];
}

function normalizeIssue(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function ticketIdFromTime(now: Date): string {
  const suffix = String(Math.abs(now.getTime()) % 100000).padStart(5, '0');
  return `TKT-${suffix}`;
}

function safePriority(value: string): SupportTicketSeed['priority'] {
  return value === 'low' || value === 'high' ? value : 'medium';
}

export function addOrReuseSupportTicket(
  existingTickets: SupportTicketSeed[],
  input: SupportTicketInput,
): SupportTicketChange {
  const issue = input.issue.trim() || 'Customer requested support follow-up';
  const normalizedIssue = normalizeIssue(issue);
  const existing = existingTickets.find(
    (ticket) =>
      (ticket.status === 'open' || ticket.status === 'in_progress') &&
      normalizeIssue(ticket.issue) === normalizedIssue,
  );

  if (existing) {
    return { created: false, ticket: existing, tickets: existingTickets };
  }

  const now = input.now ?? new Date();
  const ticket: SupportTicketSeed = {
    ticket_id: ticketIdFromTime(now),
    issue,
    priority: safePriority(input.priority),
    status: 'open',
    sla: 'within 48 hours',
    escalation_reason: 'Customer requested support ticket',
    created_at: now.toISOString(),
  };

  return {
    created: true,
    ticket,
    tickets: [...existingTickets, ticket],
  };
}

export async function createSupportTicketForSession(
  sessionId: string,
  input: Pick<SupportTicketInput, 'issue' | 'priority'>,
): Promise<StableToolResult> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT open_tickets
     FROM demo_users
     WHERE session_id = $1
     LIMIT 1`,
    [sessionId],
  );

  if (result.rowCount === 0) {
    return { ok: false, summary: 'Session not found, so I could not create a support ticket.' };
  }

  const row = result.rows[0] as { open_tickets: SupportTicketSeed[] | null };
  const existingTickets = Array.isArray(row.open_tickets) ? row.open_tickets : [];
  const change = addOrReuseSupportTicket(existingTickets, {
    issue: input.issue,
    priority: safePriority(input.priority),
  });

  if (change.created) {
    await pool.query(
      `UPDATE demo_users
       SET open_tickets = $2::jsonb
       WHERE session_id = $1`,
      [sessionId, JSON.stringify(change.tickets)],
    );
  }

  return {
    ok: true,
    summary: change.created
      ? `Support ticket ${change.ticket.ticket_id} created for: ${change.ticket.issue}. Human fallback is available 10:00-19:00 IST, Monday to Saturday.`
      : `A support ticket already exists for this issue: ${change.ticket.ticket_id}. Status is ${change.ticket.status}.`,
    data: {
      ...change.ticket,
      created: change.created,
    },
  };
}
