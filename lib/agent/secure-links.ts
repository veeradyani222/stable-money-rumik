import { getPool } from '@/lib/db';
import { sendGmailMessage, renderEmailTemplate, type GmailMessageInput, type GmailSendResult } from '@/lib/gmail';
import type { StableToolResult } from '@/lib/agent/stable-tools';
import type { Queryable } from '@/lib/agent/support-tickets';
import type { SecureLinkSeed } from '@/lib/personas';

export interface SendSecureLinkInput {
  action: string;
  fd_id?: string;
}

export interface SendSecureLinkOptions {
  pool?: Queryable;
  appBaseUrl?: string;
  sendEmail?: (message: GmailMessageInput) => Promise<GmailSendResult>;
}

function clean(value: string): string {
  return value.trim().toLowerCase();
}

function spokenStatus(value: string): string {
  return value.replaceAll('_', ' ');
}

function findSecureLink(links: SecureLinkSeed[], input: SendSecureLinkInput): SecureLinkSeed | null {
  const action = input.action?.trim() || 'premature_withdrawal';
  return (
    links.find((link) => {
      const sameAction = clean(link.action) === clean(action);
      const sameFd = !input.fd_id || link.fd_id === input.fd_id;
      return sameAction && sameFd && link.status === 'ready_to_send';
    }) ?? null
  );
}

function secureActionUrl(sessionId: string, link: SecureLinkSeed, appBaseUrl?: string): string {
  const base = (appBaseUrl || process.env.NEXT_PUBLIC_APP_URL || process.env.APP_BASE_URL || 'http://localhost:3000')
    .replace(/\/+$/, '');
  const url = new URL('/secure-action', base);
  url.searchParams.set('session_id', sessionId);
  url.searchParams.set('action', link.action);
  if (link.fd_id) url.searchParams.set('fd_id', link.fd_id);
  return url.toString();
}

export async function sendSecureLinkForSession(
  sessionId: string,
  input: SendSecureLinkInput,
  options: SendSecureLinkOptions = {},
): Promise<StableToolResult> {
  const pool = (options.pool ?? getPool()) as Queryable;
  const result = await pool.query(
    `SELECT email, secure_links
     FROM demo_users
     WHERE session_id = $1
     LIMIT 1`,
    [sessionId],
  );

  if (result.rowCount === 0) {
    return { ok: false, summary: 'Session not found, so I could not send the secure link.' };
  }

  const row = result.rows[0] as { email: string; secure_links: SecureLinkSeed[] | null };
  const links = Array.isArray(row.secure_links) ? row.secure_links : [];
  const link = findSecureLink(links, input);
  if (!link) {
    return {
      ok: false,
      summary: '[neutral] Is action ke liye ready secure link available nahi hai. Main support ticket create kar sakti hoon.',
      data: { state: 'not_found' },
    };
  }

  const secureUrl = secureActionUrl(sessionId, link, options.appBaseUrl);
  const mailer = options.sendEmail ?? sendGmailMessage;

  const actionTitle = spokenStatus(link.action);
  const title = `Secure Link: <span style="text-transform: capitalize;">${actionTitle}</span>`;
  const htmlContent = `
    <p>Hi ${row.email},</p>
    <p>Here is your secure Stable Money link for <strong style="text-transform: capitalize;">${actionTitle}</strong>.</p>
    <div class="info-box">
      ${link.fd_id ? `<p><strong>Fixed Deposit ID:</strong> ${link.fd_id}</p>` : ''}
      ${link.expires_in ? `<p><strong>Expires In:</strong> ${link.expires_in}</p>` : ''}
      <a href="${secureUrl}" class="btn" target="_blank">Complete Action</a>
    </div>
    <p>For safety, this action is not completed on voice. Please use the secure link above to continue.</p>
    <p>Best,<br>Stable Assist</p>
  `;

  const email = await mailer({
    to: row.email,
    subject: `Secure link for ${actionTitle}`,
    text: [
      `Hi ${row.email},`,
      '',
      `Here is your secure Stable Money link for ${actionTitle}.`,
      link.fd_id ? `FD: ${link.fd_id}` : '',
      link.expires_in ? `This link expires in ${link.expires_in}.` : '',
      '',
      secureUrl,
      '',
      'For safety, this action is not completed on voice. Please use the secure link to continue.',
      '',
      'Stable Assist',
    ]
      .filter(Boolean)
      .join('\n'),
    html: renderEmailTemplate(title, htmlContent),
  });

  const updatedLink: SecureLinkSeed = {
    ...link,
    status: email.sent ? 'sent' : link.status,
  };
  const updatedLinks = links.map((item) => (item === link ? updatedLink : item));
  if (email.sent) {
    await pool.query(
      `UPDATE demo_users
       SET secure_links = $2::jsonb
       WHERE session_id = $1`,
      [sessionId, JSON.stringify(updatedLinks)],
    );
  }

  return {
    ok: true,
    summary: email.sent
      ? `[neutral] ${spokenStatus(link.action)} ke liye secure link email bhej diya. Yeh action voice par complete nahi hota.`
      : `[neutral] ${spokenStatus(link.action)} ke liye secure link ready hai, par email abhi nahi bhej paayi. Yeh action voice par complete nahi hota.`,
    data: {
      ...updatedLink,
      secure_url: secureUrl,
      voice_execution_allowed: false,
      email_sent: email.sent,
      email_to: email.to,
      ...(email.error ? { email_error: email.error } : {}),
    },
  };
}
