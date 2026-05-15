import { NextResponse } from 'next/server';

import { getPool } from '@/lib/db';
import { getPersonaById } from '@/lib/personas';
import { DEMO_SESSION_COOKIE } from '@/lib/session-cookie';

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Expected JSON object' }, { status: 400 });
  }

  const { session_id: sessionIdRaw, persona_id: personaIdRaw } = body as {
    session_id?: unknown;
    persona_id?: unknown;
  };

  if (typeof sessionIdRaw !== 'string' || sessionIdRaw.length < 10) {
    return NextResponse.json({ error: 'Missing or invalid session_id' }, { status: 400 });
  }

  if (typeof personaIdRaw !== 'string' || !personaIdRaw.trim()) {
    return NextResponse.json({ error: 'Missing persona_id' }, { status: 400 });
  }

  const persona = getPersonaById(personaIdRaw.trim());
  if (!persona) {
    return NextResponse.json({ error: 'Unknown persona' }, { status: 400 });
  }

  const primaryPayment = persona.payments[0] ?? null;
  const primaryFd = persona.fixed_deposits[0] ?? null;
  const paymentReferences = primaryPayment
    ? [primaryPayment.payment_reference, ...primaryPayment.aliases]
    : null;

  try {
    const pool = getPool();
    const result = await pool.query(
      `UPDATE demo_users SET
        persona_id = $2,
        intent_id = NULL,
        customer_id = $3,
        name = $4,
        mobile_last_4 = $5,
        date_of_birth = $6::date,
        kyc_status = $7,
        kyc_rejection_reason = $8,
        kyc_eta = $9,
        kyc_next_step = $10,
        payments = $11::jsonb,
        payment_references = $12::jsonb,
        source_bank = $13,
        payment_amount = $14,
        payment_status = $15,
        payment_eta = $16,
        refund_status = $17,
        refund_eta = $18,
        fixed_deposits = $19::jsonb,
        fd_id = $20,
        fd_booking_date = $21::date,
        fd_bank = $22,
        fd_amount = $23,
        fd_tenure = $24,
        fd_status = $25,
        fd_maturity_date = $26::date,
        fd_expected_confirmation_window = $27,
        payout_status = $28,
        payout_eta = $29,
        payout_expected_date = $30::date,
        payout_delay_stage = $31,
        premature_withdrawal_estimate = $32,
        premature_withdrawal_penalty = $33,
        premature_withdrawal_payout_window = $34,
        open_tickets = CASE
          WHEN persona_id = $2 AND open_tickets IS NOT NULL THEN open_tickets
          ELSE $35::jsonb
        END,
        secure_links = $36::jsonb
       WHERE session_id = $1
       RETURNING id`,
      [
        sessionIdRaw,
        persona.persona_id,
        persona.customer_id,
        persona.name,
        persona.mobile_last_4,
        persona.date_of_birth,
        persona.kyc_status,
        persona.kyc_rejection_reason,
        persona.kyc_eta,
        persona.kyc_next_step,
        JSON.stringify(persona.payments),
        paymentReferences === null ? null : JSON.stringify(paymentReferences),
        primaryPayment?.source_bank ?? null,
        primaryPayment?.amount ?? null,
        primaryPayment?.status ?? null,
        primaryPayment?.eta ?? null,
        primaryPayment?.refund_status ?? null,
        primaryPayment?.refund_eta ?? null,
        JSON.stringify(persona.fixed_deposits),
        primaryFd?.fd_id ?? null,
        primaryFd?.booking_date ?? null,
        primaryFd?.bank ?? null,
        primaryFd?.amount ?? null,
        primaryFd?.tenure ?? null,
        primaryFd?.status ?? null,
        primaryFd?.maturity_date ?? null,
        primaryFd?.expected_confirmation_window ?? null,
        primaryFd?.payout_status ?? null,
        primaryFd?.payout_eta ?? null,
        primaryFd?.payout_expected_date ?? null,
        primaryFd?.payout_delay_stage ?? null,
        primaryFd?.premature_withdrawal_estimate ?? null,
        primaryFd?.premature_withdrawal_penalty ?? null,
        primaryFd?.premature_withdrawal_payout_window ?? null,
        JSON.stringify(persona.open_tickets),
        JSON.stringify(persona.secure_links),
      ],
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
  } catch {
    return NextResponse.json({ error: 'Could not save persona. Try again.' }, { status: 500 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(DEMO_SESSION_COOKIE, sessionIdRaw, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24,
  });
  return response;
}
