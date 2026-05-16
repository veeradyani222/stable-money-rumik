import type { PersonaSeed } from '@/lib/personas';
import {
  executeStableToolWithContext,
  getStableToolAuthTier,
  stableToolDeclarations,
  type StableToolExecutionContext,
} from '@/lib/agent/stable-tools';
import { resolveStableTurnRoute } from '@/lib/agent/intent-classifier';
import {
  buildStableProjectPromptRules,
  getStableIntentPolicy,
  PROJECT_EXACT_LINES,
  type StableIntentRoute,
} from '@/lib/agent/stable-policy';
import fs from 'node:fs';
import path from 'node:path';

export interface AgentHistoryMessage {
  role: 'user' | 'model';
  text: string;
}

export interface BuildOpenAIResponseRequestInput {
  persona: PersonaSeed;
  transcript: string;
  history: AgentHistoryMessage[];
  route?: StableIntentRoute;
  callVerified?: boolean;
  classifyUnknownIntent?: boolean;
  toolContext?: {
    createSupportTicket?: StableToolExecutionContext['createSupportTicket'];
    sendSecureLink?: StableToolExecutionContext['sendSecureLink'];
    verifiedMobileLast4?: string | null;
    pendingRoute?: StableIntentRoute | null;
    onReadAccessMobileStepVerified?: (lastFour: string, pendingRoute?: StableIntentRoute) => void | Promise<void>;
  };
  skipAiDobVerification?: boolean;
  skipAiMobileVerification?: boolean;
}

interface OpenAIInputMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface OpenAIFunctionCallInput {
  type: 'function_call';
  call_id: string;
  name: string;
  arguments: string;
}

interface OpenAIFunctionCallOutputInput {
  type: 'function_call_output';
  call_id: string;
  output: string;
}

type OpenAIInput = OpenAIInputMessage | OpenAIFunctionCallInput | OpenAIFunctionCallOutputInput;

interface OpenAITool {
  type: 'function';
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: 'string'; description: string }>;
    required: string[];
    additionalProperties: false;
  };
}

export interface OpenAIResponseRequest {
  model: string;
  instructions: string;
  input: OpenAIInput[];
  tools?: OpenAITool[];
  max_output_tokens: number;
  reasoning?: {
    effort: 'low';
  };
  text?: { verbosity: 'low' };
  stream?: boolean;
}

interface OpenAIOutputText {
  type: 'output_text';
  text: string;
}

interface OpenAIOutputMessage {
  type: 'message';
  content?: OpenAIOutputText[];
}

interface OpenAIOutputFunctionCall {
  type: 'function_call';
  call_id?: string;
  id?: string;
  name?: string;
  arguments?: string;
}

export interface OpenAIResponse {
  id?: string;
  status?: string;
  incomplete_details?: { reason?: string };
  output?: (OpenAIOutputMessage | OpenAIOutputFunctionCall | Record<string, unknown>)[];
}

export interface AgentTimingEvent {
  event: string;
  elapsedMs: number;
  details?: Record<string, unknown>;
}

type AgentDebugEvent =
  | { type: 'route'; route: StableIntentRoute }
  | { type: 'tool'; tool: string; phase: 'start' | 'result';[k: string]: unknown }
  | { type: 'stream'; event: Record<string, unknown> }
  | { type: 'timing'; timing: AgentTimingEvent };

export class OpenAIRequestError extends Error {
  status: number;
  details: string;

  constructor(status: number, details: string, message?: string) {
    super(message ?? `OpenAI request failed: ${status}`);
    this.name = 'OpenAIRequestError';
    this.status = status;
    this.details = details;
  }
}

const PROJECT_PROMPT_PATH = path.join(process.cwd(), 'PROJECT.md');
const RUMIK_PROMPT_PATH = path.join(process.cwd(), 'RUMIK_PROMPT_GUIDE.md');
export const AGENT_INITIAL_MAX_OUTPUT_TOKENS = 8000;
export const AGENT_RECOVERY_MAX_OUTPUT_TOKENS = 8000;
export const AGENT_EXTENDED_RECOVERY_MAX_OUTPUT_TOKENS = 8000;
export const AGENT_MAX_HISTORY_MESSAGES = 64;

const BLOCKED_ACCOUNT_TOOL_SUMMARY =
  '[neutral] Is account specific tool ke liye pehle read access verification zaroori hai.';

let cachedRumikGuideBlurb: string | null = null;

function getRumikGuideBlurb(): string {
  if (cachedRumikGuideBlurb) return cachedRumikGuideBlurb;
  try {
    const rumikMd = fs.readFileSync(RUMIK_PROMPT_PATH, 'utf8');
    cachedRumikGuideBlurb = rumikMd.split('\n').slice(0, 120).join('\n');
  } catch {
    cachedRumikGuideBlurb = '';
  }
  return cachedRumikGuideBlurb;
}

function toolParameters(parameters: Record<string, unknown>): OpenAITool['parameters'] {
  const properties: Record<string, { type: 'string'; description: string }> = {};
  for (const [key, description] of Object.entries(parameters)) {
    properties[key] = {
      type: 'string',
      description:
        typeof description === 'string'
          ? description
          : String((description as { description?: string }).description ?? ''),
    };
  }

  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

function getAgentModel(): string {
  return process.env.OPENAI_AGENT_MODEL || 'gpt-4o-mini';
}

/**
 * gpt-5 / o1 / o3 / o4 are reasoning models and accept the `reasoning` and
 * `text.verbosity` Responses-API fields. Non-reasoning models reject these
 * with a 400, so we only attach them when the active model supports them.
 */
function isReasoningModel(model: string): boolean {
  const m = model.toLowerCase();
  return m.startsWith('gpt-5') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4');
}

function reasoningFieldsForModel(model: string): { reasoning?: { effort: 'low' }; text?: { verbosity: 'low' } } {
  if (!isReasoningModel(model)) return {};
  return {
    reasoning: { effort: 'low' },
    text: { verbosity: 'low' },
  };
}

function defaultRoute(): StableIntentRoute {
  return { intent: 'unknown', authTier: 'Tier A', tools: [] };
}

function accountToolsForRoute(route: StableIntentRoute): string[] {
  return route.tools.filter((t) => t !== 'verify_read_access');
}

function lastModelText(history: AgentHistoryMessage[]): string {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i]?.role === 'model') return history[i].text;
  }
  return '';
}

function isMobileLastFourFollowUp(transcript: string, history: AgentHistoryMessage[]): boolean {
  if (!/^\d{4}$/.test(transcript.trim())) return false;
  return /last four|last chaar|chaar digits/i.test(lastModelText(history));
}

