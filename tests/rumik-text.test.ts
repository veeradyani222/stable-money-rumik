import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeRumikText } from '../lib/voice/rumik-text';

test('normalizeRumikText adds a neutral tone when a model returns plain text', () => {
  assert.equal(
    normalizeRumikText('Namaste, main check kar deti hoon.'),
    '[neutral] Namaste, main check kar deti hoon.',
  );
});

test('normalizeRumikText keeps one supported starting tone and removes later tone tags', () => {
  assert.equal(
    normalizeRumikText('[happy] Namaste. [sad] Main details check kar rahi hoon.'),
    '[happy] Namaste. Main details check kar rahi hoon.',
  );
});

test('normalizeRumikText strips unsupported and incompatible event tags', () => {
  assert.equal(
    normalizeRumikText('[sad] <laugh> Arre yaar, payment abhi pending hai. <sigh> Main check karti hoon.'),
    '[sad] Arre yaar, payment abhi pending hai. <sigh> Main check karti hoon.',
  );
  assert.equal(
    normalizeRumikText('[neutral] Aapka FD active hai. <cough> Details screen par dikh rahi hain.'),
    '[neutral] Aapka FD active hai. Details screen par dikh rahi hain.',
  );
});

test('normalizeRumikText can keep a prior tone across continuation chunks', () => {
  assert.equal(normalizeRumikText('please wait kijiye.', 'happy'), '[happy] please wait kijiye.');
  assert.equal(normalizeRumikText('[General] please wait kijiye.', 'happy'), '[happy] please wait kijiye.');
});

test('normalizeRumikText coerces fine grained sad tones to the coarse sad tone', () => {
  assert.equal(
    normalizeRumikText('[very sad] Sorry, payment abhi pending hai.'),
    '[sad] Sorry, payment abhi pending hai.',
  );
});

test('normalizeRumikText spaces long digit identifiers for Rumik tokenization', () => {
  assert.equal(
    normalizeRumikText('[neutral] Account 12345678 verify kar rahi hoon.'),
    '[neutral] Account 1 2 3 4 5 6 7 8 verify kar rahi hoon.',
  );
});

test('normalizeRumikText converts rupee amounts to spoken words', () => {
  assert.equal(
    normalizeRumikText('[neutral] Aapka FD amount ₹50,000 hai.'),
    '[neutral] Aapka FD amount rupees fifty thousand hai.',
  );
});

test('normalizeRumikText removes stars and dash punctuation from spoken text', () => {
  assert.equal(
    normalizeRumikText('[sad] **Sorry** - PAY-8831 payment pending—review mein hai.'),
    '[sad] Sorry PAY 8 8 3 1 payment pending review mein hai.',
  );
});

test('normalizeRumikText removes colon and semicolon punctuation and reads slash as or', () => {
  assert.equal(
    normalizeRumikText('[neutral] Options: FD/RD; app/web se check kar sakte hain.'),
    '[neutral] Options FD or RD app or web se check kar sakte hain.',
  );
});

test('normalizeRumikText rewrites labelled FD detail dumps into speakable prose', () => {
  assert.equal(
    normalizeRumikText(
      '[neutral] Mobile verification aur date of birth verification complete ho gayi hai. Aapke FD ki details ye hain: Bank: Shriram Finance Amount: 50000 rupees Status: Processing Tenure: 12 months Booking date: 1st May 2026 Maturity date: 1st May 2027 Confirmation aane mein usually 24 se 48 working hours lagenge. Agar kuch aur jaanana ho toh bataiye.',
    ),
    '[neutral] Mobile verification aur date of birth verification complete ho gayi hai. Aapki FD details ye hain. FD Shriram Finance mein rupees fifty thousand ki hai. Status processing hai. Tenure twelve months hai. Booking date first May twenty twenty six hai. Maturity date first May twenty twenty seven hai. Confirmation aane mein usually twenty four se forty eight working hours lagenge. Agar kuch aur jaanana ho toh bataiye.',
  );
});
