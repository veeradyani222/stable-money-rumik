import test from 'node:test';
import assert from 'node:assert/strict';

import { getPersonaById } from '../lib/personas';
import { buildPersonaBrief, getPersonaSuggestions } from '../lib/agent/persona-suggestions';

test('buildPersonaBrief exposes the selected persona without leaking internal JSON', () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const brief = buildPersonaBrief(persona);

  assert.equal(brief.name, 'Ananya Sharma');
  assert.equal(brief.customerId, 'cust_demo_001');
  assert.match(brief.statusLine, /KYC - Pending review/);
  assert.match(brief.moneyLine, /PAY-8831/);
  assert.doesNotMatch(JSON.stringify(brief), /"payments":/);
});

test('getPersonaSuggestions prioritizes tasks available for a payment-failed persona', () => {
  const persona = getPersonaById('cust_demo_001');
  assert.ok(persona);

  const suggestions = getPersonaSuggestions(persona);
  const ids = suggestions.map((suggestion) => suggestion.id);

  assert.deepEqual(ids.slice(0, 3), ['payment-status', 'fd-booking-status', 'kyc-status']);
  assert.ok(suggestions.every((suggestion) => suggestion.prompt.length > 12));
});

test('getPersonaSuggestions includes secure-link and premature withdrawal actions when available', () => {
  const persona = getPersonaById('cust_demo_004');
  assert.ok(persona);

  const ids = getPersonaSuggestions(persona).map((suggestion) => suggestion.id);

  assert.ok(ids.includes('premature-withdrawal'));
  assert.ok(ids.includes('secure-link'));
});