function isDobVerificationInProgress(toolContext?: BuildOpenAIResponseRequestInput['toolContext']): boolean {
  const gate = toolContext?.verifiedMobileLast4?.trim() ?? '';
  return gate.length === 4;
}

function isSupportTicketIssueAnswer(history: AgentHistoryMessage[]): boolean {
  const modelText = lastModelText(history);
  return /(ticket|support).*(issue|problem|dikkat|pareshani|kya hua|kis baare mein)/i.test(modelText) || /ticket kis issue|which issue.*ticket|what issue.*ticket|issue ke liye create/i.test(modelText);
}

function inferRouteFromLocalContext(input: BuildOpenAIResponseRequestInput): StableIntentRoute {
  const lower = input.transcript.toLowerCase();
  const t = input.transcript.trim();

  if (/\bwhat is kyc\b|\bkyc ka matlab\b/i.test(t)) {
    return { intent: 'kyc.explainer', ...getStableIntentPolicy('kyc.explainer') };
  }
  if (/payment history|payment summary|my payments|mere payments|meri payments|payments|पेमेंट्स|पेमेंट|পেমেন্ট|ادائیگی/i.test(lower)) {
    return { intent: 'payment.summary', ...getStableIntentPolicy('payment.summary') };
  }
  if (/payment status|reconciliation|money debited|payment debit|refund|utr|reconciliation/i.test(lower)) {
    return { intent: 'payment.failed', ...getStableIntentPolicy('payment.failed') };
  }
  if (/kyc/.test(lower) && /status|pending|rejection|review/i.test(lower)) {
    return { intent: 'kyc.status', ...getStableIntentPolicy('kyc.status') };
  }
  if (/(fd|fixed deposit)/i.test(lower) && /status|booking|bana|issue|confirm/i.test(lower)) {
    return { intent: 'fd.book.status', ...getStableIntentPolicy('fd.book.status') };
  }
  return defaultRoute();
}

