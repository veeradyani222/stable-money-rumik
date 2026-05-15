export const CANONICAL_SLAS = {
  fd_booking_processing: 'usually within 24 to 48 working hours',
  payment_reconciliation: 'booking may complete, otherwise refund usually reflects within 5 working days',
  maturity_payout: 'usually within 1 to 3 working days',
  grievance_response: 'within 48 hours',
  kyc_pending_review: 'usually within 24 working hours',
} as const;

export const DISCLOSURE_COPY = {
  recording: 'This call may be recorded for quality purposes.',
  fd: 'Stable Money is a distributor. FDs are held directly with the RBI-regulated partner bank and are insured up to 5 lakh rupees per depositor per bank under DICGC. FDs are not regulated by SEBI and are outside the SCORES and Exchange Arbitration framework.',
  mutual_fund:
    'Mutual fund investments are subject to market risks. Please read all scheme related documents carefully. Stable Finserv Private Limited is an AMFI-registered mutual fund distributor. Past performance does not guarantee future returns.',
  tax: 'I can share general information, but this is not personalized tax advice. Please consult a chartered accountant for your specific situation.',
} as const;

export const PROJECT_EXACT_LINES = {
  moneyAnxiety: 'I understand why that is worrying. Let me check the exact status for you.',
  rateCompare: "I can help compare rates, but I can't recommend one specific FD.",
  toolFailure:
    "I don't want to guess here. I couldn't fetch the latest detail right now. I can create a ticket or give you the support contact.",
  audioRepair: 'Sorry, the audio was not clear. Could you please repeat that once?',
  silenceFiveSeconds: 'Are you still there?',
  silenceTenSeconds: 'If this is not a good time, I can end the call and you can call again later.',
  outOfScope: 'That specific request is outside what I can complete on voice. I can either create a ticket or guide you to the right team.',
  afterHours:
    'Our human support team is available from 10 AM to 7 PM IST, Monday to Saturday. I can create a ticket for follow-up.',
  paymentSafe: 'aapka paisa safe hai',
  paymentWorstCase: 'worst case mein refund mil jayega, koi loss nahi hoga',
} as const;

export const TRUST_FACTS = {
  company_identity: 'Stable Money is operated by Stable-Alpha Technologies Pvt. Ltd.',
  support_identity: 'Stable Assist is Stable Money support for first-line voice help.',
  partner_bank_model: 'FDs are held directly with the RBI-regulated partner bank.',
  dicgc: 'Eligible bank deposits are insured up to 5 lakh rupees per depositor per bank under DICGC.',
  tone_rule: 'Answer trust questions short, fact-based, and without hype.',
} as const;

export const SUPPORT_CONTACT = {
  human_support_hours: '10:00-19:00 IST, Monday to Saturday',
  contact_reference: 'stablemoney.in/contact-us',
  after_hours_wording: PROJECT_EXACT_LINES.afterHours,
  grievance_sla: CANONICAL_SLAS.grievance_response,
} as const;

export const DEMO_FD_RATES = [
  {
    issuer: 'Shriram Finance',
    tenure: '12 months',
    regular_rate: '7.75% p.a.',
    senior_citizen_rate: '8.25% p.a.',
  },
  {
    issuer: 'Mahindra Finance',
    tenure: '12 months',
    regular_rate: '7.70% p.a.',
    senior_citizen_rate: '8.20% p.a.',
  },
  {
    issuer: 'Bajaj Finance',
    tenure: '24 months',
    regular_rate: '8.05% p.a.',
    senior_citizen_rate: '8.55% p.a.',
  },
] as const;

export type StableAuthTier = 'Tier A' | 'Tier B' | 'Tier C' | 'Tier A/B';

export type StableIntentId =
  | 'payment.failed'
  | 'fd.book.status'
  | 'fd.withdraw.premature'
  | 'kyc.status'
  | 'kyc.explainer'
  | 'fd.rates.compare'
  | 'maturity.payout.delay'
  | 'app.real.check'
  | 'ticket.status'
  | 'grievance.escalate'
  | 'support.contact'
  | 'payment.summary'
  | 'fd.summary'
  | 'account.overview'
  | 'refund.status'
  | 'secure.action.help'
  | 'unknown';

export interface StableIntentPolicy {
  authTier: StableAuthTier;
  tools: string[];
}

