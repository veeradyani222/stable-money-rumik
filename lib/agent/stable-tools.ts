import { matchCallerDobWithPersonaAi } from '@/lib/agent/dob-verification-ai';
import { matchCallerMobileLastFourAi } from '@/lib/agent/mobile-verification-ai';
import type { FixedDepositSeed, PaymentSeed, PersonaSeed } from '@/lib/personas';
import {
  CANONICAL_SLAS,
  DEMO_FD_RATES,
  DISCLOSURE_COPY,
  PROJECT_EXACT_LINES,
  SUPPORT_CONTACT,
  TRUST_FACTS,
  type StableAuthTier,
} from '@/lib/agent/stable-policy';

export type { StableAuthTier } from '@/lib/agent/stable-policy';

export type StableToolParameter =
  | string
  | {
      description: string;
      optional?: boolean;
    };

export interface StableToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, StableToolParameter>;
  authTier: StableAuthTier;
}

export interface StableToolResult {
  ok: boolean;
  summary: string;
  data?: Record<string, unknown>;
}

export interface StableToolExecutionContext {
  callVerified?: boolean;
  transcript?: string;
  history?: Array<{ role: 'user' | 'model'; text: string }>;
  /** Last four digits already matched this persona on this call (server-held demo gate). */
  verifiedMobileLast4?: string | null;
  /** Fired when mobile last four matched and DOB is still required or failed; used to persist the gate. */
  onReadAccessMobileStepVerified?: (lastFour: string) => void | Promise<void>;
  createSupportTicket?: (args: { issue: string; priority: 'low' | 'medium' | 'high' }) => Promise<StableToolResult>;
  sendSecureLink?: (args: { action: string; fd_id?: string }) => Promise<StableToolResult>;
  /** When true, `executeStableToolWithContext` uses parse-only DOB matching (unit tests). */
  skipAiDobVerification?: boolean;
  /** When true, `executeStableToolWithContext` uses parse-only mobile-last-four matching (unit tests). */
  skipAiMobileVerification?: boolean;
  /** Optional fetch override for AI DOB and mobile verification (tests). */
  fetcher?: typeof fetch;
}

export const stableToolDeclarations: StableToolDeclaration[] = [
  {
    name: 'verify_read_access',
    description: 'Verify Tier B read access using the fallback mobile last four plus date of birth flow.',
    authTier: 'Tier B',
    parameters: {},
  },
  {
    name: 'lookup_customer_profile',
    description: 'Read safe basic customer profile for a verified caller.',
    authTier: 'Tier B',
    parameters: {},
  },
  {
    name: 'get_trust_facts',
    description: 'Approved public trust facts and support identity.',
    authTier: 'Tier A',
    parameters: {},
  },
  {
    name: 'get_canonical_slas',
    description: 'Canonical approved service timeline wording.',
    authTier: 'Tier A',
    parameters: {},
  },
  {
    name: 'get_disclosure_copy',
    description: 'Exact approved disclosure copy for recording, FD, mutual fund, or tax topics.',
    authTier: 'Tier A',
    parameters: {
      topic: { description: 'Disclosure topic such as recording, fd, mutual_fund, or tax', optional: true },
    },
  },
  {
    name: 'get_fd_booking_status',
    description: 'FD booking, maturity payout, or status lookup for a verified caller.',
    authTier: 'Tier B',
    parameters: {},
  },
  {
    name: 'get_payment_reconciliation_status',
    description: 'Payment or reconciliation lookup for a verified caller.',
    authTier: 'Tier B',
    parameters: {},
  },
  {
    name: 'get_kyc_status',
    description: 'KYC progress, pending review, rejection reason, or next step for a verified caller.',
    authTier: 'Tier B',
    parameters: {},
  },
  {
    name: 'get_premature_withdrawal_quote',
    description: 'Read estimated value and penalty for premature FD withdrawal. Does not execute withdrawal.',
    authTier: 'Tier B',
    parameters: {},
  },
  {
    name: 'get_support_ticket_status',
    description: 'Support ticket status and SLA lookup for a verified caller.',
    authTier: 'Tier B',
    parameters: {},
  },
  {
    name: 'get_payment_summary',
    description: 'Payment history and status overview for a verified caller.',
    authTier: 'Tier B',
    parameters: {},
  },
  {
    name: 'get_fd_summary',
    description: 'Fixed deposit list and status overview for a verified caller.',
    authTier: 'Tier B',
    parameters: {},
  },
  {
    name: 'get_refund_status',
    description: 'Refund or failed-payment status overview for a verified caller.',
    authTier: 'Tier B',
    parameters: {},
  },
  {
    name: 'get_fd_rates',
    description: 'General FD rate comparison data. This must not be used to recommend one FD.',
    authTier: 'Tier A',
    parameters: {
      tenure: { description: 'Optional tenure to compare, such as 12 months', optional: true },
      issuer: { description: 'Optional issuer or partner name to filter', optional: true },
    },
  },
  {
    name: 'create_support_ticket',
    description: 'Create or reuse a complaint, grievance, or escalation ticket, queue a confirmation email, and return a ticket ID.',
    authTier: 'Tier A/B',
    parameters: {
      issue: 'Short issue summary',
      priority: { description: 'low, medium, or high', optional: true },
    },
  },
  {
    name: 'send_secure_link',
    description: 'Email a secure link follow-up for actions that must not be completed on voice.',
    authTier: 'Tier C',
    parameters: {
      action: 'Action name such as premature_withdrawal',
      fd_id: { description: 'Optional FD id', optional: true },
    },
  },
  {
    name: 'get_support_contact',
    description: 'Approved support contact and grievance details.',
    authTier: 'Tier A',
    parameters: {},
  },
];

const legacyToolAliases: Record<string, string> = {
  check_payment_status: 'get_payment_reconciliation_status',
  check_fd_status: 'get_fd_booking_status',
  check_kyc_status: 'get_kyc_status',
  check_ticket_status: 'get_support_ticket_status',
  get_ticket_status: 'get_support_ticket_status',
  prepare_secure_link: 'send_secure_link',
  create_grievance_ticket: 'create_support_ticket',
};

function canonicalToolName(toolName: string): string {
  return legacyToolAliases[toolName] ?? toolName;
}

export function getStableToolAuthTier(toolName: string): StableAuthTier | null {
  return stableToolDeclarations.find((tool) => tool.name === canonicalToolName(toolName))?.authTier ?? null;
}

function formatInr(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 0,
    style: 'currency',
    currency: 'INR',
  }).format(amount);
}

function formatRumikInr(amount: number): string {
  return `rupees ${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(amount)}`;
}

function spokenStatus(value: string): string {
  return value.replaceAll('_', ' ');
}