async function resolveRouteForAgent(input: BuildOpenAIResponseRequestInput): Promise<StableIntentRoute> {
  if (input.route) return input.route;
  if (isSupportTicketIssueAnswer(input.history)) {
    return { intent: 'grievance.escalate', ...getStableIntentPolicy('grievance.escalate') };
  }
  if (input.toolContext?.verifiedMobileLast4 && input.toolContext.pendingRoute) {
    return input.toolContext.pendingRoute;
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (input.classifyUnknownIntent && apiKey) {
    return resolveStableTurnRoute({ apiKey, transcript: input.transcript, history: input.history });
  }
  return inferRouteFromLocalContext(input);
}

function sessionCallVerified(input: BuildOpenAIResponseRequestInput, verifiedRef: { current: boolean }): boolean {
  return input.callVerified === true || verifiedRef.current;
}

/** Declared tools for OpenAI plus execution allow-list (may include redundant verify_read_access). */
function expandAllowedToolNames(route: StableIntentRoute, declaredToolNames: string[], inputCallVerified: boolean): Set<string> {
  const allowed = new Set(declaredToolNames);
  if (route.tools.includes('verify_read_access') && !inputCallVerified) {
    allowed.add('verify_read_access');
  }
  return allowed;
}

function selectToolNamesForRequest(input: {
  route: StableIntentRoute;
  callVerified: boolean;
  toolContext?: BuildOpenAIResponseRequestInput['toolContext'];
  transcript: string;
  history: AgentHistoryMessage[];
}): string[] {
  const { route, callVerified, toolContext, transcript, history } = input;
  const policyTools = [...route.tools];

  if (isSupportTicketIssueAnswer(history)) {
    return ['create_support_ticket'];
  }

  if (route.intent === 'unknown' && route.tools.length === 0) {
    if (toolContext?.verifiedMobileLast4) {
      return ['verify_read_access'];
    }
    return [];
  }

  if (route.authTier === 'Tier A' || route.authTier === 'Tier A/B') {
    if (route.intent !== 'unknown') return policyTools;
  }

  if (route.authTier === 'Tier C') {
    if (callVerified) return policyTools.filter((t) => t !== 'verify_read_access');
    return policyTools.includes('verify_read_access') ? ['verify_read_access'] : policyTools;
  }

  const needsVerify = policyTools.includes('verify_read_access');
  const accounts = accountToolsForRoute(route);

  if (!needsVerify) return policyTools;

  if (callVerified) {
    return policyTools.filter((t) => t !== 'verify_read_access');
  }

  if (toolContext?.verifiedMobileLast4) {
    return ['verify_read_access'];
  }

  if (isMobileLastFourFollowUp(transcript, history) && accounts.length > 0) {
    return ['verify_read_access', ...accounts];
  }

  return ['verify_read_access'];
}

function buildTieredRouteInstructions(input: {
  route: StableIntentRoute;
  callVerified: boolean;
  toolNames: string[];
  toolContext?: BuildOpenAIResponseRequestInput['toolContext'];
  transcript: string;
  history: AgentHistoryMessage[];
}): string[] {
  const { route, callVerified, toolNames, toolContext, transcript, history } = input;
  const lines: string[] = [];

  lines.push(`Current turn route: ${route.intent}, ${route.authTier}`);

  if (toolContext?.verifiedMobileLast4) {
    lines.push('Verification is already in progress.');
    lines.push('Verification is already in progress after mobile_step_verified.');
    lines.push('The verify_read_access tool may set mobile_step_verified in its tool data; respect that gate before asking for date of birth again.');
    lines.push('call verify_read_access again with the same matched mobile last four and the latest date of birth answer.');
    if (isDobVerificationInProgress(toolContext)) {
      lines.push('Treat the latest caller turn as the date of birth answer.');
    }
  }

  if (callVerified) {
    lines.push('Call verification status: verified');
    lines.push('Do not ask for phone number or date of birth again.');
    lines.push('Caller is verified for the selected demo customer.');
    lines.push('For Tier B account-specific turns, use the allowed account tool immediately when it helps the caller.');
    lines.push('Use account tools for all account-specific details instead of guessing.');
  } else {
    lines.push('Every call starts unverified until verify_read_access succeeds for this session.');
  }

  if (route.authTier === 'Tier A') {
    lines.push('This turn can be answered without caller verification.');
    if (route.intent === 'conversation.goodbye') {
      lines.push('Caller is ending the conversation.');
      lines.push('Say a short warm goodbye and do not ask a follow-up question.');
    }
    if (route.intent === 'fd.rates.compare') {
      lines.push('Do not use account tools for this turn unless the caller is already verified for another reason.');
    }
  }

  if (route.authTier === 'Tier B' && !callVerified && !toolContext?.verifiedMobileLast4) {
    lines.push('Current turn is Tier B and caller is not verified.');
    lines.push('Do not use account tools until verify_read_access succeeds for this session.');
    lines.push('Ask only for the registered mobile number last four digits on this turn. The caller may answer in any language or script; accept digits in any language or script and pass the answer verbatim to verify_read_access.');
    lines.push('Do not ask for date of birth in the same reply as the mobile last-four request.');
    lines.push('Ask for date of birth only after the mobile last-four step has matched.');
    lines.push('Never say DOB aloud; say date of birth in full words.');
    lines.push('Apni date of birth batayein in natural conversational Hinglish.');
    lines.push('Never ask for a specific date format, Y words, rigid separators, or digit-heavy templates.');
    lines.push(
      'When the caller answers, always call verify_read_access. Pass the caller\'s verbatim utterance as mobile_last_4 (or as date_of_birth in the DOB phase) if you cannot confidently decode the digits or date yourself. The server will semantically match it against the record.',
    );
    lines.push('Do not silently stall ("ek minute dijiye", "main check karti hoon") instead of calling verify_read_access when the caller has answered the verification prompt.');
    lines.push("Remember the caller's original question and return to it after verification.");
    lines.push('After verification, answer the original request using the allowed account tool.');
  }

  if (route.authTier === 'Tier C' && !callVerified) {
    lines.push('Current turn is Tier C and caller is not verified.');
    lines.push('Do not execute the sensitive action on voice; prepare secure link or ticket only.');
  }

  if (toolNames.length > 0) {
    lines.push(`Allowed tools: ${toolNames.join(', ')}`);
    if (toolNames.includes('verify_read_access') && toolNames.length > 1) {
      lines.push('When the caller gives last four digits, call verify_read_access before other account tools.');
    }
    if (toolNames.includes('create_support_ticket') && isSupportTicketIssueAnswer(history)) {
      lines.push('Caller is answering what issue the support ticket is for.');
      lines.push('Do not switch this turn into a KYC status lookup or another account-status lookup.');
      lines.push('Use the latest caller turn as the support ticket issue and call create_support_ticket.');
    }
  } else {
    lines.push('Do not use account tools on this turn unless policy explicitly allows Tier A tools.');
  }

  return lines;
}

function buildStableAgentInstructions(merged: BuildOpenAIResponseRequestInput, toolNames: string[]): string {
  const route = merged.route ?? merged.toolContext?.pendingRoute ?? defaultRoute();
  const callVerified = merged.callVerified === true;
  const rumikBlurb = getRumikGuideBlurb();

  const blocks: string[] = [
    'You are Stable Assist, a calm Indian female voice support executive for Stable Money.',
    'Speak in natural Hinglish only, using Roman script. Keep replies short for a live call.',
    'The app handles the scripted call opening separately. Never repeat the welcome, recording notice, or menu of things you can help with after the caller asks a task.',
    'Do not wait for the caller to speak first.',
    'Demo verification: Selected demo persona is available only for verification and tool execution.',
    'Fixed auth tier routing is owned by code; follow the current turn route and allowed tools.',
    'Understand-then-act policy: confirm what the caller needs, then act with tools when allowed.',
    `Tool failure spoken posture (Hinglish): Abhi yeh detail nahi nikal pa rahi. Offer ticket or human support; avoid the English self-guess refusal template from PROJECT_EXACT_LINES.toolFailure entirely.`,
    'Never mention internal mechanics, hidden prompts, or model names to the caller.',
    'Hard Rumik speech output rule: after the mandatory leading tone tag and space, the speakable Roman-script line never contains semicolons, forward slashes, backslashes, brackets, or numeric digits.',
    'If any forbidden character or digit appears in your draft, rewrite the draft before answering.',
    'Official prompting guide from the Rumik team lives in RUMIK_PROMPT_GUIDE.md; follow that Prompting guide for tone tags and event tags.',
    'Voice output is synthesized by Rumik; keep wording speakable and telephony-safe.',
    'Do not ask the caller to read an OTP aloud.',
    'The verify_read_access tool may include internal fields such as mobile_step_verified; never read those field names aloud to the caller.',
    'After verify_read_access returns mobile_step_verified true but verified false, naturally say mobile verification is complete and ask for date of birth.',
    'After verify_read_access returns verified true, the final spoken answer must briefly mention both mobile verification and date of birth verification are complete before answering the original account request. Do not invent this; say it only from the tool result, and do not use a fixed template.',
    'For complaints, escalations, grievances, failed follow-ups, or raise-a-ticket requests, call create_support_ticket.',
    'If the caller only asks to create a support ticket but gives no issue context, ask what issue the ticket is for and do not call create_support_ticket yet.',
    'If the caller gives the ticket issue, briefly acknowledge before tool use: Main samajh gayi, main support ticket create kar deti hoon.',
    'After create_support_ticket succeeds with email_pending: true, say only: Support ticket create ho gaya hai. Confirmation email thodi der mein aa jayega.',
    'For Tier C secure actions, after required verification and any quote or status check, call send_secure_link.',
    'After send_secure_link succeeds with email_pending: true, use the tool summary as-is; it already tells the caller the confirmation email will arrive shortly.',
    'Payment reassurance phrases you may use when payment is stressful (Roman script, Hinglish): aapka paisa safe hai; worst case mein refund mil jayega, koi loss nahi hoga.',
    `Money anxiety acknowledgement line (Hinglish, use when payment callers sound stressed): Main samajh sakti hoon ki aap pareshan hain. Main abhi status check karke batati hoon.`,
    `FD rate compare line (English, speak in Hinglish naturally): ${PROJECT_EXACT_LINES.rateCompare}`,
    `FD rate compare Hinglish anchor: Main rates compare karne mein help kar sakti hoon, par main koi ek specific FD recommend nahi kar sakti.`,
    'For task turns, answer directly without restarting the call opening.',
    ...buildTieredRouteInstructions({ route, callVerified, toolNames, toolContext: merged.toolContext, transcript: merged.transcript, history: merged.history }),
    buildStableProjectPromptRules(),
  ];

  if (rumikBlurb.trim()) {
    blocks.push('Rumik prompting reference (truncated):\n' + rumikBlurb);
  }

  try {
    const projectMd = fs.readFileSync(PROJECT_PROMPT_PATH, 'utf8');
    const safeProjectLines = projectMd
      .split('\n')
      .filter((line) => !/cust_demo_|PAY-\d+|FD-\d+|TKT-\d+|Ananya Sharma|Shriram Finance|Namaste, Stable Money support par aapka swagat hai|call quality purposes ke liye record/i.test(line))
      .slice(0, 220);
    blocks.push('Project operating constraints (truncated):\n' + safeProjectLines.join('\n'));
  } catch {
    // optional
  }

  return blocks.join('\n\n');
}

function compactHistoryWithTranscript(history: AgentHistoryMessage[], transcript: string): AgentHistoryMessage[] {
  if (history.length <= 10) {
    return [...history, { role: 'user', text: transcript }];
  }
  const first = history[0];
  if (!first || first.role !== 'user') {
    return [...history.slice(-10), { role: 'user', text: transcript }];
  }
  return [first, ...history.slice(-8), { role: 'user', text: transcript }];
}

function historyToOpenAiInputs(messages: AgentHistoryMessage[]): OpenAIInputMessage[] {
  return messages.map((message) => ({
    role: message.role === 'model' ? 'assistant' : 'user',
    content: message.text,
  }));
}

export function buildOpenAIResponseRequest(input: BuildOpenAIResponseRequestInput): OpenAIResponseRequest {
  const route = input.route ?? input.toolContext?.pendingRoute ?? defaultRoute();
  const toolNames = selectToolNamesForRequest({
    route,
    callVerified: input.callVerified === true,
    toolContext: input.toolContext,
    transcript: input.transcript,
    history: input.history,
  });

  const declarations = stableToolDeclarations
    .filter((tool) => toolNames.includes(tool.name))
    .map((tool) => ({
      type: 'function' as const,
      name: tool.name,
      description: tool.description,
      parameters: toolParameters(tool.parameters as Record<string, unknown>),
    }));

  const messages = compactHistoryWithTranscript(input.history, input.transcript);

  const model = getAgentModel();
  return {
    model,
    instructions: buildStableAgentInstructions(input, toolNames),
    input: historyToOpenAiInputs(messages),
    tools: declarations.length > 0 ? declarations : undefined,
    max_output_tokens: AGENT_INITIAL_MAX_OUTPUT_TOKENS,
    ...reasoningFieldsForModel(model),
  };
}

export function extractOpenAIText(response: OpenAIResponse): string {
  return (
    response.output
      ?.filter((item): item is OpenAIOutputMessage => item.type === 'message')
      .flatMap((item) => item.content ?? [])
      .filter((item) => item.type === 'output_text')
      .map((item) => item.text)
      .join('')
      .trim() || ''
  );
}

function normalizeFunctionCall(raw: OpenAIOutputFunctionCall | undefined): { call_id: string; name: string; arguments: string } | null {
  if (!raw?.name) return null;
  const callId = raw.call_id ?? raw.id;
  if (!callId) return null;
  return { call_id: callId, name: raw.name, arguments: raw.arguments ?? '{}' };
}

function extractFunctionCall(response: OpenAIResponse): { call_id: string; name: string; arguments: string } | null {
  const raw = response.output?.find((item): item is OpenAIOutputFunctionCall => item.type === 'function_call');
  return normalizeFunctionCall(raw);
}

function parseToolArguments(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const PAYMENT_REASSURANCE_PREFIX =
  '[neutral] Main samajh sakti hoon ki aap pareshan hain. Main abhi status check karke batati hoon. ';

function stripLeadingToneTag(text: string): string {
  return text.replace(/^\[[a-z]+\]\s*/i, '').trim();
}

function clipPaymentSummaryForVoice(summary: string): string {
  const marker = 'reconciliation mein hai';
  const idx = summary.indexOf(marker);
  if (idx === -1) return summary.trim();
  return summary.slice(0, idx + marker.length).trim();
}

function formatPaymentToolSummary(summary: string, options: { reassurance: boolean }): string {
  const clipped = clipPaymentSummaryForVoice(summary);
  if (!options.reassurance) {
    return clipped;
  }
  const body = stripLeadingToneTag(clipped);
  return `${PAYMENT_REASSURANCE_PREFIX}${body} aapka paisa safe hai aur worst case mein refund mil jayega, koi loss nahi hoga.`;
}

function isPaymentReconciliationTool(name: string): boolean {
  return name === 'get_payment_reconciliation_status';
}

/**
 * Route the caller's verbatim utterance into the right verify_read_access slot
 * based purely on the server-held verification gate:
 *   - gate not set  -> mobile phase: put the caller utterance into
 *     mobile_last_4 and clear date_of_birth.
 *   - gate set      -> DOB phase: hardwire mobile_last_4 to the gate and put
 *     the caller utterance into date_of_birth.
 *
 * The server-side AI matchers decide whether the slot content matches the
 * record (multilingual, multi-script, "double X", "ek do teen", "ون ون ٹو
 * تھری", etc.). We deliberately avoid any in-process digit or language
 * parsing.
 */
function normalizeVerifyReadAccessArgs(
  input: BuildOpenAIResponseRequestInput,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...raw };
  const transcript = input.transcript.trim();
  const mobileArg = typeof next.mobile_last_4 === 'string' ? next.mobile_last_4.trim() : '';
  const dobArg = typeof next.date_of_birth === 'string' ? next.date_of_birth.trim() : '';
  const verifiedMobile = input.toolContext?.verifiedMobileLast4?.trim() ?? '';
  const dobPhase = verifiedMobile.length === 4;

  if (dobPhase) {
    next.mobile_last_4 = verifiedMobile;
    if (!dobArg && transcript && transcript !== verifiedMobile) {
      next.date_of_birth = transcript;
    }
    return next;
  }

  const mobileIsCleanFourDigit = /^\d{4}$/.test(mobileArg);
  if (!mobileIsCleanFourDigit && transcript) {
    next.mobile_last_4 = transcript;
  }
  next.date_of_birth = '';
  return next;
}

function normalizeHinglishDobAsk(text: string): string {
  return text
    .replace(/Kripya date of birth batayein/gi, 'Apni date of birth batayein')
    .replace(/Kripya date of birth/gi, 'Apni date of birth');
}

async function createOpenAIResponse(apiKey: string, requestBody: OpenAIResponseRequest): Promise<OpenAIResponse> {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new OpenAIRequestError(response.status, details);
  }

  return (await response.json()) as OpenAIResponse;
}

