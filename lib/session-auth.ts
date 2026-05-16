import { cookies } from 'next/headers';

import type { StableIntentRoute } from '@/lib/agent/stable-policy';
import { DEMO_SESSION_COOKIE } from './session-cookie';

interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params: unknown[]): Promise<{ rowCount: number | null; rows?: T[] }>;
}

export type DemoSessionResolution =
  | { ok: true; sessionId: string }
  | { ok: false; status: number; error: string };

const callVerificationByKey = new Map<string, boolean>();
/** Last four digits already matched for this session+call; keeps DOB retries from re-asking mobile. */
const callVerifiedMobileLastFourByKey = new Map<string, string>();
/** Account route selected before verification; keeps DOB turns from re-classifying intent. */
const callPendingRouteByKey = new Map<string, StableIntentRoute>();

function asSessionId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function callStateKey(sessionId: string, callId?: unknown): string {
  const normalizedCallId = typeof callId === 'string' && callId.trim() ? callId.trim() : 'legacy';
  return `${sessionId}:${normalizedCallId}`;
}

function normalizedCallId(callId?: unknown): string {
  return typeof callId === 'string' && callId.trim() ? callId.trim() : 'legacy';
}

function lastFourDigits(value: unknown): string {
  const text = String(value ?? '');
  let digits = '';
  for (const char of text) {
    if (char >= '0' && char <= '9') digits += char;
  }
  return digits.slice(-4);
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
  callPendingRouteByKey.delete(callStateKey(sessionId, callId));
}

export function getDemoCallVerifiedMobileLastFour(sessionId: string, callId?: unknown): string | null {
  return callVerifiedMobileLastFourByKey.get(callStateKey(sessionId, callId)) ?? null;
}

export function markDemoCallVerifiedMobileLastFour(sessionId: string, callId: unknown | undefined, lastFour: string): void {
  const digits = lastFourDigits(lastFour);
  if (digits.length !== 4) return;
  callVerifiedMobileLastFourByKey.set(callStateKey(sessionId, callId), digits);
}

export function getDemoCallPendingRoute(sessionId: string, callId?: unknown): StableIntentRoute | null {
  return callPendingRouteByKey.get(callStateKey(sessionId, callId)) ?? null;
}

export function markDemoCallPendingRoute(
  sessionId: string,
  callId: unknown | undefined,
  pendingRoute: StableIntentRoute | null | undefined,
): void {
  if (!pendingRoute || pendingRoute.intent === 'unknown') return;
  callPendingRouteByKey.set(callStateKey(sessionId, callId), pendingRoute);
}

export function clearDemoCallVerifiedMobileLastFour(sessionId: string, callId?: unknown): void {
  callVerifiedMobileLastFourByKey.delete(callStateKey(sessionId, callId));
  callPendingRouteByKey.delete(callStateKey(sessionId, callId));
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
    [sessionId, normalizedCallId(callId)],
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
    [sessionId, normalizedCallId(callId)],
  );
}

export async function getPersistedDemoCallVerifiedMobileLastFour(
  pool: Queryable,
  sessionId: string,
  callId?: unknown,
): Promise<string | null> {
  const result = await pool.query<{ mobile_last_4: string | null }>(
    `SELECT mobile_last_4
     FROM demo_call_mobile_verifications
     WHERE session_id = $1 AND call_id = $2
     LIMIT 1`,
    [sessionId, normalizedCallId(callId)],
  );
  const digits = lastFourDigits(result.rows?.[0]?.mobile_last_4 ?? '');
  return digits.length === 4 ? digits : null;
}

export async function getPersistedDemoCallPendingRoute(
  pool: Queryable,
  sessionId: string,
  callId?: unknown,
): Promise<StableIntentRoute | null> {
  const result = await pool.query<{ pending_route: StableIntentRoute | null }>(
    `SELECT pending_route
     FROM demo_call_mobile_verifications
     WHERE session_id = $1 AND call_id = $2
     LIMIT 1`,
    [sessionId, normalizedCallId(callId)],
  );
  const route = result.rows?.[0]?.pending_route;
  return route && typeof route === 'object' && route.intent !== 'unknown' ? route : null;
}

export async function markPersistedDemoCallVerifiedMobileLastFour(
  pool: Queryable,
  sessionId: string,
  callId: unknown | undefined,
  lastFour: string,
  pendingRoute?: StableIntentRoute | null,
): Promise<void> {
  const digits = lastFourDigits(lastFour);
  if (digits.length !== 4) return;
  if (!pendingRoute) {
    await pool.query(
      `INSERT INTO demo_call_mobile_verifications (session_id, call_id, mobile_last_4)
       VALUES ($1, $2, $3)
       ON CONFLICT (session_id, call_id)
       DO UPDATE SET mobile_last_4 = EXCLUDED.mobile_last_4, verified_at = NOW()`,
      [sessionId, normalizedCallId(callId), digits],
    );
    return;
  }
  try {
    await pool.query(
      `INSERT INTO demo_call_mobile_verifications (session_id, call_id, mobile_last_4, pending_route)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (session_id, call_id)
       DO UPDATE SET mobile_last_4 = EXCLUDED.mobile_last_4, pending_route = EXCLUDED.pending_route, verified_at = NOW()`,
      [sessionId, normalizedCallId(callId), digits, pendingRoute ?? null],
    );
  } catch (error) {
    if (!isMissingVerificationTableError(error)) throw error;
    await pool.query(
      `INSERT INTO demo_call_mobile_verifications (session_id, call_id, mobile_last_4)
       VALUES ($1, $2, $3)
       ON CONFLICT (session_id, call_id)
       DO UPDATE SET mobile_last_4 = EXCLUDED.mobile_last_4, verified_at = NOW()`,
      [sessionId, normalizedCallId(callId), digits],
    );
  }
}

