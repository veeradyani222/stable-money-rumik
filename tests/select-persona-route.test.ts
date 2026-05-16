import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const routeSource = fs.readFileSync(
  path.join(process.cwd(), 'app', 'api', 'onboarding', 'select-persona', 'route.ts'),
  'utf8',
);

test('select persona route clears persisted call verification when persona changes', () => {
  assert.match(routeSource, /BEGIN/);
  assert.match(routeSource, /DELETE FROM demo_call_verifications/);
  assert.match(routeSource, /DELETE FROM demo_call_mobile_verifications/);
  assert.match(routeSource, /COMMIT/);
  assert.match(routeSource, /ROLLBACK/);
  assert.match(routeSource, /session_id = \$1/);
});