async function createOpenAIResponseStream(apiKey: string, requestBody: OpenAIResponseRequest): Promise<ReadableStream<Uint8Array>> {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...requestBody, stream: true }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new OpenAIRequestError(response.status, details);
  }

  if (!response.body) {
    throw new OpenAIRequestError(response.status, 'Streaming response was missing a body');
  }

  return response.body;
}

function parseSseDataLines(block: string): Record<string, unknown> | null {
  const dataLines = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart());
  const data = dataLines.join('\n').trim();
  if (!data || data === '[DONE]') return null;
  try {
    return JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
}

interface StreamState {
  textDeltas: string[];
  incompleteFromStream: boolean;
  serverError: boolean;
  activeFunction?: {
    callId: string;
    name: string;
    arguments: string;
  };
}

function stripSensitiveFunctionArguments(event: Record<string, unknown>): Record<string, unknown> {
  const item = event.item;
  if (!item || typeof item !== 'object' || Array.isArray(item)) return event;
  const args = (item as { arguments?: unknown }).arguments;
  if (typeof args !== 'string' || !args.includes('date_of_birth')) return event;

  try {
    const parsed = JSON.parse(args) as Record<string, unknown>;
    delete parsed.date_of_birth;
    return {
      ...event,
      item: {
        ...item,
        arguments: JSON.stringify(parsed),
      },
    };
  } catch {
    return {
      ...event,
      item: {
        ...item,
        arguments: args.replace(/"date_of_birth"\s*:\s*"[^"]*"\s*,?/g, ''),
      },
    };
  }
}

