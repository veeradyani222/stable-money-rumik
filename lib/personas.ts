export type KycStatus = 'not_started' | 'in_progress' | 'pending_review' | 'rejected' | 'approved';

export interface PaymentSeed {
  payment_reference: string;
  aliases: string[];
  source_bank: string;
  amount: number;
  status: string;
  eta: string | null;
  refund_status: string | null;
  refund_eta: string | null;
}

export interface FixedDepositSeed {
  fd_id: string;
  booking_date: string | null;
  bank: string;
  amount: number;
  tenure: string;
  status: string;
  maturity_date: string | null;
  expected_confirmation_window: string | null;
  payout_status: string | null;
  payout_eta: string | null;
  payout_expected_date: string | null;
  payout_delay_stage: string | null;
  premature_withdrawal_estimate: number | null;
  premature_withdrawal_penalty: number | null;
  premature_withdrawal_payout_window: string | null;
}

export interface SupportTicketSeed {
  ticket_id: string;
  issue: string;
  priority: 'low' | 'medium' | 'high';
  status: 'open' | 'in_progress' | 'resolved';
  sla: string;
  escalation_reason: string | null;
  created_at: string;
}

export interface SecureLinkSeed {
  action: string;
  fd_id: string | null;
  status: 'ready_to_send' | 'sent' | 'expired';
  expires_in: string | null;
}

/** Fields written to demo_users on persona selection (excluding id, session_id, email, created_at). */
export interface PersonaSeed {
  persona_id: string;
  customer_id: string;
  name: string;
  mobile_last_4: string;
  date_of_birth: string;
  kyc_status: KycStatus;
  kyc_rejection_reason: string | null;
  kyc_eta: string | null;
  kyc_next_step: string | null;
  payments: PaymentSeed[];
  fixed_deposits: FixedDepositSeed[];
  open_tickets: SupportTicketSeed[];
  secure_links: SecureLinkSeed[];
}

