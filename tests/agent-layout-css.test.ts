import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const css = fs.readFileSync(path.join(process.cwd(), 'styles', 'agent-call.css'), 'utf8');

test('agent page uses a focused single-column shell for intro and call views', () => {
  assert.match(css, /\.agent-page\s*{[\s\S]*?height:\s*100vh;/);
  assert.match(css, /\.agent-page\s*{[\s\S]*?height:\s*100dvh;/);
  assert.match(css, /\.agent-page\s*{[\s\S]*?overflow:\s*hidden;/);
  assert.match(css, /\.agent-page\s*{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  assert.match(css, /\.agent-page--precall\s*{[\s\S]*?height:\s*auto;/);
  assert.match(css, /\.agent-page--call\s*{[\s\S]*?height:\s*100dvh;/);
  assert.doesNotMatch(css, /--agent-sidebar-width/);
});

test('agent pre-call layout stacks cleanly on phone widths', () => {
  const mobileStart = css.indexOf('@media (max-width: 900px)');
  const mobileSource = css.slice(mobileStart);

  assert.notEqual(mobileStart, -1);
  assert.match(mobileSource, /\.voice-stage\s*{[\s\S]*?height:\s*100dvh;/);
  assert.match(mobileSource, /\.agent-precall__hero,\s*[\s\S]*?\.agent-precall__detail-grid\s*{[\s\S]*?grid-template-columns:\s*1fr;/);
  assert.match(mobileSource, /\.agent-precall__capabilities\s*{[\s\S]*?grid-template-columns:\s*1fr;/);
  assert.doesNotMatch(mobileSource, /\.persona-panel\s*{/);
  assert.doesNotMatch(mobileSource, /\.mobile-panel-handle\s*{/);
});

test('agent active call controls stay reachable on short phone screens', () => {
  const mobileStart = css.indexOf('@media (max-width: 900px)');
  const shortStart = css.indexOf('@media (max-height: 700px)');
  const mobileSource = css.slice(mobileStart);
  const shortSource = css.slice(shortStart);

  assert.notEqual(mobileStart, -1);
  assert.notEqual(shortStart, -1);
  assert.match(css, /\.voice-stage\s*{[\s\S]*?padding:\s*max\(16px,\s*env\(safe-area-inset-top\)\)\s+max\(16px,\s*env\(safe-area-inset-right\)\)\s+max\(16px,\s*env\(safe-area-inset-bottom\)\)\s+max\(16px,\s*env\(safe-area-inset-left\)\);/);
  assert.match(css, /\.voice-call-stack\s*{[\s\S]*?gap:\s*clamp\(12px,\s*2\.4dvh,\s*24px\);/);
  assert.match(mobileSource, /\.voice-call-stack\s*{[\s\S]*?justify-content:\s*space-evenly;/);
  assert.doesNotMatch(mobileSource, /padding-bottom:\s*10vh/);
  assert.match(shortSource, /\.voice-orb\s*{[\s\S]*?width:\s*min\(58vw,\s*220px\);/);
  assert.match(shortSource, /\.voice-call-actions\s*{[\s\S]*?min-height:\s*56px;/);
});

test('agent pre-call customer details use responsive table cards', () => {
  assert.match(css, /\.agent-precall__detail-grid\s*{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(css, /\.agent-precall-detail__table-wrap\s*{[\s\S]*?overflow-x:\s*auto;/);
  assert.match(css, /\.agent-precall-detail__table\s*{[\s\S]*?min-width:\s*420px;/);
  assert.doesNotMatch(css, /\.persona-change-grid\s*{/);
  assert.doesNotMatch(css, /\.panel-tabs\s*{/);
});
