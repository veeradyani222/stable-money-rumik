import test from 'node:test';
import assert from 'node:assert/strict';

import SecureActionPage from '../app/secure-action/page';

function textFromReactNode(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textFromReactNode).join(' ');
  if (typeof node === 'object' && 'props' in node) {
    return textFromReactNode((node as { props?: { children?: unknown } }).props?.children);
  }
  return '';
}

test('secure action page renders the requested action and FD from link params', async () => {
  const element = await SecureActionPage({
    searchParams: Promise.resolve({
      action: 'premature_withdrawal',
      fd_id: 'FD-4412',
    }),
  });

  const text = textFromReactNode(element);
  assert.match(text, /Secure action/i);
  assert.match(text, /premature withdrawal/i);
  assert.match(text, /FD-4412/);
});
