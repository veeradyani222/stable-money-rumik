import { getPool } from '@/lib/db';
import type { StableToolResult } from '@/lib/agent/stable-tools';
import { sendGmailMessage, renderEmailTemplate, type GmailMessageInput, type GmailSendResult } from '@/lib/gmail';
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

export interface QueryResult<T> {
  rowCount: number;
  rows: T[];
}

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface CreateSupportTicketOptions {
  pool?: Queryable;
  now?: Date;
  sendEmail?: (message: GmailMessageInput) => Promise<GmailSendResult>;
}

function logSupportTicketEmail(
  _event: 'email_send_succeeded' | 'email_send_failed',
  _details: Record<string, unknown>,
): void {
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
  options: CreateSupportTicketOptions = {},
): Promise<StableToolResult> {
  const pool = (options.pool ?? getPool()) as Queryable;
  const result = await pool.query(
    `SELECT email, open_tickets
     FROM demo_users
     WHERE session_id = $1
     LIMIT 1`,
    [sessionId],
  );

  if (result.rowCount === 0) {
    return { ok: false, summary: 'Session not found, so I could not create a support ticket.' };
  }

  const row = result.rows[0] as { email: string; open_tickets: SupportTicketSeed[] | null };
  const existingTickets = Array.isArray(row.open_tickets) ? row.open_tickets : [];
  const change = addOrReuseSupportTicket(existingTickets, {
    issue: input.issue,
    priority: safePriority(input.priority),
    now: options.now,
  });

  if (change.created) {
    await pool.query(
      `UPDATE demo_users
       SET open_tickets = $2::jsonb
       WHERE session_id = $1`,
      [sessionId, JSON.stringify(change.tickets)],
    );
  }

  const mailer = options.sendEmail ?? sendGmailMessage;
  
  const title = `Support Ticket ${change.ticket.ticket_id}`;
  const htmlContent = `
    <p>Hi ${row.email},</p>
    <div class="info-box">
      <p><strong>${change.created ? 'Created:' : 'Already exists:'}</strong> Your Stable Money support ticket ${change.ticket.ticket_id}</p>
      <p><strong>Issue:</strong> ${change.ticket.issue}</p>
      <p><strong>Priority:</strong> <span style="text-transform: capitalize;">${change.ticket.priority}</span></p>
      <p><strong>Status:</strong> <span style="text-transform: capitalize;">${change.ticket.status}</span></p>
      <p><strong>SLA:</strong> ${change.ticket.sla}</p>
    </div>
    <p style="margin-top: 20px;">Human support is available 10:00-19:00 IST, Monday to Saturday.</p>
    <p>Best,<br>Stable Assist</p>
  `;

  const emailMessage: GmailMessageInput = {
    to: row.email,
    subject: `Support ticket ${change.ticket.ticket_id}`,
    text: [
      `Hi ${row.email},`,
      '',
      change.created
        ? `Your Stable Money support ticket ${change.ticket.ticket_id} has been created.`
        : `Your Stable Money support ticket ${change.ticket.ticket_id} already exists for this issue.`,
      '',
      `Issue: ${change.ticket.issue}`,
      `Priority: ${change.ticket.priority}`,
      `Status: ${change.ticket.status}`,
      `SLA: ${change.ticket.sla}`,
      '',
      'Human support is available 10:00-19:00 IST, Monday to Saturday.',
      '',
      'Stable Assist',
    ].join('\n'),
    html: renderEmailTemplate(title, htmlContent),
  };

  void mailer(emailMessage)
    .then((email) => {
      logSupportTicketEmail(email.sent ? 'email_send_succeeded' : 'email_send_failed', {
        session_id: sessionId,
        ticket_id: change.ticket.ticket_id,
        to: email.to,
        created: change.created,
        ...(email.error ? { error: email.error } : {}),
      });
    })
    .catch((error) => {
      logSupportTicketEmail('email_send_failed', {
        session_id: sessionId,
        ticket_id: change.ticket.ticket_id,
        to: row.email,
        created: change.created,
        error: error instanceof Error ? error.message : String(error),
      });
    });

  const summary = 'Support ticket create ho gaya hai. Confirmation email thodi der mein aa jayega.';

  return {
    ok: true,
    summary,
    data: {
      ...change.ticket,
      created: change.created,
      email_pending: true,
      email_to: row.email,
    },
  };
}
