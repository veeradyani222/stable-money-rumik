# Email Follow-Up Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `create_support_ticket` and `send_secure_link` send Gmail follow-up emails during tool execution.

**Architecture:** Add a focused server-side Gmail SMTP helper, keep support-ticket DB logic in `support-tickets.ts`, add a focused secure-link session helper, and pass both side-effect callbacks through the agent route context. Tool results include email delivery metadata so the agent speaks only confirmed outcomes.

**Tech Stack:** Next.js route handlers, Node `node:tls` SMTP client, PostgreSQL JSONB fields, `node:test`.

---

### Task 1: Gmail Sender

**Files:**
- Create: `lib/gmail.ts`
- Test: `tests/gmail.test.ts`

- [ ] **Step 1: Write failing tests**

Create tests for missing config, message rendering, and injected transport success/failure. Use a fake transport function so tests never touch the network.

- [ ] **Step 2: Implement Gmail helper**

Create `sendGmailMessage(input, options)` that reads `GMAIL_USER`, `GMAIL_APP_PASSWORD`, and `GMAIL_FROM_NAME`; builds plain-text RFC-style SMTP content; sends via injected transport or default Gmail SMTP over TLS; and returns `{ sent, to, error? }`.

- [ ] **Step 3: Run tests**

Run: `npm test -- tests/gmail.test.ts`

### Task 2: Ticket Email Side Effect

**Files:**
- Modify: `lib/agent/support-tickets.ts`
- Modify: `app/api/agent/respond/route.ts`
- Modify: `app/api/agent/respond-stream/route.ts`
- Test: `tests/support-tickets.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that `createSupportTicketForSession` reads session email, creates/reuses a ticket, calls the injected mailer, and returns `email_sent`, `email_to`, and `email_error` correctly.

- [ ] **Step 2: Implement ticket email send**

Update the DB query to select `email, open_tickets`. After ticket create/reuse, call the mailer with a clear ticket confirmation subject/body. Include email delivery metadata in `StableToolResult.data` and a Rumik-safe summary.

- [ ] **Step 3: Wire route context**

No route API change is needed for tickets because `createSupportTicketForSession(sessionId, args)` can use the default mailer internally.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/support-tickets.test.ts`

### Task 3: Secure Link Email Side Effect

**Files:**
- Create: `lib/agent/secure-links.ts`
- Modify: `lib/agent/stable-tools.ts`
- Modify: `lib/agent/openai-agent.ts`
- Modify: `app/api/agent/respond/route.ts`
- Modify: `app/api/agent/respond-stream/route.ts`
- Test: `tests/secure-links.test.ts`
- Test: `tests/stable-tools.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests for selecting a ready secure link by action and FD, sending email, marking the link `sent`, returning `secure_url`, and returning a non-email failure when no matching link exists.

- [ ] **Step 2: Implement secure link session helper**

Create `sendSecureLinkForSession(sessionId, args, options)` that selects `email, secure_links`, generates a deterministic app URL, sends the email, updates the matching JSONB item to `sent`, and returns a `StableToolResult`.

- [ ] **Step 3: Add tool context callback**

Extend `StableToolExecutionContext` and `BuildOpenAIResponseRequestInput.toolContext` with `sendSecureLink`. In `executeStableToolWithContext`, call the context callback when canonical tool is `send_secure_link`.

- [ ] **Step 4: Wire API routes**

Pass `sendSecureLink: (args) => sendSecureLinkForSession(sessionId, args)` in both non-streaming and streaming agent routes.

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/secure-links.test.ts tests/stable-tools.test.ts`

### Task 4: Agent Prompt And Tool Contract

**Files:**
- Modify: `lib/agent/stable-tools.ts`
- Modify: `lib/agent/openai-agent.ts`
- Test: `tests/openai-agent.test.ts`

- [ ] **Step 1: Write failing prompt/tool tests**

Assert the tool descriptions include email delivery language and agent instructions say to call `create_support_ticket` for complaint/escalation turns, call `send_secure_link` for Tier C secure actions, and not claim email delivery unless tool data says `email_sent: true`.

- [ ] **Step 2: Update descriptions and prompt**

Adjust tool descriptions and `buildStableAgentInstructions` lines. Keep voice summaries short and Rumik-safe.

- [ ] **Step 3: Run tests**

Run: `npm test -- tests/openai-agent.test.ts`

### Task 5: Full Verification

**Files:**
- No code files unless earlier tests reveal an integration issue.

- [ ] **Step 1: Run targeted tests**

Run: `npm test -- tests/gmail.test.ts tests/support-tickets.test.ts tests/secure-links.test.ts tests/stable-tools.test.ts tests/openai-agent.test.ts`

- [ ] **Step 2: Run full suite if targeted tests pass**

Run: `npm test`

- [ ] **Step 3: Document env keys**

Update `README.md` or existing project docs with `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `GMAIL_FROM_NAME`, and optional app base URL if added.
