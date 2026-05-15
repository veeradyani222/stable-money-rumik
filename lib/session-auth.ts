import { cookies } from 'next/headers';

import { DEMO_SESSION_COOKIE } from './session-cookie';

interface Queryable {
  query(sql: string, params: unknown[]): Promise<{ rowCount: number | null }>;
}

export type DemoSessionResolution =
  | { ok: true; sessionId: string }
  | { ok: false; status: number; error: string };

const callVerificationByKey = new Map<string, boolean>();
/** Last four digits already matched for this session+call; keeps DOB retries from re-asking mobile. */
const callVerifiedMobileLastFourByKey = new Map<string, string>();

function asSessionId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function callStateKey(sessionId: string, callId?: unknown): string {
  const normalizedCallId = typeof callId === 'string' && callId.trim() ? callId.trim() : 'legacy';
  return `${sessionId}:${normalizedCallId}`;
}

export function resolveDemoSessionId(input: {
  explicitSessionId?: unknown;
  cookieSessionId?: unknown;
}): DemoSessionResolution {
  const explicitSessionId = asSessionId(input.explicitSessionId);
  const cookieSessionId = asSessionId(input.cookieSessionId);

  if (cookieSessionId && explicitSessionId && cookieSessionId !== explicitSessionId) {
    return { ok: false, status: 403, error: 'Session does not match this browser' };
  }

  const sessionId = explicitSessionId || cookieSessionId;
  if (sessionId.length < 10) {
    return { ok: false, status: 400, error: 'Missing or invalid session_id' };
  }

  return { ok: true, sessionId };
}

export async function getRequestDemoSessionId(explicitSessionId?: unknown): Promise<DemoSessionResolution> {
  const cookieStore = await cookies();
  return resolveDemoSessionId({
    explicitSessionId,
    cookieSessionId: cookieStore.get(DEMO_SESSION_COOKIE)?.value,
  });
}

export function getDemoCallVerified(sessionId: string, callId?: unknown): boolean {
  return callVerificationByKey.get(callStateKey(sessionId, callId)) === true;
}

export function markDemoCallVerified(sessionId: string, callId?: unknown) {
  callVerificationByKey.set(callStateKey(sessionId, callId), true);
  callVerifiedMobileLastFourByKey.delete(callStateKey(sessionId, callId));
}

export function getDemoCallVerifiedMobileLastFour(sessionId: string, callId?: unknown): string | null {
  return callVerifiedMobileLastFourByKey.get(callStateKey(sessionId, callId)) ?? null;
}

export function markDemoCallVerifiedMobileLastFour(sessionId: string, callId: unknown | undefined, lastFour: string): void {
  const digits = String(lastFour ?? '').replace(/\D/g, '').slice(-4);
  if (digits.length !== 4) return;
  callVerifiedMobileLastFourByKey.set(callStateKey(sessionId, callId), digits);
}

export function clearDemoCallVerifiedMobileLastFour(sessionId: string, callId?: unknown): void {
  callVerifiedMobileLastFourByKey.delete(callStateKey(sessionId, callId));
}

export async function getPersistedDemoCallVerified(
  pool: Queryable,
  sessionId: string,
  callId?: unknown,
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1
     FROM demo_call_verifications
     WHERE session_id = $1 AND call_id = $2
     LIMIT 1`,
    [sessionId, typeof callId === 'string' && callId.trim() ? callId.trim() : 'legacy'],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function markPersistedDemoCallVerified(
  pool: Queryable,
  sessionId: string,
  callId?: unknown,
): Promise<void> {
  await pool.query(
    `INSERT INTO demo_call_verifications (session_id, call_id)
     VALUES ($1, $2)
     ON CONFLICT (session_id, call_id)
     DO UPDATE SET verified_at = NOW()`,
    [sessionId, typeof callId === 'string' && callId.trim() ? callId.trim() : 'legacy'],
  );
}

function isMissingVerificationTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const code = typeof error === 'object' && error ? (error as { code?: unknown }).code : undefined;
  return code === '42P01' || message.includes('demo_call_verifications');
}

export async function getDemoCallVerifiedFromStore(
  pool: Queryable,
  sessionId: string,
  callId?: unknown,
): Promise<boolean> {
  try {
    return await getPersistedDemoCallVerified(pool, sessionId, callId);
  } catch (error) {
    if (!isMissingVerificationTableError(error)) throw error;
    return getDemoCallVerified(sessionId, callId);
  }
}

export async function markDemoCallVerifiedInStore(
  pool: Queryable,
  sessionId: string,
  callId?: unknown,
): Promise<void> {
  markDemoCallVerified(sessionId, callId);
  try {
    await markPersistedDemoCallVerified(pool, sessionId, callId);
  } catch (error) {
    if (!isMissingVerificationTableError(error)) throw error;
  }
}

export const getDemoCallVerifiedFallbackForTests = getDemoCallVerified;
export const markDemoCallVerifiedFallbackForTests = markDemoCallVerified;

export function resetDemoCallStateForTests() {
  callVerificationByKey.clear();
  callVerifiedMobileLastFourByKey.clear();
}
