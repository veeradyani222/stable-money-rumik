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
