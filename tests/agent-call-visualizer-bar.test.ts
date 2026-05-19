import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const clientSource = fs.readFileSync(
  path.join(process.cwd(), 'components', 'agent', 'AgentCallClient.tsx'),
  'utf8',
);

test('agent call client shows a focused visualizer-only voice stage', () => {
  assert.match(clientSource, /voice-call-visual-panel/);
  assert.match(clientSource, /AgentAudioVisualizerBar/);
  assert.doesNotMatch(clientSource, /<div className="transcript-strip"/);
  assert.match(clientSource, /voice-stage/);
});