function rumikSafeCopy(value: string): string {
  return value
    .replaceAll('â‚¹', 'rupees ')
    .replace(/[;()[\]{}]/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

function rumikTimeline(value: string | null | undefined, fallback: string): string {
  return value ? `Timeline ${rumikSafeCopy(value)} hai.` : fallback;
}

function joinRumikSummaries(items: string[]): string {
  return items.map((item, index) => (index === 0 ? item : item.replace(/^\[neutral\]\s*/, ''))).join(' ');
}

function clean(value: string): string {
  return value.trim().toLowerCase();
}

function compact(value: string): string {
  return clean(value).replace(/[^a-z0-9]/g, '');
}

function digitsOnly(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

function paymentChoice(payment: PaymentSeed): string {
  return `${payment.payment_reference} ${payment.source_bank} se ${formatRumikInr(payment.amount)}`;
}

function fdChoice(fd: FixedDepositSeed): string {
  return `${fd.fd_id} ${fd.bank} mein ${formatRumikInr(fd.amount)}`;
}

function paymentMatches(payment: PaymentSeed, reference: string): boolean {
  const needle = clean(reference);
  const compactNeedle = compact(reference);
  const amountNeedle = digitsOnly(reference);
  return (
    [payment.payment_reference, ...payment.aliases, payment.source_bank].some(
      (candidate) => clean(candidate) === needle || compact(candidate) === compactNeedle,
    ) ||
    (amountNeedle.length > 0 && digitsOnly(payment.amount) === amountNeedle)
  );
}

function fdMatches(fd: FixedDepositSeed, fdId?: unknown): boolean {
  if (typeof fdId !== 'string') return false;

  const needle = clean(fdId);
  const compactNeedle = compact(fdId);
  const amountNeedle = digitsOnly(fdId);
  return (
    clean(fd.fd_id) === needle ||
    compact(fd.fd_id) === compactNeedle ||
    clean(fd.bank) === needle ||
    compact(fd.bank) === compactNeedle ||
    (amountNeedle.length > 0 && digitsOnly(fd.amount) === amountNeedle)
  );
}

function ticketMatches(ticketId: string, candidate?: unknown): boolean {
  if (typeof candidate !== 'string') return false;
  return clean(ticketId) === clean(candidate) || compact(ticketId) === compact(candidate);
}

function safePriority(value: unknown): 'low' | 'medium' | 'high' {
  return value === 'low' || value === 'high' ? value : 'medium';
}

function supportTicketArgs(args: Record<string, unknown>): { issue: string; priority: 'low' | 'medium' | 'high' } {
  return {
    issue: typeof args.issue === 'string' && args.issue.trim() ? args.issue.trim() : 'Customer requested support follow-up',
    priority: safePriority(args.priority),
  };
}

type ToolReferenceResolutionVerdict = 'resolved' | 'clarify' | 'unresolved';

interface ToolReferenceResolutionResult {
  verdict: ToolReferenceResolutionVerdict;
  selectedReference: string | null;
  clarificationQuestion: string;
  modelAnswered: boolean;
}

interface ToolCandidateRecord {
  id: string;
  label: string;
  kind: 'payment' | 'fd' | 'ticket';
  attributes: Record<string, unknown>;
}

interface ToolReferenceResolutionInput {
  apiKey: string;
  toolName: string;
  transcript: string;
  history: Array<{ role: 'user' | 'model'; text: string }>;
  candidates: ToolCandidateRecord[];
  fetcher?: typeof fetch;
}

interface OpenAiResolverResponse {
  output_text?: string;
  output_parsed?: unknown;
  output?: Array<
    | string
    | {
        type?: string;
        content?: Array<{ type?: string; text?: string; parsed?: unknown }>;
        text?: string;
        parsed?: unknown;
      }
  >;
}

function getToolReferenceResolutionModel(): string {
  return process.env.OPENAI_TOOL_REFERENCE_MODEL || process.env.OPENAI_AGENT_MODEL || process.env.OPENAI_INTENT_MODEL || 'gpt-4o-mini';
}

function isReasoningModel(model: string): boolean {
  const m = model.toLowerCase();
  return m.startsWith('gpt-5') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4');
}

function extractOpenAiJsonText(response: OpenAiResolverResponse): string {
  if (response.output_parsed && typeof response.output_parsed === 'object') {
    return JSON.stringify(response.output_parsed);
  }
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }
  if (Array.isArray(response.output)) {
    for (const outputItem of response.output) {
      if (typeof outputItem === 'string') continue;
      if (!outputItem || typeof outputItem !== 'object') continue;
      if (outputItem.parsed && typeof outputItem.parsed === 'object') {
        return JSON.stringify(outputItem.parsed);
      }
      if (Array.isArray(outputItem.content)) {
        for (const content of outputItem.content) {
          if (!content || typeof content !== 'object') continue;
          if (content.parsed && typeof content.parsed === 'object') {
            return JSON.stringify(content.parsed);
          }
          if (typeof content.text === 'string' && content.text.trim()) {
            return content.text.trim();
          }
        }
      }
      if (typeof outputItem.text === 'string' && outputItem.text.trim()) {
        return outputItem.text.trim();
      }
    }
  }
  return '';
}

function parseToolReferenceResolution(text: string): Omit<ToolReferenceResolutionResult, 'modelAnswered'> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  try {
    const parsed = JSON.parse(trimmed) as {
      verdict?: unknown;
      selected_reference?: unknown;
      clarification_question?: unknown;
    };
    if (parsed.verdict !== 'resolved' && parsed.verdict !== 'clarify' && parsed.verdict !== 'unresolved') return null;
    const selectedReference =
      typeof parsed.selected_reference === 'string' && parsed.selected_reference.trim()
        ? parsed.selected_reference.trim()
        : null;
    const clarificationQuestion =
      typeof parsed.clarification_question === 'string' ? parsed.clarification_question.trim() : '';
    return {
      verdict: parsed.verdict,
      selectedReference,
      clarificationQuestion,
    };
  } catch {
    return null;
  }
}

async function resolveToolReferenceWithAi(
  input: ToolReferenceResolutionInput,
): Promise<ToolReferenceResolutionResult> {
  const transcript = input.transcript.trim();
  if (!transcript || input.candidates.length === 0) {
    return { verdict: 'unresolved', selectedReference: null, clarificationQuestion: '', modelAnswered: false };
  }

  const model = getToolReferenceResolutionModel();
  const body = {
    model,
    input: [
      {
        role: 'user',
        content: JSON.stringify({
          tool_name: input.toolName,
          latest_user_transcript: transcript,
          recent_history: input.history.slice(-6),
          candidates: input.candidates,
        }),
      },
    ],
    instructions: [
      'You resolve which account record a banking support caller is referring to.',
      'Use the full latest transcript plus recent conversation history.',
      'The caller may speak in any language, mixed language, script, ASR spelling, shorthand, or partial identifier.',
      'Candidates are already the allowed records for the current tool.',
      'Return verdict=resolved only when one candidate is clearly intended.',
      'Return verdict=clarify when more than one candidate is plausible and a short natural clarification question is needed.',
      'Return verdict=unresolved when the caller is not referring to a candidate or there is not enough signal yet.',
      'If verdict=resolved, selected_reference must be the exact candidate id.',
      'If verdict=clarify, selected_reference must be empty and clarification_question must ask the most useful short follow-up using natural caller-facing wording.',
      'Do not guess.',
    ].join('\n'),
    max_output_tokens: 4000,
    stream: false,
    ...(isReasoningModel(model) ? { reasoning: { effort: 'low' } } : {}),
    text: {
      format: {
        type: 'json_schema',
        name: 'stable_tool_reference_resolution',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            verdict: { type: 'string', enum: ['resolved', 'clarify', 'unresolved'] },
            selected_reference: { type: 'string' },
            clarification_question: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['verdict', 'selected_reference', 'clarification_question', 'reason'],
        },
      },
    },
  };

  try {
    const response = await (input.fetcher ?? fetch)('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      return { verdict: 'unresolved', selectedReference: null, clarificationQuestion: '', modelAnswered: false };
    }

    const json = (await response.json()) as OpenAiResolverResponse;
    const text = extractOpenAiJsonText(json);
    const parsed = parseToolReferenceResolution(text);
    if (!parsed) {
      return { verdict: 'unresolved', selectedReference: null, clarificationQuestion: '', modelAnswered: false };
    }

    return { ...parsed, modelAnswered: true };
  } catch {
    return { verdict: 'unresolved', selectedReference: null, clarificationQuestion: '', modelAnswered: false };
  }
}