export async function clearPersistedDemoCallVerifiedMobileLastFour(
  pool: Queryable,
  sessionId: string,
  callId?: unknown,
): Promise<void> {
  await pool.query(
    `DELETE FROM demo_call_mobile_verifications
     WHERE session_id = $1 AND call_id = $2`,
    [sessionId, normalizedCallId(callId)],
  );
}

function isMissingVerificationTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const code = typeof error === 'object' && error ? (error as { code?: unknown }).code : undefined;
  return (
    code === '42P01' ||
    code === '42703' ||
    message.includes('demo_call_verifications') ||
    message.includes('demo_call_mobile_verifications') ||
    message.includes('pending_route')
  );
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
  try {
    await clearPersistedDemoCallVerifiedMobileLastFour(pool, sessionId, callId);
  } catch (error) {
    if (!isMissingVerificationTableError(error)) throw error;
  }
}

export async function getDemoCallVerifiedMobileLastFourFromStore(
  pool: Queryable,
  sessionId: string,
  callId?: unknown,
): Promise<string | null> {
  try {
    return (
      (await getPersistedDemoCallVerifiedMobileLastFour(pool, sessionId, callId)) ??
      getDemoCallVerifiedMobileLastFour(sessionId, callId)
    );
  } catch (error) {
    if (!isMissingVerificationTableError(error)) throw error;
    return getDemoCallVerifiedMobileLastFour(sessionId, callId);
  }
}

export async function getDemoCallPendingRouteFromStore(
  pool: Queryable,
  sessionId: string,
  callId?: unknown,
): Promise<StableIntentRoute | null> {
  try {
    const persisted = await getPersistedDemoCallPendingRoute(pool, sessionId, callId);
    const fallback = persisted ? null : getDemoCallPendingRoute(sessionId, callId);
    const route = persisted ?? fallback;
    console.log('[stable-session-auth:pending-route-read]', {
      session_id: sessionId,
      call_id: normalizedCallId(callId),
      source: persisted ? 'persisted' : fallback ? 'memory' : 'none',
      route: route
        ? {
            intent: route.intent,
            authTier: route.authTier,
            tools: route.tools,
          }
        : null,
    });
    return route;
  } catch (error) {
    if (!isMissingVerificationTableError(error)) throw error;
    const route = getDemoCallPendingRoute(sessionId, callId);
    console.log('[stable-session-auth:pending-route-read-fallback]', {
      session_id: sessionId,
      call_id: normalizedCallId(callId),
      route: route
        ? {
            intent: route.intent,
            authTier: route.authTier,
            tools: route.tools,
          }
        : null,
    });
    return route;
  }
}

export async function markDemoCallVerifiedMobileLastFourInStore(
  pool: Queryable,
  sessionId: string,
  callId: unknown | undefined,
  lastFour: string,
  pendingRoute?: StableIntentRoute | null,
): Promise<void> {
  console.log('[stable-session-auth:mobile-step-store-start]', {
    session_id: sessionId,
    call_id: normalizedCallId(callId),
    last_four: lastFourDigits(lastFour),
    pending_route: pendingRoute
      ? {
          intent: pendingRoute.intent,
          authTier: pendingRoute.authTier,
          tools: pendingRoute.tools,
        }
      : null,
  });
  markDemoCallVerifiedMobileLastFour(sessionId, callId, lastFour);
  markDemoCallPendingRoute(sessionId, callId, pendingRoute);
  try {
    await markPersistedDemoCallVerifiedMobileLastFour(pool, sessionId, callId, lastFour, pendingRoute);
    console.log('[stable-session-auth:mobile-step-store-complete]', {
      session_id: sessionId,
      call_id: normalizedCallId(callId),
      last_four: lastFourDigits(lastFour),
      pending_route_intent: pendingRoute?.intent ?? null,
    });
  } catch (error) {
    if (!isMissingVerificationTableError(error)) throw error;
    console.warn('[stable-session-auth:mobile-step-store-persist-skipped]', {
      session_id: sessionId,
      call_id: normalizedCallId(callId),
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

export const getDemoCallVerifiedFallbackForTests = getDemoCallVerified;
export const markDemoCallVerifiedFallbackForTests = markDemoCallVerified;

export function resetDemoCallStateForTests() {
  callVerificationByKey.clear();
  callVerifiedMobileLastFourByKey.clear();
  callPendingRouteByKey.clear();
}
