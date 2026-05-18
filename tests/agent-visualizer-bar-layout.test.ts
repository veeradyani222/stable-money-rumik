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

test('thinking voice orb lets the blue sweep travel outside the orb border quickly', () => {
  const orbStart = css.indexOf('.voice-orb {');
  const orbEnd = css.indexOf('.voice-orb--calling', orbStart);
  const orbSource = css.slice(orbStart, orbEnd);

  assert.notEqual(orbStart, -1);
  assert.notEqual(orbEnd, -1);
  assert.match(orbSource, /overflow:\s*visible;/);

  const thinkingStart = css.indexOf('.voice-orb--thinking::after {');
  const thinkingEnd = css.indexOf('@keyframes rotateBorder', thinkingStart);
  const thinkingSource = css.slice(thinkingStart, thinkingEnd);

  assert.notEqual(thinkingStart, -1);
  assert.notEqual(thinkingEnd, -1);
  assert.match(thinkingSource, /inset:\s*-13px;/);
  assert.match(thinkingSource, /animation:\s*rotateBorder\s*1\.8s\s*linear\s*infinite;/);
  assert.match(thinkingSource, /transparent calc\(100% - 18px\)/);
});