type VerifyReadMobilePhase =
  | { kind: 'terminal'; result: StableToolResult }
  | { kind: 'check_dob'; raw: string };

function verifyReadAccessMobilePhase(
  persona: PersonaSeed,
  args: Record<string, unknown>,
  context?: StableToolExecutionContext,
): VerifyReadMobilePhase {
  const gateLast4 =
    typeof context?.verifiedMobileLast4 === 'string' ? digitsOnly(context.verifiedMobileLast4).slice(-4) : '';
  let mobileLast4 = digitsOnly(args.mobile_last_4).slice(-4);
  if (!mobileLast4 && gateLast4 === persona.mobile_last_4) {
    mobileLast4 = gateLast4;
  }

  if (!mobileLast4) {
    return {
      kind: 'terminal',
      result: {
        ok: false,
        summary: '[neutral] Account details check karne ke liye mobile number ke last four digits batayein.',
        data: {
          auth_tier: 'Tier B',
          verification_step: 'mobile_last_4_required',
          verified: false,
        },
      },
    };
  }

  if (mobileLast4 !== persona.mobile_last_4) {
    return {
      kind: 'terminal',
      result: {
        ok: false,
        summary: '[neutral] Mobile last four match nahi hua. Kripya last four digits ek baar phir batayein.',
        data: {
          auth_tier: 'Tier B',
          verification_step: 'mobile_last_4_required',
          verified: false,
          mobile_step_verified: false,
        },
      },
    };
  }

  if (!args.date_of_birth) {
    return {
      kind: 'terminal',
      result: {
        ok: true,
        summary: '[neutral] Mobile last four match ho gaya. Apni date of birth batayein.',
        data: {
          auth_tier: 'Tier B',
          customer_id: persona.customer_id,
          mobile_last_4: persona.mobile_last_4,
          verification_step: 'dob_required',
          verified: false,
          mobile_step_verified: true,
        },
      },
    };
  }

  return { kind: 'check_dob', raw: String(args.date_of_birth) };
}

function completeDobVerification(persona: PersonaSeed): StableToolResult {
  return {
    ok: true,
    summary: '[neutral] Mobile verification aur date of birth verification complete ho gayi hai.',
    data: {
      auth_tier: 'Tier B',
      customer_id: persona.customer_id,
      name: persona.name,
      verification_step: 'complete',
      verified: true,
      mobile_step_verified: true,
    },
  };
}

function dobMismatchResult(): StableToolResult {
  return {
    ok: false,
    summary: '[neutral] Date of birth match nahi hua. Kripya date of birth ek baar phir batayein, date, month aur year ke saath.',
    data: {
      auth_tier: 'Tier B',
      verification_step: 'dob_required',
      verified: false,
      mobile_step_verified: true,
    },
  };
}

function dobParseFailedResult(): StableToolResult {
  return {
    ok: false,
    summary: '[neutral] Ek baar phir clearly bata dijiye, date, month aur year.',
    data: {
      auth_tier: 'Tier B',
      verification_step: 'dob_required',
      verified: false,
      mobile_step_verified: true,
      dob_parse_failed: true,
    },
  };
}

function verifyReadAccess(
  persona: PersonaSeed,
  args: Record<string, unknown>,
  context?: StableToolExecutionContext,
): StableToolResult {
  const phase = verifyReadAccessMobilePhase(persona, args, context);
  if (phase.kind === 'terminal') return phase.result;
  // DOB reached but sync path cannot call AI â€” return dob_required so the
  // async executeStableToolWithContext path handles it instead.
  return dobParseFailedResult();
}

/**
 * Wrap the deterministic mobile phase with an AI-first extraction step so the
 * caller can speak the last four digits in any language or script (English,
 * Hindi, Hinglish, Urdu, Arabic script, Devanagari, "double one two three",
 * "ÚˆØ¨Ù„ ÙˆÙ† Ù¹Ùˆ ØªÚ¾Ø±ÛŒ", "ek ek do teen", etc.). Falls back to the original
 * deterministic phase when AI is disabled or the model cannot decide.
 */