export const PERSONAS: readonly PersonaSeed[] = [
  {
    persona_id: 'cust_demo_001',
    customer_id: 'cust_demo_001',
    name: 'Ananya Sharma',
    mobile_last_4: '3210',
    date_of_birth: '1991-08-14',
    kyc_status: 'pending_review',
    kyc_rejection_reason: null,
    kyc_eta: 'usually within 24 working hours',
    kyc_next_step: 'Wait for review completion; no document resubmission needed right now',
    payments: [
      {
        payment_reference: 'PAY-8831',
        aliases: ['45791034', 'UTR45791034', 'pay_45791034'],
        source_bank: 'HDFC',
        amount: 50000,
        status: 'pending_reconciliation',
        eta: 'booking may complete, otherwise refund usually reflects within 5 working days',
        refund_status: 'not_initiated',
        refund_eta: 'within 5 working days if booking does not complete',
      },
    ],
    fixed_deposits: [
      {
        fd_id: 'FD-8110',
        booking_date: '2026-05-01',
        bank: 'Shriram Finance',
        amount: 50000,
        tenure: '12 months',
        status: 'processing',
        maturity_date: '2027-05-01',
        expected_confirmation_window: 'usually within 24 to 48 working hours',
        payout_status: null,
        payout_eta: null,
        payout_expected_date: null,
        payout_delay_stage: null,
        premature_withdrawal_estimate: null,
        premature_withdrawal_penalty: null,
        premature_withdrawal_payout_window: null,
      },
    ],
    open_tickets: [
      {
        ticket_id: 'TKT-10031',
        issue: 'Payment reconciliation follow-up for PAY-8831',
        priority: 'high',
        status: 'open',
        sla: 'within 48 hours',
        escalation_reason: 'User requested follow-up on debited payment',
        created_at: '2026-05-10T10:30:00+05:30',
      },
    ],
    secure_links: [],
  },
  {
    persona_id: 'cust_demo_002',
    customer_id: 'cust_demo_002',
    name: 'Rohan Mehta',
    mobile_last_4: '7741',
    date_of_birth: '1988-03-22',
    kyc_status: 'rejected',
    kyc_rejection_reason: 'Address proof document was blurry and could not be verified',
    kyc_eta: null,
    kyc_next_step: 'Resubmit a clear address proof document from the app',
    payments: [],
    fixed_deposits: [],
    open_tickets: [
      {
        ticket_id: 'TKT-10044',
        issue: 'KYC document rejected; customer needs resubmission help',
        priority: 'medium',
        status: 'open',
        sla: 'within 48 hours',
        escalation_reason: 'Customer needs clarity on rejected address proof',
        created_at: '2026-05-10T12:15:00+05:30',
      },
    ],
    secure_links: [],
  },
  {
    persona_id: 'cust_demo_003',
    customer_id: 'cust_demo_003',
    name: 'Priya Nair',
    mobile_last_4: '5598',
    date_of_birth: '1995-11-09',
    kyc_status: 'approved',
    kyc_rejection_reason: null,
    kyc_eta: null,
    kyc_next_step: null,
    payments: [
      {
        payment_reference: 'PAY-3345',
        aliases: ['UTR33450091', '33450091'],
        source_bank: 'HDFC',
        amount: 75000,
        status: 'settled',
        eta: null,
        refund_status: null,
        refund_eta: null,
      },
      {
        payment_reference: 'PAY-6670',
        aliases: ['UTR66700018', '66700018'],
        source_bank: 'SBI',
        amount: 30000,
        status: 'settled',
        eta: null,
        refund_status: null,
        refund_eta: null,
      },
    ],
    fixed_deposits: [
      {
        fd_id: 'FD-3345',
        booking_date: '2025-05-06',
        bank: 'Mahindra Finance',
        amount: 75000,
        tenure: '12 months',
        status: 'matured',
        maturity_date: '2026-05-06',
        expected_confirmation_window: null,
        payout_status: 'delayed_follow_up_needed',
        payout_eta: 'usually within 1 to 3 working days',
        payout_expected_date: '2026-05-09',
        payout_delay_stage: 'T+3 to T+5',
        premature_withdrawal_estimate: null,
        premature_withdrawal_penalty: null,
        premature_withdrawal_payout_window: null,
      },
      {
        fd_id: 'FD-6670',
        booking_date: '2026-02-12',
        bank: 'Bajaj Finance',
        amount: 30000,
        tenure: '24 months',
        status: 'active',
        maturity_date: '2028-02-12',
        expected_confirmation_window: null,
        payout_status: null,
        payout_eta: null,
        payout_expected_date: null,
        payout_delay_stage: null,
        premature_withdrawal_estimate: 29150,
        premature_withdrawal_penalty: 850,
        premature_withdrawal_payout_window: 'usually within 1 to 3 working days after secure confirmation',
      },
    ],
    open_tickets: [
      {
        ticket_id: 'TKT-10052',
        issue: 'Maturity payout delayed beyond expected date for FD-3345',
        priority: 'medium',
        status: 'in_progress',
        sla: 'within 48 hours',
        escalation_reason: 'Maturity payout crossed expected date',
        created_at: '2026-05-09T15:45:00+05:30',
      },
    ],
    secure_links: [],
  },
  {
    persona_id: 'cust_demo_004',
    customer_id: 'cust_demo_004',
    name: 'Arjun Kapoor',
    mobile_last_4: '1123',
    date_of_birth: '1993-07-30',
    kyc_status: 'approved',
    kyc_rejection_reason: null,
    kyc_eta: null,
    kyc_next_step: null,
    payments: [
      {
        payment_reference: 'PAY-4412',
        aliases: ['UTR44120064', '44120064'],
        source_bank: 'Kotak',
        amount: 200000,
        status: 'settled',
        eta: null,
        refund_status: null,
        refund_eta: null,
      },
      {
        payment_reference: 'PAY-5148',
        aliases: ['UTR51482209', '51482209'],
        source_bank: 'HDFC',
        amount: 60000,
        status: 'settled',
        eta: null,
        refund_status: null,
        refund_eta: null,
      },
    ],
    fixed_deposits: [
      {
        fd_id: 'FD-4412',
        booking_date: '2025-01-15',
        bank: 'Shriram Finance',
        amount: 200000,
        tenure: '36 months',
        status: 'active',
        maturity_date: '2028-01-15',
        expected_confirmation_window: null,
        payout_status: null,
        payout_eta: null,
        payout_expected_date: null,
        payout_delay_stage: null,
        premature_withdrawal_estimate: 193000,
        premature_withdrawal_penalty: 7000,
        premature_withdrawal_payout_window: 'usually within 1 to 3 working days after secure confirmation',
      },
      {
        fd_id: 'FD-5148',
        booking_date: '2025-12-10',
        bank: 'Mahindra Finance',
        amount: 60000,
        tenure: '12 months',
        status: 'active',
        maturity_date: '2026-12-10',
        expected_confirmation_window: null,
        payout_status: null,
        payout_eta: null,
        payout_expected_date: null,
        payout_delay_stage: null,
        premature_withdrawal_estimate: 58200,
        premature_withdrawal_penalty: 1800,
        premature_withdrawal_payout_window: 'usually within 1 to 3 working days after secure confirmation',
      },
    ],
    open_tickets: [],
    secure_links: [
      {
        action: 'premature_withdrawal',
        fd_id: 'FD-4412',
        status: 'ready_to_send',
        expires_in: '15 minutes',
      },
    ],
  },
  {
    persona_id: 'cust_demo_005',
    customer_id: 'cust_demo_005',
    name: 'Kavya Singh',
    mobile_last_4: '8820',
    date_of_birth: '2000-02-14',
    kyc_status: 'in_progress',
    kyc_rejection_reason: null,
    kyc_eta: 'usually within 24 working hours',
    kyc_next_step: 'Complete the in-app KYC steps and wait for review',
    payments: [],
    fixed_deposits: [],
    open_tickets: [],
    secure_links: [],
  },
] as const;

const byId = new Map(PERSONAS.map((p) => [p.persona_id, p]));

export function getPersonaById(personaId: string): PersonaSeed | undefined {
  return byId.get(personaId);
}

export function kycBadgeLabel(status: KycStatus): string {
  switch (status) {
    case 'not_started':
      return 'KYC - Not started';
    case 'in_progress':
      return 'KYC - In progress';
    case 'pending_review':
      return 'KYC - Pending review';
    case 'rejected':
      return 'KYC - Rejected';
    case 'approved':
      return 'KYC - Approved';
    default:
      return status;
  }
}
