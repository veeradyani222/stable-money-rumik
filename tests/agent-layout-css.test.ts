import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const css = fs.readFileSync(path.join(process.cwd(), 'styles', 'agent-call.css'), 'utf8');

test('agent page keeps sidebar scrolling inside the viewport', () => {
  assert.match(css, /\.agent-page\s*{[\s\S]*?height:\s*100vh;/);
  assert.match(css, /\.agent-page\s*{[\s\S]*?overflow:\s*hidden;/);
  assert.match(css, /\.persona-panel\s*{[\s\S]*?height:\s*100vh;/);
  assert.match(css, /\.persona-panel\s*{[\s\S]*?overflow:\s*hidden;/);
  assert.match(css, /\.panel-section\s*{[\s\S]*?overflow:\s*auto;/);
});

test('agent page turns the persona panel into a phone side drawer', () => {
  const mobileStart = css.indexOf('@media (max-width: 900px)');
  const mobileSource = css.slice(mobileStart);

  assert.notEqual(mobileStart, -1);
  assert.match(mobileSource, /\.agent-page\s*{[\s\S]*?grid-template-columns:\s*1fr;/);
  assert.match(mobileSource, /\.voice-stage\s*{[\s\S]*?height:\s*100vh;/);
  assert.match(mobileSource, /\.persona-panel\s*{[\s\S]*?position:\s*fixed;[\s\S]*?right:\s*0;[\s\S]*?transform:\s*translateX\(100%\);/);
  assert.match(mobileSource, /\.agent-page--panel-open\s+\.persona-panel\s*{[\s\S]*?transform:\s*translateX\(0\);/);
  assert.match(mobileSource, /\.mobile-panel-handle\s*{[\s\S]*?display:\s*inline-grid;/);
  assert.match(mobileSource, /\.agent-page--panel-open\s+\.mobile-panel-backdrop\s*{[\s\S]*?display:\s*block;/);
  assert.doesNotMatch(mobileSource, /\.mobile-panel-close\s*{/);
});

test('agent page lays out side-panel persona chooser as equal cards', () => {
  assert.match(css, /\.panel-tabs\s*{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(css, /\.panel-tab\s*{[\s\S]*?min-width:\s*0;/);
  assert.match(css, /\.panel-tab\s*{[\s\S]*?font-size:\s*clamp\(/);
  assert.match(css, /\.panel-tab\s*{[\s\S]*?text-overflow:\s*ellipsis;/);
  assert.match(css, /\.persona-change-grid\s*{[\s\S]*?display:\s*grid;/);
  assert.match(css, /\.persona-change-grid\s*{[\s\S]*?grid-auto-rows:\s*1fr;/);
  assert.match(css, /\.persona-change-card\s*{[\s\S]*?height:\s*100%;/);
  assert.match(css, /\.persona-change-card\s*{[\s\S]*?width:\s*100%;/);
  assert.match(css, /\.persona-change-card\s+\.persona-card__body\s*{[\s\S]*?min-height:\s*132px;/);
  assert.match(css, /\.persona-change-card-status\s*{[\s\S]*?word-break:\s*normal;/);
});