function applyStreamEvent(state: StreamState, event: Record<string, unknown>, onDelta?: (delta: string) => void, onDebug?: (event: AgentDebugEvent) => void): void {
  onDebug?.({ type: 'stream', event: stripSensitiveFunctionArguments(event) });
  const type = typeof event.type === 'string' ? event.type : '';

  if (type === 'error') {
    const err = event.error as { type?: string } | undefined;
    if (err?.type === 'server_error') {
      state.serverError = true;
      return;
    }
    throw new OpenAIRequestError(500, JSON.stringify(event.error ?? event), 'OpenAI stream failed');
  }

  if (type === 'response.output_text.delta' && typeof event.delta === 'string') {
    state.textDeltas.push(event.delta);
    onDelta?.(event.delta);
    return;
  }

  if (type === 'response.completed' || type === 'response.incomplete') {
    const response = event.response as { status?: string; incomplete_details?: { reason?: string } } | undefined;
    if (response?.status === 'incomplete' && response.incomplete_details?.reason === 'max_output_tokens') {
      state.incompleteFromStream = true;
    }
    return;
  }

  if (type === 'response.output_item.added') {
    const item = event.item as { type?: string; call_id?: string; id?: string; name?: string; arguments?: string } | undefined;
    if (item?.type === 'function_call' && item.name) {
      const callId = item.call_id ?? item.id ?? '';
      state.activeFunction = { callId, name: item.name, arguments: typeof item.arguments === 'string' ? item.arguments : '' };
    }
    return;
  }

  if (type === 'response.function_call_arguments.delta' && typeof event.delta === 'string') {
    if (!state.activeFunction) return;
    state.activeFunction.arguments += event.delta;
    return;
  }

  if (type === 'response.function_call_arguments.done') {
    const item = event.item as { type?: string; call_id?: string; id?: string; name?: string; arguments?: string } | undefined;
    if (item?.type === 'function_call' && item.name) {
      const callId = item.call_id ?? item.id ?? state.activeFunction?.callId ?? '';
      state.activeFunction = {
        callId,
        name: item.name,
        arguments: typeof item.arguments === 'string' ? item.arguments : state.activeFunction?.arguments ?? '',
      };
    }
    return;
  }

  if (type === 'response.output_item.done') {
    const item = event.item as { type?: string; call_id?: string; id?: string; name?: string; arguments?: string } | undefined;
    if (item?.type === 'function_call' && item.name) {
      const callId = item.call_id ?? item.id ?? state.activeFunction?.callId ?? '';
      state.activeFunction = {
        callId,
        name: item.name,
        arguments: typeof item.arguments === 'string' ? item.arguments : state.activeFunction?.arguments ?? '',
      };
    }
  }
}

async function readSseStream(stream: ReadableStream<Uint8Array>, onEvent: (event: Record<string, unknown>) => void): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = '';

  while (true) {
    const { value, done } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    const blocks = pending.split(/\r?\n\r?\n/);
    pending = blocks.pop() ?? '';

    for (const block of blocks) {
      const parsed = parseSseDataLines(block);
      if (parsed && typeof parsed === 'object') onEvent(parsed as Record<string, unknown>);
    }

    if (done) break;
  }

  if (pending.trim()) {
    const parsed = parseSseDataLines(pending);
    if (parsed && typeof parsed === 'object') onEvent(parsed as Record<string, unknown>);
  }
}

function declarationsForToolNames(toolNames: string[]): OpenAITool[] {
  return stableToolDeclarations
    .filter((tool) => toolNames.includes(tool.name))
    .map((tool) => ({
      type: 'function' as const,
      name: tool.name,
      description: tool.description,
      parameters: toolParameters(tool.parameters as Record<string, unknown>),
    }));
}

function buildExecutionContext(
  input: BuildOpenAIResponseRequestInput,
  verifiedRef: { current: boolean },
): StableToolExecutionContext {
  return {
    callVerified: input.callVerified === true || verifiedRef.current,
    verifiedMobileLast4: input.toolContext?.verifiedMobileLast4 ?? undefined,
    onReadAccessMobileStepVerified: input.toolContext?.onReadAccessMobileStepVerified
      ? (lastFour) => input.toolContext?.onReadAccessMobileStepVerified?.(lastFour, input.route)
      : undefined,
    createSupportTicket: input.toolContext?.createSupportTicket,
    sendSecureLink: input.toolContext?.sendSecureLink,
    skipAiDobVerification: input.skipAiDobVerification === true || process.env.STABLE_DISABLE_AI_DOB === '1',
    skipAiMobileVerification:
      input.skipAiMobileVerification === true || process.env.STABLE_DISABLE_AI_MOBILE === '1',
  };
}

function authTierForToolLog(route: StableIntentRoute, toolName: string): string {
  const fromDecl = getStableToolAuthTier(toolName);
  if (fromDecl) return fromDecl;
  return route.authTier;
}

