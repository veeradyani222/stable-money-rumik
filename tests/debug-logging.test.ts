import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { shouldLogDiagnosticEvent } from '../lib/diagnostics/log-filter';

const codeRoots = ['app', 'components', 'lib', 'scripts'];

function listSourceFiles(root: string): string[] {
  const absoluteRoot = path.join(process.cwd(), root);
  if (!fs.existsSync(absoluteRoot)) return [];
  const entries = fs.readdirSync(absoluteRoot, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const absolutePath = path.join(absoluteRoot, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path.join(root, entry.name));
    return /\.(?:ts|tsx|js|cjs|mjs)$/.test(entry.name) ? [absolutePath] : [];
  });
}

test('runtime source files do not write to console logs', () => {
  const offenders = codeRoots.flatMap(listSourceFiles).flatMap((file) => {
    const source = fs.readFileSync(file, 'utf8');
    return [...source.matchAll(/\bconsole\.(?:log|debug|info|warn|error)\s*\(/g)].map(
      (match) => `${path.relative(process.cwd(), file)}:${source.slice(0, match.index).split('\n').length}`,
    );
  });

  assert.deepEqual(offenders, []);
});

test('diagnostic log filter drops routine voice and agent events', () => {
  assert.equal(shouldLogDiagnosticEvent({ event: 'rumik:socket:open' }), false);
  assert.equal(shouldLogDiagnosticEvent({ event: 'rumik:message:binary' }), false);
  assert.equal(shouldLogDiagnosticEvent({ event: 'realtime:data-channel:open' }), false);
  assert.equal(shouldLogDiagnosticEvent({ event: 'agent:response' }), false);
});

test('diagnostic log filter keeps failures and missing configuration', () => {
  assert.equal(shouldLogDiagnosticEvent({ event: 'rumik:socket:error' }), true);
  assert.equal(shouldLogDiagnosticEvent({ event: 'rumik:opening-cache:timeout' }), true);
  assert.equal(shouldLogDiagnosticEvent({ event: 'realtime:sdp:error' }), true);
  assert.equal(shouldLogDiagnosticEvent({ event: 'config:missing-api-key' }), true);
});

test('diagnostic log filter keeps agent route and tool execution logs', () => {
  assert.equal(shouldLogDiagnosticEvent({ label: '[stable-agent:route]', event: 'route' }), true);
  assert.equal(shouldLogDiagnosticEvent({ label: '[stable-agent:tool]', event: 'start' }), true);
  assert.equal(shouldLogDiagnosticEvent({ label: '[stable-agent:tool]', event: 'result' }), true);
});