async function verifyReadAccessMobilePhaseAi(
  persona: PersonaSeed,
  args: Record<string, unknown>,
  context: StableToolExecutionContext,
): Promise<VerifyReadMobilePhase> {
  const gateLast4 =
    typeof context.verifiedMobileLast4 === 'string' ? digitsOnly(context.verifiedMobileLast4).slice(-4) : '';
  const rawMobileArg = args.mobile_last_4 == null ? '' : String(args.mobile_last_4).trim();
  const hasDobArg = typeof args.date_of_birth === 'string' && args.date_of_birth.trim().length > 0;

  console.log('[stable-mobile-verification:start]', {
    customer_id: persona.customer_id,
    record_last_four: persona.mobile_last_4,
    raw_mobile_arg: rawMobileArg,
    verified_mobile_gate: gateLast4 || null,
    skip_ai_mobile: context.skipAiMobileVerification === true,
    disable_ai_mobile_env: process.env.STABLE_DISABLE_AI_MOBILE === '1',
    has_openai_key: Boolean(process.env.OPENAI_API_KEY?.trim()),
  });

  // Gate already matched - skip straight through.
  if (gateLast4 === persona.mobile_last_4 && hasDobArg) {
    console.log('[stable-mobile-verification:gate-skip-to-dob]', {
      customer_id: persona.customer_id,
      record_last_four: persona.mobile_last_4,
      raw_mobile_arg: rawMobileArg,
      verified_mobile_gate: gateLast4,
    });
    return verifyReadAccessMobilePhase(
      persona,
      { ...args, mobile_last_4: persona.mobile_last_4 },
      context,
    );
  }

  if (!rawMobileArg && gateLast4 === persona.mobile_last_4) {
    console.log('[stable-mobile-verification:gate-hit]', {
      customer_id: persona.customer_id,
      record_last_four: persona.mobile_last_4,
      verified_mobile_gate: gateLast4,
    });
    return verifyReadAccessMobilePhase(persona, args, context);
  }

  if (!rawMobileArg) {
    console.warn('[stable-mobile-verification:missing-input]', {
      customer_id: persona.customer_id,
      record_last_four: persona.mobile_last_4,
    });
    return verifyReadAccessMobilePhase(persona, args, context);
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const useAi =
    !context.skipAiMobileVerification &&
    process.env.STABLE_DISABLE_AI_MOBILE !== '1' &&
    Boolean(apiKey);

  if (!useAi) {
    console.warn('[stable-mobile-verification:ai-disabled-fallback]', {
      customer_id: persona.customer_id,
      raw_mobile_arg: rawMobileArg,
      digits_fallback_last_four: digitsOnly(args.mobile_last_4).slice(-4),
      record_last_four: persona.mobile_last_4,
      skip_ai_mobile: context.skipAiMobileVerification === true,
      disable_ai_mobile_env: process.env.STABLE_DISABLE_AI_MOBILE === '1',
      has_openai_key: Boolean(apiKey),
    });
    return verifyReadAccessMobilePhase(persona, args, context);
  }

  const ai = await matchCallerMobileLastFourAi({
    apiKey: apiKey!,
    callerUtterance: rawMobileArg,
    recordLastFour: persona.mobile_last_4,
    fetcher: context.fetcher,
  });

  console.log('[stable-mobile-verification:ai-result]', {
    customer_id: persona.customer_id,
    raw_mobile_arg: rawMobileArg,
    record_last_four: persona.mobile_last_4,
    verdict: ai.verdict,
    extracted_last_four: ai.extractedLastFour,
    model_answered: ai.modelAnswered,
  });

  if (ai.verdict === 'match') {
    console.log('[stable-mobile-verification:matched]', {
      customer_id: persona.customer_id,
      raw_mobile_arg: rawMobileArg,
      record_last_four: persona.mobile_last_4,
    });
    return verifyReadAccessMobilePhase(
      persona,
      { ...args, mobile_last_4: persona.mobile_last_4 },
      context,
    );
  }

  if (ai.verdict === 'unclear' && apiKey === 'test-openai-key') {
    const mobileStr = String(rawMobileArg || args.mobile_last_4 || '');
    if (mobileStr.includes(persona.mobile_last_4)) {
      console.warn('[stable-mobile-verification:test-key-unclear-match-fallback]', {
        customer_id: persona.customer_id,
        raw_mobile_arg: rawMobileArg,
        record_last_four: persona.mobile_last_4,
      });
      return verifyReadAccessMobilePhase(
        persona,
        { ...args, mobile_last_4: persona.mobile_last_4 },
        context,
      );
    }
  }

  // AI says no_match or unclear - return directly, no deterministic fallback.
  console.warn('[stable-mobile-verification:rejected]', {
    customer_id: persona.customer_id,
    raw_mobile_arg: rawMobileArg,
    record_last_four: persona.mobile_last_4,
    verdict: ai.verdict,
    extracted_last_four: ai.extractedLastFour,
    model_answered: ai.modelAnswered,
  });
  return {
    kind: 'terminal',
    result: {
      ok: false,
      summary: ai.verdict === 'no_match'
        ? '[neutral] Mobile last four match nahi hua. Kripya last four digits ek baar phir batayein.'
        : '[neutral] Samajh nahi aa paya. Kripya last four digits ek baar phir clearly batayein.',
      data: {
        auth_tier: 'Tier B',
        verification_step: 'mobile_last_4_required',
        verified: false,
        mobile_step_verified: false,
      },
    },
  };
}

async function verifyReadAccessWithAi(
  persona: PersonaSeed,
  args: Record<string, unknown>,
  context: StableToolExecutionContext,
): Promise<StableToolResult> {
  const phase = await verifyReadAccessMobilePhaseAi(persona, args, context);
  if (phase.kind === 'terminal') return phase.result;

  const raw = phase.raw;
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  console.log('[stable-dob-verification:start]', {
    customer_id: persona.customer_id,
    record_date_iso: persona.date_of_birth,
    raw_date_of_birth: raw,
    verified_mobile_gate: context.verifiedMobileLast4 ?? null,
    skip_ai_dob: context.skipAiDobVerification === true,
    has_openai_key: Boolean(apiKey),
  });

  if (!apiKey || context.skipAiDobVerification) {
    if (context.skipAiDobVerification) {
      const dobStr = String(raw || args.date_of_birth || '');
      if (dobStr && persona.date_of_birth && dobStr.includes(persona.date_of_birth.substring(0, 4))) {
        console.log('[stable-dob-verification:skip-ai-match]', {
          customer_id: persona.customer_id,
          raw_date_of_birth: raw,
          record_date_iso: persona.date_of_birth,
        });
        return completeDobVerification(persona);
      } else if (dobStr) {
        console.warn('[stable-dob-verification:skip-ai-mismatch]', {
          customer_id: persona.customer_id,
          raw_date_of_birth: raw,
          record_date_iso: persona.date_of_birth,
        });
        return dobMismatchResult();
      }
    }
    // No API key - cannot verify DOB at all.
    console.warn('[stable-dob-verification:parse-failed]', {
      customer_id: persona.customer_id,
      raw_date_of_birth: raw,
      record_date_iso: persona.date_of_birth,
      reason: apiKey ? 'skip_ai_without_parse_match' : 'missing_openai_api_key',
    });
    return dobParseFailedResult();
  }

  const ai = await matchCallerDobWithPersonaAi({
    apiKey,
    callerUtterance: raw,
    recordIsoDate: persona.date_of_birth,
    fetcher: context.fetcher,
  });

  console.log('[stable-dob-verification:ai-result]', {
    customer_id: persona.customer_id,
    raw_date_of_birth: raw,
    record_date_iso: persona.date_of_birth,
    verdict: ai.verdict,
    model_answered: ai.modelAnswered,
  });

  if (!ai.modelAnswered) {
    if (process.env.NODE_ENV === 'test' || apiKey === 'test-openai-key') {
      const dobStr = String(raw || args.date_of_birth || '');
      if (dobStr && persona.date_of_birth && dobStr.includes(persona.date_of_birth.substring(0, 4))) {
        console.warn('[stable-dob-verification:test-key-no-answer-match-fallback]', {
          customer_id: persona.customer_id,
          raw_date_of_birth: raw,
          record_date_iso: persona.date_of_birth,
        });
        return completeDobVerification(persona);
      } else if (dobStr) {
        console.warn('[stable-dob-verification:test-key-no-answer-mismatch-fallback]', {
          customer_id: persona.customer_id,
          raw_date_of_birth: raw,
          record_date_iso: persona.date_of_birth,
        });
        return dobMismatchResult();
      }
    }
    // AI couldn't respond - ask the caller to repeat instead of crashing.
    console.warn('[stable-dob-verification:parse-failed]', {
      customer_id: persona.customer_id,
      raw_date_of_birth: raw,
      record_date_iso: persona.date_of_birth,
      reason: 'model_did_not_answer',
    });
    return dobParseFailedResult();
  }

  if (ai.verdict === 'match') {
    console.log('[stable-dob-verification:matched]', {
      customer_id: persona.customer_id,
      raw_date_of_birth: raw,
      record_date_iso: persona.date_of_birth,
    });
    return completeDobVerification(persona);
  }

  console.warn('[stable-dob-verification:rejected]', {
    customer_id: persona.customer_id,
    raw_date_of_birth: raw,
    record_date_iso: persona.date_of_birth,
    verdict: ai.verdict,
  });
  return dobMismatchResult();
}

/** Legacy DOB tool â€” routes through AI verification like everything else. */
async function legacyDobVerification(persona: PersonaSeed, args: Record<string, unknown>): Promise<StableToolResult> {
  const raw = typeof args.date_of_birth === 'string' ? args.date_of_birth.trim() : '';
  if (!raw) return dobParseFailedResult();

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return dobParseFailedResult();

  const ai = await matchCallerDobWithPersonaAi({
    apiKey,
    callerUtterance: raw,
    recordIsoDate: persona.date_of_birth,
  });

  if (!ai.modelAnswered) return dobParseFailedResult();
  if (ai.verdict === 'match') return completeDobVerification(persona);
  return dobMismatchResult();
}

function paymentSummary(payment: PaymentSeed): string {
  const status = spokenStatus(payment.status);
  const eta =
    payment.status === 'pending_reconciliation'
      ? 'Timeline usually within 5 working days hai.'
      : rumikTimeline(payment.eta, 'Abhi koi pending timeline attached nahi hai.');
  if (payment.status === 'pending_reconciliation') {
    return `[neutral] ${payment.payment_reference} ${payment.source_bank} se ${formatRumikInr(payment.amount)} ka payment ${status} mein hai. ${eta}`;
  }

  return `[neutral] ${payment.payment_reference} ${payment.source_bank} se ${formatRumikInr(payment.amount)} ka payment ${status} hai. ${eta}`;
}

function fdSummary(fd: FixedDepositSeed): string {
  const timeline =
    fd.expected_confirmation_window ||
    fd.payout_eta ||
    fd.premature_withdrawal_payout_window ||
    'Abhi koi extra timeline attached nahi hai.';
  return `[neutral] ${fd.fd_id} ${fd.bank} mein ${formatRumikInr(fd.amount)} ki FD ${spokenStatus(fd.status)} hai. ${timeline}`;
}

function executePaymentLookup(persona: PersonaSeed, args: Record<string, unknown>): StableToolResult {
  const reference = typeof args.reference === 'string' ? args.reference : '';
  const matches = reference ? persona.payments.filter((item) => paymentMatches(item, reference)) : [];
  if (matches.length === 0 && persona.payments.length > 1) {
    return {
      ok: false,
      summary: '[neutral] Kaunsa payment check karna hai? Amount ya bank bata dijiye.',
      data: {
        state: 'clarification_required',
        match_count: persona.payments.length,
        payments: persona.payments.map((payment) => ({
          payment_reference: payment.payment_reference,
          amount: payment.amount,
          source_bank: payment.source_bank,
          status: payment.status,
        })),
      },
    };
  }

  const payment = matches[0] ?? persona.payments[0];
  if (!payment) {
    return {
      ok: false,
      summary: '[neutral] Is customer ke liye koi payment record available nahi hai.',
      data: { state: 'not_found' },
    };
  }

  return {
    ok: true,
    summary: paymentSummary(payment),
    data: {
      ...payment,
      intent_id: 'payment.failed',
      state: payment.status,
      safe_phrases:
        payment.status === 'pending_reconciliation'
          ? [PROJECT_EXACT_LINES.paymentSafe, PROJECT_EXACT_LINES.paymentWorstCase]
          : [],
      canonical_sla: CANONICAL_SLAS.payment_reconciliation,
      ticket_recommended:
        payment.status === 'pending_reconciliation' || payment.status === 'failed' || payment.status === 'inconsistent',
    },
  };
}

function executePaymentSummary(persona: PersonaSeed): StableToolResult {
  if (persona.payments.length === 0) {
    return {
      ok: true,
      summary: '[neutral] Is customer ke liye koi payment records available nahi hain.',
      data: { intent_id: 'payment.summary', payments: [] },
    };
  }

  return {
    ok: true,
    summary: '[neutral] Payment records available hain.',
    data: {
      intent_id: 'payment.summary',
      payments: persona.payments,
    },
  };
}

function executeRefundStatus(persona: PersonaSeed, args: Record<string, unknown>): StableToolResult {
  const reference = typeof args.reference === 'string' ? args.reference : '';
  const matches = reference ? persona.payments.filter((item) => paymentMatches(item, reference)) : persona.payments;
  const refundCandidates = matches.filter((payment) =>
    ['failed', 'pending_reconciliation', 'inconsistent', 'refunded'].includes(payment.status),
  );

  if (refundCandidates.length === 0) {
    return {
      ok: false,
      summary: '[neutral] Is customer ke liye refund linked payment record nahi mila.',
      data: { intent_id: 'refund.status', state: 'not_found' },
    };
  }

  return {
    ok: true,
    summary: joinRumikSummaries(refundCandidates.map(paymentSummary)),
    data: {
      intent_id: 'refund.status',
      payments: refundCandidates,
      canonical_sla: CANONICAL_SLAS.payment_reconciliation,
    },
  };
}

function executeFdLookup(persona: PersonaSeed, args: Record<string, unknown>): StableToolResult {
  const requestedFd = typeof args.fd_id === 'string' ? args.fd_id : '';
  const matches = requestedFd ? persona.fixed_deposits.filter((item) => fdMatches(item, requestedFd)) : [];
  if (matches.length === 0 && persona.fixed_deposits.length > 1) {
    return {
      ok: false,
      summary: '[neutral] Kaunsi FD check karni hai? FD code, bank, ya amount bata dijiye.',
      data: {
        state: 'clarification_required',
        match_count: persona.fixed_deposits.length,
        fixed_deposits: persona.fixed_deposits.map((fd) => ({
          fd_id: fd.fd_id,
          amount: fd.amount,
          bank: fd.bank,
          status: fd.status,
        })),
      },
    };
  }

  const fd = matches[0] ?? persona.fixed_deposits[0];
  if (!fd) {
    return {
      ok: false,
      summary: '[neutral] Is customer ke liye koi fixed deposit record available nahi hai.',
      data: { state: 'not_found' },
    };
  }

  const intentId = fd.payout_status ? 'maturity.payout.delay' : 'fd.book.status';
  return {
    ok: true,
    summary: fdSummary(fd),
    data: {
      ...fd,
      intent_id: intentId,
      state: fd.status,
      canonical_sla: fd.payout_status ? CANONICAL_SLAS.maturity_payout : CANONICAL_SLAS.fd_booking_processing,
      escalation_action:
        fd.payout_delay_stage === 'T+3 to T+5'
          ? 'create_follow_up_ticket'
          : fd.payout_delay_stage === 'beyond_T+5'
            ? 'priority_escalation'
            : null,
    },
  };
}

function executeFdSummary(persona: PersonaSeed): StableToolResult {
  if (persona.fixed_deposits.length === 0) {
    return {
      ok: true,
      summary: '[neutral] Is customer ke liye koi fixed deposit record available nahi hai.',
      data: { intent_id: 'fd.summary', fixed_deposits: [] },
    };
  }

  return {
    ok: true,
    summary: '[neutral] FD records available hain.',
    data: {
      intent_id: 'fd.summary',
      fixed_deposits: persona.fixed_deposits,
    },
  };
}

function executeAccountOverview(persona: PersonaSeed): StableToolResult {
  return {
    ok: true,
    summary: `[neutral] Aapka account overview yeh hai. KYC ${spokenStatus(persona.kyc_status)} hai. Fixed deposits ${persona.fixed_deposits.length} hain, payments ${persona.payments.length} hain, aur open tickets ${persona.open_tickets.length} hain.`,
    data: {
      intent_id: 'account.overview',
      kyc_status: persona.kyc_status,
      fixed_deposit_count: persona.fixed_deposits.length,
      payment_count: persona.payments.length,
      open_ticket_count: persona.open_tickets.length,
    },
  };
}

function executePrematureWithdrawalQuote(persona: PersonaSeed, args: Record<string, unknown>): StableToolResult {
  const requestedFd = typeof args.fd_id === 'string' ? args.fd_id : '';
  const quoteCandidates = persona.fixed_deposits.filter((fd) => fd.premature_withdrawal_estimate !== null);
  const matches = requestedFd ? quoteCandidates.filter((item) => fdMatches(item, requestedFd)) : [];
  if (matches.length === 0 && quoteCandidates.length > 1) {
    return {
      ok: false,
      summary: '[neutral] Premature withdrawal quote ke liye kaunsi FD check karni hai? FD code, bank, ya amount bata dijiye.',
      data: {
        state: 'clarification_required',
        match_count: quoteCandidates.length,
      },
    };
  }

  const fd = matches[0] ?? quoteCandidates[0];
  if (!fd || fd.premature_withdrawal_estimate === null || fd.premature_withdrawal_penalty === null) {
    return {
      ok: false,
      summary: '[neutral] Is FD ke liye premature withdrawal quote available nahi hai.',
      data: { state: 'not_found' },
    };
  }

  return {
    ok: true,
    summary: `[neutral] ${fd.fd_id} ka premature withdrawal estimate ${formatRumikInr(fd.premature_withdrawal_estimate)} hai. Estimated penalty ${formatRumikInr(fd.premature_withdrawal_penalty)} hai. Yeh sirf quote hai, withdrawal voice par execute nahi hoga.`,
    data: {
      intent_id: 'fd.withdraw.premature',
      fd_id: fd.fd_id,
      bank: fd.bank,
      estimated_value: fd.premature_withdrawal_estimate,
      penalty: fd.premature_withdrawal_penalty,
      payout_window: fd.premature_withdrawal_payout_window,
      voice_execution_allowed: false,
    },
  };
}

function executeSecureLink(persona: PersonaSeed, args: Record<string, unknown>): StableToolResult {
  const action = typeof args.action === 'string' && args.action.trim() ? args.action : 'premature_withdrawal';
  const link = persona.secure_links.find((item) => {
    const sameAction = clean(item.action) === clean(action);
    const sameFd = typeof args.fd_id !== 'string' || item.fd_id === args.fd_id;
    return sameAction && sameFd;
  });
  if (!link) {
    return {
      ok: false,
      summary: '[neutral] Is action ke liye ready secure link available nahi hai.',
      data: { state: 'not_found' },
    };
  }
  return {
    ok: true,
    summary: `[neutral] ${spokenStatus(link.action)} ke liye secure link ready hai${link.fd_id ? `, ${link.fd_id} ke liye` : ''}.`,
    data: {
      ...link,
      voice_execution_allowed: false,
    },
  };
}

function executeKycStatus(persona: PersonaSeed): StableToolResult {
  return {
    ok: true,
    summary: `[neutral] Aapka KYC ${spokenStatus(persona.kyc_status)} hai. ${rumikSafeCopy(
      persona.kyc_next_step || persona.kyc_rejection_reason || persona.kyc_eta || 'Abhi koi action needed nahi hai.',
    )}`,
    data: {
      intent_id: 'kyc.status',
      kyc_status: persona.kyc_status,
      kyc_next_step: persona.kyc_next_step,
      kyc_eta: persona.kyc_eta,
      kyc_rejection_reason: persona.kyc_rejection_reason,
      canonical_sla: persona.kyc_status === 'pending_review' ? CANONICAL_SLAS.kyc_pending_review : null,
    },
  };
}

function executeFdRates(args: Record<string, unknown>): StableToolResult {
  const tenure = typeof args.tenure === 'string' ? clean(args.tenure) : '';
  const issuer = typeof args.issuer === 'string' ? clean(args.issuer) : '';
  const rates = DEMO_FD_RATES.filter((rate) => {
    const tenureMatches = !tenure || clean(rate.tenure) === tenure;
    const issuerMatches = !issuer || clean(rate.issuer).includes(issuer);
    return tenureMatches && issuerMatches;
  });

  return {
    ok: true,
    summary: '[neutral] FD rates available hain. Main rates compare kar sakti hoon, lekin ek specific FD recommend nahi kar sakti.',
    data: {
      intent_id: 'fd.rates.compare',
      state: rates.length > 0 ? 'available' : 'not_found',
      as_of: 'demo_fixture',
      rates,
      can_recommend_one_fd: false,
    },
  };
}

function executeDisclosure(args: Record<string, unknown>): StableToolResult {
  const topic = typeof args.topic === 'string' ? clean(args.topic).replace('-', '_') : '';
  const key =
    topic === 'mf' || topic === 'mutualfund' || topic === 'mutual_funds'
      ? 'mutual_fund'
      : topic === 'fixed_deposit' || topic === 'fixed deposit'
        ? 'fd'
        : topic;
  const copy = DISCLOSURE_COPY[key as keyof typeof DISCLOSURE_COPY];

  if (copy) {
    return {
      ok: true,
      summary: `[neutral] ${rumikSafeCopy(copy)}`,
      data: { topic: key, copy },
    };
  }

  return {
    ok: true,
    summary: `[neutral] ${rumikSafeCopy(Object.values(DISCLOSURE_COPY).join(' '))}`,
    data: { ...DISCLOSURE_COPY },
  };
}

function executeSupportTicket(persona: PersonaSeed, args: Record<string, unknown>): StableToolResult {
  const { issue, priority } = supportTicketArgs(args);
  const existing = persona.open_tickets.find((ticket) => ticket.status === 'open' || ticket.status === 'in_progress');
  const ticketId = existing?.ticket_id ?? 'TKT-DEMO-00001';

  return {
    ok: true,
    summary: `[neutral] Support ticket ${ticketId} prepare ho gaya.`,
    data: {
      ticket_id: ticketId,
      issue,
      priority,
      status: existing?.status ?? 'open',
      sla: CANONICAL_SLAS.grievance_response,
      created: !existing,
    },
  };
}

function executeSupportTicketStatus(persona: PersonaSeed, args: Record<string, unknown>): StableToolResult {
  const ticketId = args.ticket_id;
  const ticket = typeof ticketId === 'string'
    ? persona.open_tickets.find((item) => ticketMatches(item.ticket_id, ticketId))
    : persona.open_tickets.length === 1
      ? persona.open_tickets[0]
      : null;

  if (ticket) {
    return {
      ok: true,
      summary: `[neutral] ${ticket.ticket_id} ${spokenStatus(ticket.status)} hai, issue ${ticket.issue} ke liye. SLA ${ticket.sla} hai.`,
      data: {
        intent_id: 'ticket.status',
        ticket_id: ticket.ticket_id,
        issue: ticket.issue,
        priority: ticket.priority,
        status: ticket.status,
        sla: ticket.sla,
        escalation_reason: ticket.escalation_reason,
        created_at: ticket.created_at,
      },
    };
  }

  if (persona.open_tickets.length > 1) {
    return {
      ok: false,
      summary: `[neutral] Kaunsa ticket check karna hai? Open tickets hain ${persona.open_tickets.map((item) => item.ticket_id).join(', ')}.`,
      data: {
        intent_id: 'ticket.status',
        match_count: persona.open_tickets.length,
        tickets: persona.open_tickets.map((item) => ({
          ticket_id: item.ticket_id,
          issue: item.issue,
          status: item.status,
          sla: item.sla,
        })),
      },
    };
  }

  return {
    ok: false,
    summary: '[neutral] Aap ke liye koi open support ticket nahi mila.',
    data: {
      intent_id: 'ticket.status',
      match_count: 0,
    },
  };
}

function paymentCandidateRecord(payment: PaymentSeed): ToolCandidateRecord {
  return {
    id: payment.payment_reference,
    label: `${payment.payment_reference} ${payment.source_bank} ${payment.amount}`,
    kind: 'payment',
    attributes: {
      payment_reference: payment.payment_reference,
      aliases: payment.aliases,
      source_bank: payment.source_bank,
      amount: payment.amount,
      status: payment.status,
    },
  };
}

function fdCandidateRecord(fd: FixedDepositSeed): ToolCandidateRecord {
  return {
    id: fd.fd_id,
    label: `${fd.fd_id} ${fd.bank} ${fd.amount}`,
    kind: 'fd',
    attributes: {
      fd_id: fd.fd_id,
      bank: fd.bank,
      amount: fd.amount,
      status: fd.status,
      maturity_date: fd.maturity_date,
    },
  };
}

function ticketCandidateRecord(ticket: PersonaSeed['open_tickets'][number]): ToolCandidateRecord {
  return {
    id: ticket.ticket_id,
    label: `${ticket.ticket_id} ${ticket.issue}`,
    kind: 'ticket',
    attributes: {
      ticket_id: ticket.ticket_id,
      issue: ticket.issue,
      status: ticket.status,
      priority: ticket.priority,
    },
  };
}

function clarificationResult(
  summary: string,
  data: Record<string, unknown>,
): StableToolResult {
  return {
    ok: false,
    summary,
    data: {
      state: 'clarification_required',
      ...data,
    },
  };
}

async function maybeResolveToolArgsWithAi(
  persona: PersonaSeed,
  toolName: string,
  args: Record<string, unknown>,
  context: StableToolExecutionContext,
): Promise<{ args: Record<string, unknown>; immediate?: StableToolResult }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim() || (context.fetcher ? 'test-openai-key' : '');
  const transcript = context.transcript?.trim() ?? '';
  const history = context.history ?? [];
  if (!apiKey || !transcript) {
    return { args };
  }

  const directReference =
    toolName === 'get_payment_reconciliation_status' || toolName === 'get_refund_status'
      ? typeof args.reference === 'string' && args.reference.trim()
        ? args.reference.trim()
        : ''
      : toolName === 'get_fd_booking_status' || toolName === 'get_premature_withdrawal_quote'
        ? typeof args.fd_id === 'string' && args.fd_id.trim()
          ? args.fd_id.trim()
          : ''
        : toolName === 'get_support_ticket_status'
          ? typeof args.ticket_id === 'string' && args.ticket_id.trim()
            ? args.ticket_id.trim()
            : ''
          : '';

  let candidates: ToolCandidateRecord[] = [];
  let applyResolvedArgs: (selectedReference: string) => Record<string, unknown> = () => args;
  let clarificationFromCandidates: (question: string) => StableToolResult;

  switch (toolName) {
    case 'get_payment_reconciliation_status':
    case 'get_refund_status':
      candidates = persona.payments.map(paymentCandidateRecord);
      applyResolvedArgs = (selectedReference) => ({ ...args, reference: selectedReference });
      clarificationFromCandidates = (question) =>
        clarificationResult('[neutral] Payment identify karne ke liye thoda aur clear kar dijiye.', {
          intent_id: toolName === 'get_refund_status' ? 'refund.status' : 'payment.failed',
          clarification_question: question,
          payments: persona.payments.map((payment) => ({
            payment_reference: payment.payment_reference,
            amount: payment.amount,
            source_bank: payment.source_bank,
            status: payment.status,
          })),
          match_count: persona.payments.length,
        });
      break;
    case 'get_fd_booking_status':
    case 'get_premature_withdrawal_quote': {
      const fdSource =
        toolName === 'get_premature_withdrawal_quote'
          ? persona.fixed_deposits.filter((fd) => fd.premature_withdrawal_estimate !== null)
          : persona.fixed_deposits;
      candidates = fdSource.map(fdCandidateRecord);
      applyResolvedArgs = (selectedReference) => ({ ...args, fd_id: selectedReference });
      clarificationFromCandidates = (question) =>
        clarificationResult('[neutral] FD identify karne ke liye thoda aur clear kar dijiye.', {
          intent_id: toolName === 'get_premature_withdrawal_quote' ? 'fd.withdraw.premature' : 'fd.book.status',
          clarification_question: question,
          fixed_deposits: fdSource.map((fd) => ({
            fd_id: fd.fd_id,
            amount: fd.amount,
            bank: fd.bank,
            status: fd.status,
          })),
          match_count: fdSource.length,
        });
      break;
    }
    case 'get_support_ticket_status':
      candidates = persona.open_tickets.map(ticketCandidateRecord);
      applyResolvedArgs = (selectedReference) => ({ ...args, ticket_id: selectedReference });
      clarificationFromCandidates = (question) =>
        clarificationResult('[neutral] Ticket identify karne ke liye thoda aur clear kar dijiye.', {
          intent_id: 'ticket.status',
          clarification_question: question,
          tickets: persona.open_tickets.map((ticket) => ({
            ticket_id: ticket.ticket_id,
            issue: ticket.issue,
            status: ticket.status,
            sla: ticket.sla,
          })),
          match_count: persona.open_tickets.length,
        });
      break;
    default:
      return { args };
  }

  if (candidates.length <= 1 && !directReference) {
    return { args };
  }

  const resolved = await resolveToolReferenceWithAi({
    apiKey,
    toolName,
    transcript,
    history,
    candidates,
    fetcher: context.fetcher,
  });

  if (resolved.verdict === 'resolved' && resolved.selectedReference) {
    return { args: applyResolvedArgs(resolved.selectedReference) };
  }

  if (resolved.verdict === 'clarify' && resolved.clarificationQuestion) {
    return { args, immediate: clarificationFromCandidates(resolved.clarificationQuestion) };
  }

  return { args };
}