export async function runStableAgent(
  input: BuildOpenAIResponseRequestInput,
): Promise<{ text: string; toolCalls: string[]; verified?: boolean }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing required environment variable: OPENAI_API_KEY');
  }

  const route = await resolveRouteForAgent(input);
  const verifiedRef = { current: input.callVerified === true };
  const toolCalls: string[] = [];

  const mergedBase: BuildOpenAIResponseRequestInput = { ...input, route };
  let messages: OpenAIInput[] = buildOpenAIResponseRequest({ ...mergedBase, callVerified: verifiedRef.current }).input;

  let consecutiveEmpty = 0;
  let consecutiveVerifyToolCalls = 0;
  let maxOut = AGENT_INITIAL_MAX_OUTPUT_TOKENS;
  let stripToolsAfterEmpty3 = false;
  let longHistoryRecovery = (input.history?.length ?? 0) >= 8;

  for (let round = 0; round < 24; round += 1) {
    const merged: BuildOpenAIResponseRequestInput = { ...mergedBase, callVerified: verifiedRef.current };
    const toolNames = selectToolNamesForRequest({
      route,
      callVerified: sessionCallVerified(input, verifiedRef),
      toolContext: input.toolContext,
      transcript: input.transcript,
      history: input.history,
    });

    const forceNoTools = consecutiveVerifyToolCalls >= 2;
    const decls = declarationsForToolNames(toolNames);
    let toolsField: OpenAITool[] | undefined;
    if (forceNoTools || stripToolsAfterEmpty3) {
      toolsField = [];
    } else if (decls.length > 0) {
      toolsField = decls;
    } else {
      toolsField = undefined;
    }

    const runOnceModel = getAgentModel();
    const request: OpenAIResponseRequest = {
      model: runOnceModel,
      instructions: buildStableAgentInstructions(merged, toolNames),
      input: messages,
      tools: toolsField,
      max_output_tokens: maxOut,
      ...reasoningFieldsForModel(runOnceModel),
    };

    const json = await createOpenAIResponse(apiKey, request);
    const incomplete = json.status === 'incomplete' && json.incomplete_details?.reason === 'max_output_tokens';

    if (incomplete) {
      if (maxOut === AGENT_INITIAL_MAX_OUTPUT_TOKENS) maxOut = AGENT_RECOVERY_MAX_OUTPUT_TOKENS;
      else if (maxOut === AGENT_RECOVERY_MAX_OUTPUT_TOKENS) maxOut = AGENT_EXTENDED_RECOVERY_MAX_OUTPUT_TOKENS;
      consecutiveEmpty = 0;
      continue;
    }

    const fc = extractFunctionCall(json);
    const text = extractOpenAIText(json);

    if (!fc && text) {
      consecutiveEmpty = 0;
      return { text, toolCalls: [...toolCalls], verified: verifiedRef.current };
    }

    if (!fc && !text) {
      if (stripToolsAfterEmpty3) {
        return {
          text: '[neutral] Maaf kijiye, mujhe response banane mein issue aa raha hai. Main dobara try karti hoon.',
          toolCalls: [...toolCalls],
          verified: verifiedRef.current,
        };
      }

      consecutiveEmpty += 1;
      if (consecutiveEmpty >= 3) {
        if (longHistoryRecovery) {
          if (maxOut === AGENT_INITIAL_MAX_OUTPUT_TOKENS) maxOut = AGENT_RECOVERY_MAX_OUTPUT_TOKENS;
          else if (maxOut === AGENT_RECOVERY_MAX_OUTPUT_TOKENS) maxOut = AGENT_EXTENDED_RECOVERY_MAX_OUTPUT_TOKENS;
        } else {
          stripToolsAfterEmpty3 = true;
        }
      }

      continue;
    }

    if (!fc?.name) {
      continue;
    }

    consecutiveEmpty = 0;

    const allowed = expandAllowedToolNames(route, toolNames, input.callVerified === true);

    if (allowed.size === 0 || !allowed.has(fc.name)) {
      if (fc.name === 'verify_read_access' && verifiedRef.current && forceNoTools) {
        const textOnly = extractOpenAIText(json);
        if (textOnly) {
          return { text: textOnly, toolCalls: [...toolCalls], verified: verifiedRef.current };
        }
        continue;
      }
      toolCalls.push(fc.name);
      return { text: BLOCKED_ACCOUNT_TOOL_SUMMARY, toolCalls: [...toolCalls], verified: verifiedRef.current };
    }

    const rawArgs = parseToolArguments(fc.arguments);
    const mergedArgs = fc.name === 'verify_read_access' ? normalizeVerifyReadAccessArgs(input, rawArgs) : rawArgs;

    const execCtx = buildExecutionContext(mergedBase, verifiedRef);
    const toolResult = await executeStableToolWithContext(input.persona, fc.name, mergedArgs, execCtx);

    toolCalls.push(fc.name);

    if (fc.name === 'verify_read_access') {
      if (toolResult.data?.verified === true || (toolResult.ok && process.env.STABLE_DISABLE_AI_DOB === '1')) {
        verifiedRef.current = true;
      }
      if (toolResult.ok) {
        consecutiveVerifyToolCalls += 1;
        if (consecutiveVerifyToolCalls >= 2) {
          verifiedRef.current = true;
        }
      } else {
        consecutiveVerifyToolCalls = 0;
      }
    } else {
      consecutiveVerifyToolCalls = 0;
    }

    messages = [
      ...messages,
      { type: 'function_call', call_id: fc.call_id, name: fc.name, arguments: fc.arguments ?? '{}' },
      { type: 'function_call_output', call_id: fc.call_id, output: JSON.stringify(toolResult) },
    ];

    const skipFinalOpenAi =
      fc.name !== 'verify_read_access' &&
      toolResult.ok &&
      !forceNoTools &&
      fc.name !== 'send_secure_link';

    if (skipFinalOpenAi) {
      let spoken = toolResult.summary;
      if (isPaymentReconciliationTool(fc.name)) {
        const hadPriorVerifyInRun = toolCalls.includes('verify_read_access');
        spoken = formatPaymentToolSummary(toolResult.summary, {
          reassurance: input.callVerified === true || !hadPriorVerifyInRun,
        });
      }
      return { text: spoken, toolCalls: [...toolCalls], verified: verifiedRef.current };
    }
  }

  return {
    text: '[neutral] Maaf kijiye, mujhe response banane mein issue aa raha hai. Main dobara try karti hoon.',
    toolCalls: [...toolCalls],
    verified: verifiedRef.current,
  };
}

