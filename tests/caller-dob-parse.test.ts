import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCallerDobToIsoDate } from '@/lib/caller-dob-parse';

const canonical = '2005-02-26';

const equivalentInputs = [
  '2005-02-26',
  'Feb 26 2005',
  'February 26, 2005',
  '26th February 2005',
  '26 February 2005',
  '26 feb 2005',
  '26/2/2005',
  '26-2-2005',
  '26.2.2005',
  '2005/2/26',
  '26th of February 2005',
  'February 26 2005',
  '2005 February 26',
  '2/26/2005',
];

test('parseCallerDobToIsoDate accepts many formats for the same calendar day', () => {
  for (const input of equivalentInputs) {
    const r = parseCallerDobToIsoDate(input);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.isoDate, canonical, `input: ${JSON.stringify(input)}`);
  }
});

test('parseCallerDobToIsoDate handles spoken numeric DOB transcripts', () => {
  const expected = '1991-08-14';
  const spoken = [
    'fourteen eight ninety one',
    'fourteen eight nineteen ninety one',
    'fourteenth august nineteen ninety one',
    'August fourteenth nineteen ninety one',
    'my date of birth is fourteen eight ninety one',
  ];

  for (const input of spoken) {
    const r = parseCallerDobToIsoDate(input);
    assert.equal(r.ok, true, `input: ${JSON.stringify(input)}`);
    if (r.ok) assert.equal(r.isoDate, expected, `input: ${JSON.stringify(input)}`);
  }
});

test('parseCallerDobToIsoDate matches persona-style ISO for August 1991', () => {
  const expected = '1991-08-14';
  const variants = ['1991-08-14', '14/8/1991', '14-08-1991', '14 August 1991', 'August 14, 1991', '14th August 1991'];
  for (const input of variants) {
    const r = parseCallerDobToIsoDate(input);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.isoDate, expected);
  }
});

test('parseCallerDobToIsoDate rejects gibberish', () => {
  assert.equal(parseCallerDobToIsoDate('not a date at all').ok, false);
  assert.equal(parseCallerDobToIsoDate('').ok, false);
  assert.equal(parseCallerDobToIsoDate('   ').ok, false);
  assert.equal(parseCallerDobToIsoDate('99/99/9999').ok, false);
});

test('parseCallerDobToIsoDate prefers India DMY when both segments are ≤ 12', () => {
  const r = parseCallerDobToIsoDate('5/6/1995');
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.isoDate, '1995-06-05');
});

test('parseCallerDobToIsoDate handles conversational wrappers and embedded phrasing', () => {
  const expected = '2005-02-26';
  const wrapped = [
    'yeah uh my date of birth is 26 February 2005',
    "I was born on Feb 26, 2005",
    "it's like February the 26th 2005 you know",
    'Born on 26/2/2005 thanks',
    'DOB: 2005-02-26',
    'meri paidaish ki tareekh 26 feb 2005 hai',
  ];
  for (const input of wrapped) {
    const r = parseCallerDobToIsoDate(input);
    assert.equal(r.ok, true, `input: ${JSON.stringify(input)}`);
    if (r.ok) assert.equal(r.isoDate, expected, `input: ${JSON.stringify(input)}`);
  }
});

test('parseCallerDobToIsoDate extracts a calendar date from noisy spoken-style transcripts', () => {
  const r = parseCallerDobToIsoDate(
    'So basically the account thing — anyway my birthday is November 9 1995 — can you check payment',
  );
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.isoDate, '1995-11-09');
});
