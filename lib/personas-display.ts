import type {
  FixedDepositSeed,
  PaymentSeed,
  PersonaSeed,
  SecureLinkSeed,
  SupportTicketSeed,
} from '@/lib/personas';
import { kycBadgeLabel } from '@/lib/personas';

export function formatScalar(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'number') return value.toLocaleString('en-IN');
  return value;
}

function formatPayment(payment: PaymentSeed): string {
  const aliases = payment.aliases.length ? payment.aliases.join(', ') : 'None';
  const lines = [
    `Payment reference: ${payment.payment_reference}`,
    `Source bank: ${payment.source_bank}`,
    `Amount: Rs ${formatScalar(payment.amount)}`,
    `Status: ${payment.status}`,
    `Aliases: ${aliases}`,
  ];
  if (payment.eta) lines.push(`ETA: ${payment.eta}`);
  if (payment.refund_status || payment.refund_eta) {
    lines.push(`Refund: ${formatScalar(payment.refund_status)} - ${formatScalar(payment.refund_eta)}`);
  }
  return lines.join('\n');
}

function formatFixedDeposit(fd: FixedDepositSeed): string {
  const lines = [
    `FD ID: ${fd.fd_id}`,
    `Bank: ${fd.bank}`,
    `Amount: Rs ${formatScalar(fd.amount)}`,
    `Tenure: ${fd.tenure}`,
    `Status: ${fd.status}`,
  ];
  if (fd.booking_date) lines.push(`Booking date: ${fd.booking_date}`);
  if (fd.expected_confirmation_window) {
    lines.push(`Confirmation window: ${fd.expected_confirmation_window}`);
  }
  if (fd.maturity_date) lines.push(`Maturity date: ${fd.maturity_date}`);
  if (fd.payout_status || fd.payout_eta || fd.payout_expected_date || fd.payout_delay_stage) {
    lines.push(`Payout: ${formatScalar(fd.payout_status)}`);
    if (fd.payout_eta) lines.push(`Payout ETA: ${fd.payout_eta}`);
    if (fd.payout_expected_date) lines.push(`Expected payout: ${fd.payout_expected_date}`);
    if (fd.payout_delay_stage) lines.push(`Delay stage: ${fd.payout_delay_stage}`);
  }
  if (fd.premature_withdrawal_estimate || fd.premature_withdrawal_penalty) {
    lines.push(
      `Premature withdrawal quote: Rs ${formatScalar(fd.premature_withdrawal_estimate)} after Rs ${formatScalar(fd.premature_withdrawal_penalty)} penalty`,
    );
  }
  if (fd.premature_withdrawal_payout_window) {
    lines.push(`Withdrawal payout window: ${fd.premature_withdrawal_payout_window}`);
  }
  return lines.join('\n');
}

function formatTicket(ticket: SupportTicketSeed): string {
  return [
    `Ticket ID: ${ticket.ticket_id}`,
    `Issue: ${ticket.issue}`,
    `Priority: ${ticket.priority}`,
    `Status: ${ticket.status}`,
    `SLA: ${ticket.sla}`,
    `Escalation reason: ${formatScalar(ticket.escalation_reason)}`,
    `Created: ${ticket.created_at}`,
  ].join('\n');
}

function formatSecureLink(link: SecureLinkSeed): string {
  return [
    `${link.action} | FD: ${formatScalar(link.fd_id)}`,
    `Status: ${link.status} | Expires in: ${formatScalar(link.expires_in)}`,
  ].join('\n');
}

function formatList<T>(items: T[], formatter: (item: T) => string): string {
  if (!items.length) return 'None';
  return items.map((item, index) => `${index + 1}.\n${formatter(item)}`).join('\n\n');
}

export type PersonaDetailSection = {
  heading: string;
  rows: { label: string; value: string; pre?: boolean }[];
};

export function personaDetailSections(persona: PersonaSeed): PersonaDetailSection[] {
  return [
    {
      heading: 'Profile',
      rows: [
        { label: 'Customer ID', value: formatScalar(persona.customer_id) },
        { label: 'Name', value: formatScalar(persona.name) },
        { label: 'Mobile last 4', value: formatScalar(persona.mobile_last_4) },
        { label: 'Date of birth', value: formatScalar(persona.date_of_birth) },
      ],
    },
    {
      heading: 'KYC',
      rows: [
        { label: 'Status', value: kycBadgeLabel(persona.kyc_status) },
        { label: 'Rejection reason', value: formatScalar(persona.kyc_rejection_reason) },
        { label: 'ETA', value: formatScalar(persona.kyc_eta) },
        { label: 'Next step', value: formatScalar(persona.kyc_next_step) },
      ],
    },
    {
      heading: 'Payments',
      rows: [{ label: 'Payment records', value: formatList(persona.payments, formatPayment), pre: true }],
    },
    {
      heading: 'Fixed deposits',
      rows: [
        {
          label: 'FD records',
          value: formatList(persona.fixed_deposits, formatFixedDeposit),
          pre: true,
        },
      ],
    },
    {
      heading: 'Secure links',
      rows: [{ label: 'Available links', value: formatList(persona.secure_links, formatSecureLink), pre: true }],
    },
    {
      heading: 'Support',
      rows: [{ label: 'Open tickets', value: formatList(persona.open_tickets, formatTicket), pre: true }],
    },
  ];
}