export async function streamStableAgentText(
  input: BuildOpenAIResponseRequestInput,
  onDelta: (delta: string) => void,
  onDebug?: (event: AgentDebugEvent) => void,
): Promise<{ text: string; toolCalls: string[]; verified?: boolean }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing required environment variable: OPENAI_API_KEY');
  }

  const agentStartedAt = Date.now();
  const emitTiming = (event: string, details?: Record<string, unknown>) => {
    onDebug?.({
      type: 'timing',
      timing: {
        event,
        elapsedMs: Date.now() - agentStartedAt,
        ...(details ? { details } : {}),
      },
    });
  };

  emitTiming('agent_start', {
    transcriptChars: input.transcript.length,
    historyMessages: input.history.length,
    callVerified: input.callVerified === true,
  });

  try {
    const route = await resolveRouteForAgent(input);
    emitTiming('route_resolved', { intent: route.intent, authTier: route.authTier });
    onDebug?.({ type: 'route', route });

    const verifiedRef = { current: input.callVerified === true };
    const toolCalls: string[] = [];
    const mergedBase: BuildOpenAIResponseRequestInput = { ...input, route };

    let messages: OpenAIInput[] = buildOpenAIResponseRequest({ ...mergedBase, callVerified: verifiedRef.current }).input;

    let streamPasses = 0;
    const runOneStream = async (onDelta?: (delta: string) => void, onDebug?: (event: AgentDebugEvent) => void): Promise<{
      textDeltas: string[];
      incomplete: boolean;
      serverError: boolean;
      streamedFunction?: { call_id: string; name: string; arguments: string };
    }> => {
      const merged: BuildOpenAIResponseRequestInput = { ...mergedBase, callVerified: verifiedRef.current };
      const toolNames = selectToolNamesForRequest({
        route,
        callVerified: sessionCallVerified(input, verifiedRef),
        toolContext: input.toolContext,
        transcript: input.transcript,
        history: input.history,
      });
      const toolsPayload = declarationsForToolNames(toolNames);
      const streamModel = getAgentModel();
      const request: OpenAIResponseRequest = {
        model: streamModel,
        instructions: buildStableAgentInstructions(merged, toolNames),
        input: messages,
        tools: toolsPayload.length > 0 ? toolsPayload : undefined,
        max_output_tokens: AGENT_INITIAL_MAX_OUTPUT_TOKENS,
        ...reasoningFieldsForModel(streamModel),
        stream: true,
      };

      const pass = streamPasses + 1;
      streamPasses = pass;
      emitTiming('openai_stream_request_start', {
        pass,
        model: request.model,
        tools: toolsPayload.map((tool) => tool.name),
        inputMessages: messages.length,
      });
      const stream = await createOpenAIResponseStream(apiKey, request);
      emitTiming('openai_stream_response_ready', { pass });
      onDebug?.({ type: 'stream', event: { type: 'start' } });
      const state: StreamState = { textDeltas: [], incompleteFromStream: false, serverError: false };
      let sawFirstEvent = false;
      await readSseStream(stream, (ev) => {
        if (!sawFirstEvent) {
          sawFirstEvent = true;
          emitTiming('openai_stream_first_event', {
            pass,
            eventType: typeof ev.type === 'string' ? ev.type : 'unknown',
          });
        }
        applyStreamEvent(state, ev, onDelta, onDebug);
      });
      emitTiming('openai_stream_end', {
        pass,
        textDeltas: state.textDeltas.length,
        incomplete: state.incompleteFromStream,
        serverError: state.serverError,
        streamedFunction: state.activeFunction?.name,
      });
      onDebug?.({ type: 'stream', event: { type: 'end', textDeltas: state.textDeltas.length } });

      if (state.serverError) {
        return { textDeltas: [], incomplete: false, serverError: true };
      }

      if (state.activeFunction?.name) {
        const norm = normalizeFunctionCall({
          type: 'function_call',
          name: state.activeFunction.name,
          arguments: state.activeFunction.arguments,
          call_id: state.activeFunction.callId || `streamed_${state.activeFunction.name}`,
        });
        if (norm) {
          return {
            textDeltas: [],
            incomplete: state.incompleteFromStream,
            serverError: false,
            streamedFunction: norm,
          };
        }
      }

      return {
        textDeltas: state.textDeltas,
        incomplete: state.incompleteFromStream,
        serverError: false,
      };
    };

    const pass1 = await runOneStream(undefined, onDebug);

    const recoverTextWithoutStreaming = async (maxOutputTokens: number): Promise<string> => {
      const merged: BuildOpenAIResponseRequestInput = { ...mergedBase, callVerified: verifiedRef.current };
      const toolNames = selectToolNamesForRequest({
        route,
        callVerified: sessionCallVerified(input, verifiedRef),
        toolContext: input.toolContext,
        transcript: input.transcript,
        history: input.history,
      });
      const toolsPayload = declarationsForToolNames(toolNames);
      const recoveryModel = getAgentModel();
      emitTiming('openai_recovery_request_start', { maxOutputTokens });
      const json = await createOpenAIResponse(apiKey, {
        model: recoveryModel,
        instructions: buildStableAgentInstructions(merged, toolNames),
        input: messages,
        tools: toolsPayload.length > 0 ? toolsPayload : undefined,
        max_output_tokens: maxOutputTokens,
        ...reasoningFieldsForModel(recoveryModel),
      });
      emitTiming('openai_recovery_response_ready', {
        maxOutputTokens,
        status: json.status,
        outputItems: json.output?.length ?? 0,
      });
      return normalizeHinglishDobAsk(extractOpenAIText(json));
    };

    if (pass1.serverError) {
      const t = await recoverTextWithoutStreaming(AGENT_INITIAL_MAX_OUTPUT_TOKENS);
      return { text: t, toolCalls: [], verified: verifiedRef.current };
    }

    if (pass1.streamedFunction) {
      const fc = pass1.streamedFunction;
      const rawArgs = parseToolArguments(fc.arguments);
      const mergedArgs = fc.name === 'verify_read_access' ? normalizeVerifyReadAccessArgs(input, rawArgs) : rawArgs;
      const debugArgs = { ...mergedArgs } as Record<string, unknown>;
      if (!debugArgs.date_of_birth || String(debugArgs.date_of_birth).trim() === '') {
        delete debugArgs.date_of_birth;
      }

      onDebug?.({
        type: 'tool',
        tool: fc.name,
        phase: 'start',
        arguments: debugArgs,
        verified: verifiedRef.current,
      } as { type: 'tool'; tool: string; phase: 'start';[k: string]: unknown });

      const execCtx = buildExecutionContext(mergedBase, verifiedRef);
      emitTiming('tool_execution_start', { tool: fc.name });
      const toolResult = await executeStableToolWithContext(input.persona, fc.name, mergedArgs, execCtx);
      emitTiming('tool_execution_end', { tool: fc.name, ok: toolResult.ok });

      onDebug?.({
        type: 'tool',
        tool: fc.name,
        phase: 'result',
        ok: toolResult.ok,
        verified: toolResult.data?.verified === true,
      } as { type: 'tool'; tool: string; phase: 'result';[k: string]: unknown });

      const hadPriorVerifyInRun = toolCalls.includes('verify_read_access');
      toolCalls.push(fc.name);

      const allowed = expandAllowedToolNames(
        route,
        selectToolNamesForRequest({
          route,
          callVerified: sessionCallVerified(input, verifiedRef),
          toolContext: input.toolContext,
          transcript: input.transcript,
          history: input.history,
        }),
        input.callVerified === true,
      );

      if (!allowed.has(fc.name)) {
        onDelta(BLOCKED_ACCOUNT_TOOL_SUMMARY);
        return { text: BLOCKED_ACCOUNT_TOOL_SUMMARY, toolCalls: [...toolCalls], verified: verifiedRef.current };
      }

      if (fc.name === 'verify_read_access') {
        const verificationSucceeded = toolResult.data?.verified === true;
        if (toolResult.data?.verified === true || (toolResult.ok && process.env.STABLE_DISABLE_AI_DOB === '1')) {
          verifiedRef.current = true;
        }
        if (verificationSucceeded && route.tools.some((tool) => tool !== 'verify_read_access')) {
          messages = [
            ...messages,
            { type: 'function_call', call_id: fc.call_id, name: fc.name, arguments: fc.arguments ?? '{}' },
            { type: 'function_call_output', call_id: fc.call_id, output: JSON.stringify(toolResult) },
          ];

          const nextPass = await runOneStream(undefined, onDebug);
          if (nextPass.serverError) {
            const recovered = await recoverTextWithoutStreaming(AGENT_INITIAL_MAX_OUTPUT_TOKENS);
            onDelta(recovered);
            return { text: recovered, toolCalls: [...toolCalls], verified: verifiedRef.current };
          }

          if (nextPass.streamedFunction) {
            const nextFc = nextPass.streamedFunction;
            const nextRawArgs = parseToolArguments(nextFc.arguments);
            const nextDebugArgs = { ...nextRawArgs } as Record<string, unknown>;
            onDebug?.({
              type: 'tool',
              tool: nextFc.name,
              phase: 'start',
              arguments: nextDebugArgs,
              verified: verifiedRef.current,
            } as { type: 'tool'; tool: string; phase: 'start';[k: string]: unknown });

            const nextAllowed = expandAllowedToolNames(
              route,
              selectToolNamesForRequest({
                route,
                callVerified: sessionCallVerified(input, verifiedRef),
                toolContext: input.toolContext,
                transcript: input.transcript,
                history: input.history,
              }),
              input.callVerified === true,
            );

            if (!nextAllowed.has(nextFc.name)) {
              onDelta(BLOCKED_ACCOUNT_TOOL_SUMMARY);
              return { text: BLOCKED_ACCOUNT_TOOL_SUMMARY, toolCalls: [...toolCalls], verified: verifiedRef.current };
            }

            emitTiming('tool_execution_start', { tool: nextFc.name });
            const nextToolResult = await executeStableToolWithContext(
              input.persona,
              nextFc.name,
              nextFc.name === 'verify_read_access' ? normalizeVerifyReadAccessArgs(input, nextRawArgs) : nextRawArgs,
              buildExecutionContext(mergedBase, verifiedRef),
            );
            emitTiming('tool_execution_end', { tool: nextFc.name, ok: nextToolResult.ok });

            onDebug?.({
              type: 'tool',
              tool: nextFc.name,
              phase: 'result',
              ok: nextToolResult.ok,
              verified: nextToolResult.data?.verified === true,
            } as { type: 'tool'; tool: string; phase: 'result';[k: string]: unknown });

            toolCalls.push(nextFc.name);
            let nextSpoken = nextToolResult.summary;
            if (nextToolResult.ok && isPaymentReconciliationTool(nextFc.name)) {
              nextSpoken = formatPaymentToolSummary(nextToolResult.summary, { reassurance: false });
            }
            nextSpoken = normalizeHinglishDobAsk(nextSpoken);
            onDelta(nextSpoken);
            return { text: nextSpoken, toolCalls: [...toolCalls], verified: verifiedRef.current };
          }

          if (nextPass.incomplete) {
            const recovered = await recoverTextWithoutStreaming(AGENT_RECOVERY_MAX_OUTPUT_TOKENS);
            onDelta(recovered);
            return { text: recovered, toolCalls: [...toolCalls], verified: verifiedRef.current };
          }

          const nextText = normalizeHinglishDobAsk(nextPass.textDeltas.join('').trim());
          if (nextText) {
            nextPass.textDeltas.forEach(onDelta);
            return { text: nextText, toolCalls: [...toolCalls], verified: verifiedRef.current };
          }

          const recovered = await recoverTextWithoutStreaming(AGENT_RECOVERY_MAX_OUTPUT_TOKENS);
          onDelta(recovered);
          return { text: recovered, toolCalls: [...toolCalls], verified: verifiedRef.current };
        }
        let spoken = normalizeHinglishDobAsk(toolResult.summary);
        if (
          toolResult.data?.verified === true &&
          /Date of birth match ho gaya/i.test(spoken) &&
          /Verification complete hai/i.test(spoken)
        ) {
          spoken = '[neutral] Verification complete ho gaya.';
        }
        onDelta(spoken);
        return { text: spoken, toolCalls: [...toolCalls], verified: verifiedRef.current };
      }

      if (toolResult.ok) {
        let spoken = toolResult.summary;
        if (isPaymentReconciliationTool(fc.name)) {
          spoken = formatPaymentToolSummary(toolResult.summary, {
            reassurance: input.callVerified === true || !hadPriorVerifyInRun,
          });
        }
        spoken = normalizeHinglishDobAsk(spoken);
        onDelta(spoken);
        return { text: spoken, toolCalls: [...toolCalls], verified: verifiedRef.current };
      }

      const spoken = normalizeHinglishDobAsk(toolResult.summary);
      onDelta(spoken);
      return { text: spoken, toolCalls: [...toolCalls], verified: verifiedRef.current };
    }

    if (pass1.incomplete && !pass1.streamedFunction) {
      const recovered = await recoverTextWithoutStreaming(AGENT_RECOVERY_MAX_OUTPUT_TOKENS);
      onDelta(recovered);
      return { text: recovered, toolCalls: [], verified: verifiedRef.current };
    }

    const firstText = normalizeHinglishDobAsk(pass1.textDeltas.join('').trim());
    if (!firstText) {
      const recovered = await recoverTextWithoutStreaming(AGENT_RECOVERY_MAX_OUTPUT_TOKENS);
      if (recovered) {
        onDelta(recovered);
        return { text: recovered, toolCalls: [], verified: verifiedRef.current };
      }
    }
    pass1.textDeltas.forEach(onDelta);
    return { text: firstText, toolCalls: [], verified: verifiedRef.current };
  } finally {
    emitTiming('agent_finish');
  }
}
