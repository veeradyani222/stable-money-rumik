import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const clientSource = fs.readFileSync(
  path.join(process.cwd(), 'components', 'agent', 'AgentCallClient.tsx'),
  'utf8',
);

test('agent call client keeps analyser refs for mic monitoring and VAD', () => {
  assert.match(clientSource, /analyserRef/);
  assert.match(clientSource, /analyserDataRef/);
  assert.match(clientSource, /createAnalyser\(\)/);
  assert.match(clientSource, /getFloatTimeDomainData/);
});

test('agent call client uses call state to drive listening UI and mic RMS', () => {
  assert.match(clientSource, /callState === 'speaking'/);
  assert.match(clientSource, /latestMicRmsRef/);
});
