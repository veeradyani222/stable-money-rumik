export interface QueryResult<T = Record<string, unknown>> {
  rowCount: number | null;
  rows?: T[];
}

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface CreateOnboardingSessionInput {
  email: string;
  sessionId: string;
}

export interface OnboardingSession {
  sessionId: string;
  email: string;
  personaId: string | null;
}

interface ExistingDemoUserRow {
  session_id: string;
  persona_id: string | null;
}

function isMissingVerificationTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const code = typeof error === 'object' && error ? (error as { code?: unknown }).code : undefined;
  return code === '42P01' || message.includes('demo_call_verifications');
}

async function clearCallVerificationForSession(pool: Queryable, sessionId: string): Promise<void> {
  try {
    await pool.query(
      `DELETE FROM demo_call_verifications
       WHERE session_id = $1`,
      [sessionId],
    );
  } catch (error) {
    if (!isMissingVerificationTableError(error)) throw error;
  }
}

export async function createOnboardingSession(
  pool: Queryable,
  input: CreateOnboardingSessionInput,
): Promise<OnboardingSession> {
  await pool.query('BEGIN');
  try {
    const existing = await pool.query<ExistingDemoUserRow>(
      `SELECT session_id, persona_id
       FROM demo_users
       WHERE email = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 1
       FOR UPDATE`,
      [input.email],
    );
    const existingRow = existing.rows?.[0] ?? null;

    let personaId: string | null = null;
    if (existingRow) {
      await clearCallVerificationForSession(pool, existingRow.session_id);
      const updated = await pool.query<{ persona_id: string | null }>(
        `UPDATE demo_users
         SET session_id = $1
         WHERE session_id = $2
         RETURNING persona_id`,
        [input.sessionId, existingRow.session_id],
      );
      personaId = updated.rows?.[0]?.persona_id ?? existingRow.persona_id ?? null;
    } else {
      const inserted = await pool.query<{ persona_id: string | null }>(
        `INSERT INTO demo_users (session_id, email)
         VALUES ($1, $2)
         RETURNING persona_id`,
        [input.sessionId, input.email],
      );
      personaId = inserted.rows?.[0]?.persona_id ?? null;
    }

    await pool.query('COMMIT');
    return {
      sessionId: input.sessionId,
      email: input.email,
      personaId,
    };
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
}