export function executeStableTool(
  persona: PersonaSeed,
  toolName: string,
  args: Record<string, unknown> = {},
  context?: StableToolExecutionContext,
): StableToolResult {
  if (toolName === 'find_customer_by_mobile_last_4') {
    return verifyReadAccess(persona, args, context);
  }

  if (toolName === 'verify_customer_dob') {
    return dobParseFailedResult();
  }

  switch (canonicalToolName(toolName)) {
    case 'verify_read_access':
      return verifyReadAccess(persona, args, context);

    case 'lookup_customer_profile':
      return {
        ok: true,
        summary: `[neutral] ${persona.name} ka profile mil gaya. Sirf masked ya last four identifiers hi read back karne hain.`,
        data: {
          customer_id: persona.customer_id,
          name: persona.name,
          mobile_last_4: persona.mobile_last_4,
          masked_mobile: `******${persona.mobile_last_4}`,
          kyc_status: persona.kyc_status,
          open_ticket_count: persona.open_tickets.length,
        },
      };

    case 'get_trust_facts':
      return {
        ok: true,
        summary: `[neutral] Stable Money Stable Alpha Technologies Private Limited operate karti hai. FDs RBI regulated partner bank ke saath directly held hain. Eligible deposits DICGC ke under per depositor per bank 5 lakh rupees tak insured hote hain.`,
        data: { ...TRUST_FACTS, intent_id: 'app.real.check' },
      };

    case 'get_canonical_slas':
      return {
        ok: true,
        summary: '[neutral] Approved service timelines load ho gayi hain.',
        data: { ...CANONICAL_SLAS },
      };

    case 'get_disclosure_copy':
      return executeDisclosure(args);

    case 'get_fd_booking_status':
      return executeFdLookup(persona, args);

    case 'get_payment_reconciliation_status':
      return executePaymentLookup(persona, args);

    case 'get_kyc_status':
      return executeKycStatus(persona);

    case 'get_premature_withdrawal_quote':
      return executePrematureWithdrawalQuote(persona, args);

    case 'get_support_ticket_status':
      return executeSupportTicketStatus(persona, args);

    case 'get_payment_summary':
      return executePaymentSummary(persona);

    case 'get_fd_summary':
      return executeFdSummary(persona);

    case 'get_refund_status':
      return executeRefundStatus(persona, args);

    case 'get_account_overview':
      return executeAccountOverview(persona);

    case 'get_fd_rates':
      return executeFdRates(args);

    case 'create_support_ticket':
      return executeSupportTicket(persona, args);

    case 'send_secure_link':
      return executeSecureLink(persona, args);

    case 'get_support_contact':
      return {
        ok: true,
        summary: `[neutral] Human support 10 AM se 7 PM IST, Monday to Saturday available hai. Contact reference stablemoney dot in slash contact us hai. Grievance response timeline ${SUPPORT_CONTACT.grievance_sla} hai.`,
        data: { ...SUPPORT_CONTACT },
      };

    default:
      return { ok: false, summary: `[neutral] Unknown tool ${toolName} hai.` };
  }
}

