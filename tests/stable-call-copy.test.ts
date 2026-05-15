import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { STABLE_DEFAULT_OPENING, STABLE_DEFAULT_OPENING_TEXT } from '../lib/agent/stable-call-copy';

test('stable default opening matches the Project.md opening line', () => {
  const project = fs.readFileSync(path.join(process.cwd(), 'PROJECT.md'), 'utf8');
  const match = project.match(/### Default opening\s*>\s*"([^"]+)"/);

  assert.ok(match);
  assert.equal(STABLE_DEFAULT_OPENING_TEXT, match[1]);
  assert.equal(STABLE_DEFAULT_OPENING, `[neutral] ${match[1]}`);
});
