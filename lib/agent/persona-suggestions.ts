import { getStableIntentPolicy, type StableIntentId } from '@/lib/agent/stable-policy';
import { kycBadgeLabel, type PersonaSeed } from '@/lib/personas';

export interface PersonaBrief {
  customerId: string;
  name: string;
  statusLine: string;
  moneyLine: string;
  supportLine: string;
}

export interface PersonaSuggestion {
  id: string;
  label: string;
  prompt: string;
  intent: StableIntentId;
  tools: string[];
}

function formatInr(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 0,
    style: 'currency',
    currency: 'INR',
  }).format(amount);
}

export function buildPersonaBrief(persona: PersonaSeed): PersonaBrief {
  const primaryPayment = persona.payments[0];
  const primaryFd = persona.fixed_deposits[0];
  const ticket = persona.open_tickets[0];

  return {
    customerId: persona.customer_id,
    name: persona.name,
    statusLine: `${kycBadgeLabel(persona.kyc_status)}${
      persona.kyc_next_step ? ` - ${persona.kyc_next_step}` : ''
    }`,
    moneyLine: primaryPayment
      ? `${primaryPayment.payment_reference} from ${primaryPayment.source_bank} for ${formatInr(primaryPayment.amount)} is ${primaryPayment.status.replaceAll('_', ' ')}`
      : primaryFd
        ? `${primaryFd.fd_id} with ${primaryFd.bank} for ${formatInr(primaryFd.amount)} is ${primaryFd.status}`
        : 'No payment or FD record is attached to this persona',
    supportLine: ticket
      ? `${ticket.ticket_id} is ${ticket.status.replaceAll('_', ' ')} with ${ticket.sla} SLA`
      : 'No open support ticket',
  };
}

export function getPersonaSuggestions(persona: PersonaSeed): PersonaSuggestion[] {
  const suggestions: PersonaSuggestion[] = [];
  const payment = persona.payments[0];
  const fd = persona.fixed_deposits[0];
  const secureLink = persona.secure_links.find((link) => link.status === 'ready_to_send');

  function addSuggestion(id: string, label: string, prompt: string, intent: StableIntentId) {
    const policy = getStableIntentPolicy(intent as Exclude<StableIntentId, 'unknown'>);
    suggestions.push({
      id,
      label,
      prompt,
      intent,
      tools: policy.tools,
    });
  }

  if (payment) {
    addSuggestion(
      'payment-status',
      'Payment status',
      `Check my payment ${payment.payment_reference} and tell me what happens next.`,
      'payment.failed',
    );
  }

  if (fd) {
    addSuggestion(
      'fd-booking-status',
      'FD status',
      `Tell me the current status of ${fd.fd_id} and any expected timeline.`,
      'fd.book.status',
    );
  }

  addSuggestion(
    'kyc-status',
    'KYC update',
    'Check my KYC status and explain the next step clearly.',
    'kyc.status',
  );

  const prematureFd = persona.fixed_deposits.find((item) => item.premature_withdrawal_estimate !== null);
  if (prematureFd) {
    addSuggestion(
      'premature-withdrawal',
      'Premature withdrawal',
      `Explain premature withdrawal for ${prematureFd.fd_id}, including estimate and penalty.`,
      'fd.withdraw.premature',
    );
  }

  if (secureLink) {
    addSuggestion(
      'secure-link',
      'Secure link',
      `Send me the secure link for ${secureLink.action.replaceAll('_', ' ')} on ${secureLink.fd_id}.`,
      'secure.action.help',
    );
  }

  if (persona.open_tickets.length > 0) {
    addSuggestion(
      'ticket-status',
      'Ticket status',
      `Check my ticket ${persona.open_tickets[0].ticket_id} and tell me the SLA.`,
      'ticket.status',
    );
  } else {
    addSuggestion(
      'grievance',
      'Raise grievance',
      'Create a support follow-up ticket if my issue cannot be resolved on this call.',
      'grievance.escalate',
    );
  }

  return suggestions;
}
