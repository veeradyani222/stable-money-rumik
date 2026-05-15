import type { PersonaSeed } from '@/lib/personas';

export interface PersonaDetailRow {
  id: string;
  cells: string[];
}

export interface PersonaDetailSection {
  id: string;
  title: string;
  columns: string[];
  rows: PersonaDetailRow[];
}

function formatInr(amount: number | null | undefined): string {
  if (typeof amount !== 'number') return '-';
  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 0,
    style: 'currency',
    currency: 'INR',
  }).format(amount);
}

function valueOrDash(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  return String(value).replaceAll('_', ' ');
}

function formatDateMonthYear(value: string | null | undefined): string {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return valueOrDash(value);
  return `${match[3]}-${match[2]}-${match[1]}`;
}

export function buildPersonaDetailSections(persona: PersonaSeed): PersonaDetailSection[] {
  return [
    {
      id: 'identity',
      title: 'Identity',
      columns: ['Field', 'Value'],
      rows: [
        { id: 'customer', cells: ['Customer ID', persona.customer_id] },
        { id: 'mobile', cells: ['Mobile last 4', persona.mobile_last_4] },
        { id: 'dob', cells: ['Date of birth', formatDateMonthYear(persona.date_of_birth)] },
        { id: 'kyc', cells: ['KYC status', valueOrDash(persona.kyc_status)] },
        { id: 'kyc-next', cells: ['KYC next step', valueOrDash(persona.kyc_next_step)] },
      ],
    },
    {
      id: 'payments',
      title: 'Payments',
      columns: ['Reference', 'Amount', 'Bank', 'Status', 'ETA'],
      rows: persona.payments.map((payment) => ({
        id: payment.payment_reference,
        cells: [
          payment.payment_reference,
          formatInr(payment.amount),
          payment.source_bank,
          valueOrDash(payment.status),
          valueOrDash(payment.eta ?? payment.refund_eta),
        ],
      })),
    },
    {
      id: 'fixed-deposits',
      title: 'Fixed deposits',
      columns: ['FD ID', 'Amount', 'Bank', 'Tenure', 'Status', 'Timeline'],
      rows: persona.fixed_deposits.map((fd) => ({
        id: fd.fd_id,
        cells: [
          fd.fd_id,
          formatInr(fd.amount),
          fd.bank,
          fd.tenure,
          valueOrDash(fd.status),
          valueOrDash(fd.expected_confirmation_window ?? fd.payout_eta ?? fd.premature_withdrawal_payout_window),
        ],
      })),
    },
    {
      id: 'tickets',
      title: 'Support tickets',
      columns: ['Ticket', 'Issue', 'Priority', 'Status', 'SLA'],
      rows: persona.open_tickets.map((ticket) => ({
        id: ticket.ticket_id,
        cells: [
          ticket.ticket_id,
          ticket.issue,
          ticket.priority,
          valueOrDash(ticket.status),
          ticket.sla,
        ],
      })),
    },
    {
      id: 'secure-links',
      title: 'Secure links',
      columns: ['Action', 'FD ID', 'Status', 'Expires'],
      rows: persona.secure_links.map((link, index) => ({
        id: `${link.action}-${link.fd_id ?? 'general'}-${index}`,
        cells: [valueOrDash(link.action), valueOrDash(link.fd_id), valueOrDash(link.status), valueOrDash(link.expires_in)],
      })),
    },
  ].filter((section) => section.id === 'identity' || section.rows.length > 0);
}