export interface StableIntentRoute extends StableIntentPolicy {
  intent: StableIntentId;
}

export interface StableTurnHistoryMessage {
  role: 'user' | 'model';
  text: string;
}

export const STABLE_INTENT_POLICIES: Record<Exclude<StableIntentId, 'unknown'>, StableIntentPolicy> = {
  'payment.failed': {
    authTier: 'Tier B',
    tools: ['verify_read_access', 'get_payment_reconciliation_status'],
  },
  'fd.book.status': {
    authTier: 'Tier B',
    tools: ['verify_read_access', 'get_fd_booking_status'],
  },
  'fd.withdraw.premature': {
    authTier: 'Tier C',
    tools: ['verify_read_access', 'get_premature_withdrawal_quote', 'send_secure_link'],
  },
  'kyc.status': {
    authTier: 'Tier B',
    tools: ['verify_read_access', 'get_kyc_status'],
  },
  'kyc.explainer': {
    authTier: 'Tier A',
    tools: [],
  },
  'fd.rates.compare': {
    authTier: 'Tier A',
    tools: ['get_fd_rates'],
  },
  'maturity.payout.delay': {
    authTier: 'Tier B',
    tools: ['verify_read_access', 'get_fd_booking_status'],
  },
  'app.real.check': {
    authTier: 'Tier A',
    tools: ['get_trust_facts', 'get_disclosure_copy'],
  },
  'ticket.status': {
    authTier: 'Tier B',
    tools: ['verify_read_access', 'get_support_ticket_status'],
  },
  'grievance.escalate': {
    authTier: 'Tier A/B',
    tools: ['create_support_ticket', 'get_support_contact'],
  },
  'support.contact': {
    authTier: 'Tier A',
    tools: ['get_support_contact'],
  },
  'payment.summary': {
    authTier: 'Tier B',
    tools: ['verify_read_access', 'get_payment_summary'],
  },
  'fd.summary': {
    authTier: 'Tier B',
    tools: ['verify_read_access', 'get_fd_summary'],
  },
  'account.overview': {
    authTier: 'Tier A',
    tools: ['get_account_overview'],
  },
  'refund.status': {
    authTier: 'Tier B',
    tools: ['verify_read_access', 'get_refund_status'],
  },
  'secure.action.help': {
    authTier: 'Tier C',
    tools: ['send_secure_link', 'create_support_ticket'],
  },
} as const;

export function getStableIntentPolicy(intent: Exclude<StableIntentId, 'unknown'>): StableIntentPolicy {
  const policy = STABLE_INTENT_POLICIES[intent];
  return {
    authTier: policy.authTier,
    tools: [...policy.tools],
  };
}

function unknownIntentRoute(): StableIntentRoute {
  return {
    intent: 'unknown',
    authTier: 'Tier A',
    tools: [],
  };
}

export function routeStableIntent(_transcript: string): StableIntentRoute {
  return unknownIntentRoute();
}

export function routeStableTurn(_transcript: string, _history: StableTurnHistoryMessage[] = []): StableIntentRoute {
  return unknownIntentRoute();
}

