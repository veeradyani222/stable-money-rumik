import test from 'node:test';
import assert from 'node:assert/strict';

import { getPersonaById } from '../lib/personas';
import { buildPersonaDetailSections } from '../lib/agent/persona-panel';

test('buildPersonaDetailSections groups persona arrays into readable tables', () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const sections = buildPersonaDetailSections(persona);
  const identitySection = sections.find((section) => section.title === 'Identity');
  const paymentSection = sections.find((section) => section.title === 'Payments');

  assert.ok(identitySection);
  assert.deepEqual(identitySection.rows.find((row) => row.id === 'dob')?.cells, ['Date of birth', '14-08-1991']);
  assert.ok(paymentSection);
  assert.deepEqual(paymentSection.columns, ['Reference', 'Amount', 'Bank', 'Status', 'ETA']);
  assert.equal(paymentSection.rows[0]?.cells[0], 'PAY-8831');
  assert.match(paymentSection.rows[0]?.cells[1] ?? '', /50,000/);
});
