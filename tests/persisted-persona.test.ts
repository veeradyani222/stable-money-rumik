import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { buildPersonaFromDemoUserRow } from '../lib/demo-users';

const agentSessionRouteSource = fs.readFileSync(
  path.join(process.cwd(), 'app', 'api', 'agent', 'session', 'route.ts'),
  'utf8',
);
const agentRespondRouteSource = fs.readFileSync(
  path.join(process.cwd(), 'app', 'api', 'agent', 'respond', 'route.ts'),
  'utf8',
);
const agentRespondStreamRouteSource = fs.readFileSync(
  path.join(process.cwd(), 'app', 'api', 'agent', 'respond-stream', 'route.ts'),
  'utf8',
);

test('buildPersonaFromDemoUserRow returns the persisted editable persona fields', () => {
  const persona = buildPersonaFromDemoUserRow({
    persona_id: 'cust_demo_004',
    customer_id: 'cust_demo_004',
    name: 'Arjun Kapoor',
    mobile_last_4: '1123',
    date_of_birth: '1993-07-30',
    kyc_status: 'approved',
    kyc_rejection_reason: null,
    kyc_eta: null,
    kyc_next_step: null,
    payments: [],
    fixed_deposits: [],
    open_tickets: [
      {
        ticket_id: 'TKT-90001',
        issue: 'Need help with FD payout',
        priority: 'high',
        status: 'open',
        sla: 'within 48 hours',
        escalation_reason: 'Customer requested support ticket',
        created_at: '2026-05-12T09:30:00.000Z',
      },
    ],
    secure_links: [],
  });

  assert.ok(persona);
  assert.equal(persona.open_tickets[0]?.ticket_id, 'TKT-90001');
});

test('buildPersonaFromDemoUserRow falls back to seed data when editable JSON is missing', () => {
  const persona = buildPersonaFromDemoUserRow({
    persona_id: 'cust_demo_004',
    customer_id: null,
    name: null,
    mobile_last_4: null,
    date_of_birth: null,
    kyc_status: null,
    kyc_rejection_reason: null,
    kyc_eta: null,
    kyc_next_step: null,
    payments: null,
    fixed_deposits: null,
    open_tickets: null,
    secure_links: null,
  });

  assert.ok(persona);
  assert.equal(persona.name, 'Arjun Kapoor');
  assert.equal(persona.fixed_deposits.length, 2);
});

test('agent routes read SQL DATE values as text to avoid timezone-shifted DOBs', () => {
  for (const source of [agentSessionRouteSource, agentRespondRouteSource, agentRespondStreamRouteSource]) {
    assert.match(source, /date_of_birth::text AS date_of_birth/);
    assert.doesNotMatch(source, /mobile_last_4, date_of_birth,/);
  }
});