export function buildStableProjectPromptRules(): string {
  return [
    'Follow these exact scenario and tool rules. Fixed auth tier routing is owned by code; do not override the current turn route.',
    '',
    'Phase 1 scenario detection:',
    '- payment.failed: money debited, FD not booked, payment pending, refund or reconciliation question.',
    '- fd.book.status: FD booking or confirmation status.',
    '- fd.withdraw.premature: caller wants to break or withdraw an FD early.',
    '- kyc.status: KYC progress, pending review, rejected, approved, or next step.',
    '- kyc.explainer: general KYC meaning or product explainer. No account status, no verification, and no tools.',
    '- fd.rates.compare: compare FD rates or tenures. Never recommend one specific FD.',
    '- maturity.payout.delay: matured FD payout delay.',
    '- app.real.check: trust, legitimacy, DICGC, partner bank, or is Stable Money real.',
    '- ticket.status: support ticket status, ticket SLA, or open support ticket question.',
    '- grievance.escalate: complaint, escalation, formal grievance, or unresolved support issue.',
    '',
    'Exact tool contract from PROJECT.md. Use these names exactly:',
    '- verify_read_access: Verify Tier B read access.',
    '- lookup_customer_profile: Basic customer profile.',
    '- get_trust_facts: Approved public trust facts and support identity.',
    '- get_canonical_slas: Canonical approved SLA wording.',
    '- get_disclosure_copy: Exact approved disclosure copy.',
    '- get_fd_booking_status: FD or booking status.',
    '- get_payment_reconciliation_status: Payment or reconciliation lookup.',
    '- get_kyc_status: KYC state and ETA.',
    '- get_premature_withdrawal_quote: Estimate plus penalty.',
    '- get_support_ticket_status: Support ticket status and SLA.',
    '- get_fd_rates: General rate comparison.',
    '- create_support_ticket: Complaint or escalation.',
    '- send_secure_link: Tier C follow-up.',
    '- get_support_contact: Contact and grievance details.',
    '',
    'Auth rules:',
    '- Tier A needs no auth: rates, FAQs, trust checks, product explainers, support contact details.',
    '- Tier B needs verified read access: FD booking status, payment status, KYC status, payout schedule, ticket status.',
    '- Tier C is never completed on voice: change mobile, payout bank, premature withdrawal execution, payout changes, nominee/profile legal changes.',
    '- Do not ask the caller to read an OTP aloud on voice.',
    '- Never ask for full Aadhaar, CVV, PIN, bank password, or read back a full mobile number.',
    '',
    'Response pattern when applicable: acknowledge, say what you will check, call the tool, summarize result in plain language, give one next step.',
    `Money anxiety exact line for payment.failed and maturity.payout.delay: "${PROJECT_EXACT_LINES.moneyAnxiety}"`,
    `Payment.failed required phrases: "${PROJECT_EXACT_LINES.paymentSafe}" and "${PROJECT_EXACT_LINES.paymentWorstCase}".`,
    'Avoid saying: "I don\'t know where your money is".',
    `Rate question exact line: "${PROJECT_EXACT_LINES.rateCompare}"`,
    `Tool failure exact line: "${PROJECT_EXACT_LINES.toolFailure}"`,
    `Audio repair exact line: "${PROJECT_EXACT_LINES.audioRepair}"`,
    `Out-of-scope exact line: "${PROJECT_EXACT_LINES.outOfScope}"`,
    `After-hours exact line: "${PROJECT_EXACT_LINES.afterHours}"`,
    '',
    'Canonical SLA wording. Quote only these unless a tool returns a more precise ETA:',
    `- FD booking processing: "${CANONICAL_SLAS.fd_booking_processing}"`,
    `- Payment reconciliation: "${CANONICAL_SLAS.payment_reconciliation}"`,
    `- Maturity payout: "${CANONICAL_SLAS.maturity_payout}"`,
    `- Grievance response: "${CANONICAL_SLAS.grievance_response}"`,
    `- KYC pending review: "${CANONICAL_SLAS.kyc_pending_review}"`,
    '',
    'Core scenario routing:',
    '- payment.failed: reassure before policy, verify read access, call get_payment_reconciliation_status, explain booking-or-refund, offer or create ticket.',
    '- fd.book.status: verify read access, call get_fd_booking_status, escalate if failed or processing beyond 48 working hours.',
    '- fd.withdraw.premature: verify read access, call get_premature_withdrawal_quote, explain estimate and penalty, call send_secure_link, do not execute on voice.',
    '- kyc.status: verify read access, call get_kyc_status. If rejected, use only the backend reason.',
    '- kyc.explainer: answer briefly that KYC means Know Your Customer identity verification, and say status checks need verification.',
    '- maturity.payout.delay: verify read access, call get_fd_booking_status, before T+3 reassure and share date, T+3 to T+5 create follow-up ticket, beyond T+5 priority escalation.',
    '- ticket.status: verify read access, call get_support_ticket_status, summarize status and SLA.',
    '- fd.rates.compare: no auth, call get_fd_rates, compare only, do not say "best FD".',
    '- app.real.check: no auth, call get_trust_facts and optionally get_disclosure_copy with topic fd. Keep it short and fact-based.',
    '- grievance.escalate: capture issue summary, priority, create_support_ticket, and give ticket ID before ending.',
    '',
    `FD disclosure exact copy: "${DISCLOSURE_COPY.fd}"`,
    `Tax disclaimer exact copy: "${DISCLOSURE_COPY.tax}"`,
  ].join('\n');
}
