import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const migrationSql = fs.readFileSync(
  path.join(process.cwd(), 'migrations', '001_demo_users.sql'),
  'utf8',
);

test('migration creates persistent demo call verification table', () => {
  assert.match(migrationSql, /CREATE TABLE IF NOT EXISTS demo_call_verifications/i);
  assert.match(migrationSql, /session_id TEXT NOT NULL REFERENCES demo_users\(session_id\) ON DELETE CASCADE/i);
  assert.match(migrationSql, /call_id TEXT NOT NULL/i);
  assert.match(migrationSql, /verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/i);
  assert.match(migrationSql, /UNIQUE \(session_id, call_id\)/i);
});

test('migration creates persistent demo call mobile verification gate table', () => {
  assert.match(migrationSql, /CREATE TABLE IF NOT EXISTS demo_call_mobile_verifications/i);
  assert.match(migrationSql, /session_id TEXT NOT NULL REFERENCES demo_users\(session_id\) ON DELETE CASCADE/i);
  assert.match(migrationSql, /call_id TEXT NOT NULL/i);
  assert.match(migrationSql, /mobile_last_4 TEXT NOT NULL/i);
  assert.match(migrationSql, /verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/i);
  assert.match(migrationSql, /UNIQUE \(session_id, call_id\)/i);
});
