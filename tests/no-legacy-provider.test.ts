import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const providerName = ['ge', 'mini'].join('');
const providerPattern = new RegExp(providerName, 'i');
const sourceRoots = ['app', 'components', 'lib', 'tests'];
const textExtensions = new Set(['.cjs', '.js', '.json', '.mjs', '.ts', '.tsx']);

function walkFiles(directory: string): string[] {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkFiles(fullPath);
    return [fullPath];
  });
}

test('first-party runtime and tests do not keep legacy provider implementation', () => {
  const root = process.cwd();
  const thisFile = path.normalize(__filename);
  const matches = sourceRoots
    .flatMap((sourceRoot) => walkFiles(path.join(root, sourceRoot)))
    .filter((filePath) => path.normalize(filePath) !== thisFile)
    .filter((filePath) => textExtensions.has(path.extname(filePath)))
    .filter((filePath) => providerPattern.test(filePath) || providerPattern.test(fs.readFileSync(filePath, 'utf8')))
    .map((filePath) => path.relative(root, filePath));

  assert.deepEqual(matches, []);
});
