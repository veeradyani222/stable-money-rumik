import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const css = fs.readFileSync(path.join(process.cwd(), 'styles', 'agent-call.css'), 'utf8');

test('voice-call visual panel has no top or bottom rules and uses stack rhythm', () => {
  const panelStart = css.indexOf('.voice-call-visual-panel {');
  const panelEnd = css.indexOf('.agent-audio-visualizer-bar {', panelStart);
  const panelSource = css.slice(panelStart, panelEnd);

  assert.notEqual(panelStart, -1);
  assert.notEqual(panelEnd, -1);
  assert.doesNotMatch(panelSource, /border-top:/);
  assert.doesNotMatch(panelSource, /border-bottom:/);

  const stackStart = css.indexOf('.voice-call-stack {');
  const stackEnd = css.indexOf('.voice-stage__header', stackStart);
  const stackSource = css.slice(stackStart, stackEnd);
  assert.match(stackSource, /gap:\s*clamp\(/);
});
