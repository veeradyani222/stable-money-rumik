import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.join(process.cwd(), 'components', 'agents-ui', 'agent-audio-visualizer-bar.tsx'),
  'utf8',
);

test('agent audio visualizer bar uses time-domain amplitude with an explicit boost curve', () => {
  assert.match(source, /getByteTimeDomainData/);
  assert.match(source, /Math\.pow\(normalizedAmplitude,\s*0\.55\)/);
  assert.match(source, /0\.22 \+ boostedAmplitude \* 0\.78/);
  assert.doesNotMatch(source, /getByteFrequencyData/);
  assert.doesNotMatch(source, /average \/ 255/);
});
