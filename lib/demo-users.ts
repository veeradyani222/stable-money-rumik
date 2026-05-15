import { getPersonaById, type PersonaSeed } from '@/lib/personas';

export interface DemoUserPersonaRow {
  persona_id: string | null;
  customer_id: string | null;
  name: string | null;
  mobile_last_4: string | null;
  date_of_birth: string | Date | null;
  kyc_status: PersonaSeed['kyc_status'] | null;
  kyc_rejection_reason: string | null;
  kyc_eta: string | null;
  kyc_next_step: string | null;
  payments: unknown;
  fixed_deposits: unknown;
  open_tickets: unknown;
  secure_links: unknown;
}

function parseJsonArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function dateString(value: string | Date | null, fallback: string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value || fallback;
}

export function buildPersonaFromDemoUserRow(row: DemoUserPersonaRow): PersonaSeed | null {
  if (!row.persona_id) return null;

  const seed = getPersonaById(row.persona_id);
  if (!seed) return null;

  return {
    persona_id: row.persona_id,
    customer_id: row.customer_id || seed.customer_id,
    name: row.name || seed.name,
    mobile_last_4: row.mobile_last_4 || seed.mobile_last_4,
    date_of_birth: dateString(row.date_of_birth, seed.date_of_birth),
    kyc_status: row.kyc_status || seed.kyc_status,
    kyc_rejection_reason: row.kyc_rejection_reason ?? seed.kyc_rejection_reason,
    kyc_eta: row.kyc_eta ?? seed.kyc_eta,
    kyc_next_step: row.kyc_next_step ?? seed.kyc_next_step,
    payments: (parseJsonArray(row.payments) || seed.payments) as PersonaSeed['payments'],
    fixed_deposits: (parseJsonArray(row.fixed_deposits) || seed.fixed_deposits) as PersonaSeed['fixed_deposits'],
    open_tickets: (parseJsonArray(row.open_tickets) || seed.open_tickets) as PersonaSeed['open_tickets'],
    secure_links: (parseJsonArray(row.secure_links) || seed.secure_links) as PersonaSeed['secure_links'],
  };
}