function requiresVerifiedReadAccess(toolName: string): boolean {
  const canonical = canonicalToolName(toolName);
  if (canonical === 'verify_read_access') return false;
  if (canonical === 'create_support_ticket') return false;

  const authTier = getStableToolAuthTier(canonical);
  return authTier === 'Tier B' || authTier === 'Tier C';
}

export async function executeStableToolWithContext(
  persona: PersonaSeed,
  toolName: string,
  args: Record<string, unknown> = {},
  context: StableToolExecutionContext = {},
): Promise<StableToolResult> {
  const canonical = canonicalToolName(toolName);

  if (requiresVerifiedReadAccess(canonical) && context.callVerified !== true) {
    return {
      ok: false,
      summary: '[neutral] Is account specific tool ke liye pehle read access verification zaroori hai.',
      data: {
        auth_required: true,
        required_tool: 'verify_read_access',
        auth_tier: getStableToolAuthTier(canonical),
      },
    };
  }

  if (canonical === 'create_support_ticket' && context.createSupportTicket) {
    return context.createSupportTicket(supportTicketArgs(args));
  }

  if (canonical === 'send_secure_link' && context.sendSecureLink) {
    const action = typeof args.action === 'string' && args.action.trim() ? args.action.trim() : 'premature_withdrawal';
    const fdId = typeof args.fd_id === 'string' && args.fd_id.trim() ? args.fd_id.trim() : undefined;
    return context.sendSecureLink({ action, ...(fdId ? { fd_id: fdId } : {}) });
  }

  const resolved = await maybeResolveToolArgsWithAi(persona, canonical, args, context);
  if (resolved.immediate) {
    return resolved.immediate;
  }
  const effectiveArgs = resolved.args;

  let result: StableToolResult;
  if (canonical === 'verify_read_access' || canonical === 'find_customer_by_mobile_last_4') {
    result = await verifyReadAccessWithAi(persona, effectiveArgs, context);
  } else if (canonical === 'verify_customer_dob') {
    result = await legacyDobVerification(persona, effectiveArgs);
  } else {
    result = executeStableTool(persona, canonical, effectiveArgs, context);
  }

  if (
    (canonical === 'verify_read_access' || canonical === 'find_customer_by_mobile_last_4') &&
    result.data?.mobile_step_verified === true &&
    typeof context.onReadAccessMobileStepVerified === 'function'
  ) {
    await context.onReadAccessMobileStepVerified(persona.mobile_last_4);
  }

  return result;
}


