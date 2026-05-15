# Email Follow-Up Tools Design

## Goal

Make the agent's `create_support_ticket` and `send_secure_link` tools perform the promised follow-up during tool execution. The caller should hear only what actually happened: ticket created or reused, secure link found, and whether the email was sent.

## Approach

Use direct Gmail SMTP sending from the Next.js server tool path. The app reads Gmail sender settings from environment variables and sends immediately before returning the tool result. This avoids a separate job worker and matches the current demo expectation that a tool call performs the follow-up now.

Required environment variables:

- `GMAIL_USER`
- `GMAIL_APP_PASSWORD`
- `GMAIL_FROM_NAME`
- `APP_BASE_URL` or `NEXT_PUBLIC_APP_URL`

The sender code must never log secrets. If Gmail configuration is missing or SMTP fails, the tool still returns a structured result with `email_sent: false` and `email_error`, and the spoken summary must not claim delivery.

## Support Ticket Flow

`create_support_ticket` receives an issue and priority. It looks up the session row, reuses an open/in-progress ticket for the same normalized issue or appends a new ticket to `open_tickets`, then sends an email to `demo_users.email`.

The email includes:

- Ticket ID
- Created vs existing status
- Issue summary
- Priority
- SLA
- Human support hours

The tool result includes the ticket data plus `email_sent`, `email_to`, and optional `email_error`.

## Secure Link Flow

`send_secure_link` must be executable with session context after required verification. It looks up the session row, finds a matching `secure_links` item by action and optional FD ID, sends the secure follow-up email to `demo_users.email`, updates that secure link status to `sent`, and returns the link state.

The demo link will be generated as a deterministic app URL rather than executing the sensitive action. It will include session, action, and FD context in query parameters so the email has a concrete CTA without voice execution.

The email includes:

- Requested action
- FD ID when available
- Expiry window
- Clear statement that the action must be completed through the secure link

The tool result includes `email_sent`, `email_to`, `secure_url`, and optional `email_error`.

## Agent Prompt Changes

The agent instructions should become explicit:

- For complaints, escalations, grievances, failed follow-ups, or "raise a ticket", call `create_support_ticket`.
- For Tier C secure actions, after verification and any quote/check, call `send_secure_link`.
- Do not say an email was sent unless the tool result says `email_sent: true`.
- If email sending fails, apologize briefly and mention that the ticket/link was prepared but the email could not be sent right now.

Tool descriptions should say "create and email" / "send by email" so the model chooses them naturally.

## Testing

Add unit coverage for:

- Email rendering and SMTP send path using a fake transport.
- Ticket creation/reuse includes email metadata.
- Secure link send updates link status to `sent`.
- Agent request/prompt text contains the stricter tool-use rules.

Network SMTP is not exercised in tests.
