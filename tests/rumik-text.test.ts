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
