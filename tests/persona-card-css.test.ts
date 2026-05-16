import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const css = fs.readFileSync(path.join(process.cwd(), 'styles', 'stable-onboarding.css'), 'utf8');

test('onboarding persona cards keep equal box sizes', () => {
  assert.match(css, /\.persona-grid\s*{[\s\S]*?align-items:\s*stretch;/);
  assert.match(css, /\.persona-grid\s*{[\s\S]*?grid-auto-rows:\s*1fr;/);
  assert.match(css, /\.persona-card\s*{[\s\S]*?height:\s*100%;/);
  assert.match(css, /\.persona-card__body\s*{[\s\S]*?height:\s*100%;/);
  assert.match(css, /\.persona-card__body\s*{[\s\S]*?justify-content:\s*space-between;/);
});
