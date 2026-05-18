import {
  getStableIntentPolicy,
  routeStableTurn,
  traceStableTurnRoute,
  STABLE_INTENT_POLICIES,
  type StableAuthTier,
  type StableIntentId,
  type StableIntentRoute,
  type StableTurnHistoryMessage,
} from './stable-policy';

type Fetcher = typeof fetch;

interface OpenAIClassifierResponse {
  output_text?: string;
  output_parsed?: unknown;
  status?: string;
  incomplete_details?: unknown;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string; parsed?: unknown; refusal?: string }>;
    text?: string;
    parsed?: unknown;
  } | string>;
  text?: string;
  [key: string]: unknown;
}

interface ModelClassification {
  intent?: unknown;
  auth_tier?: unknown;
  confidence?: unknown;
  reason?: unknown;
}

export interface IntentClassificationResult {
  accepted: boolean;
  route: StableIntentRoute;
  confidence: number;
  reason: string;
  modelAuthTier: StableAuthTier | 'unknown';
}

export interface IntentClassifierInput {
  apiKey: string;
  transcript: string;
  history: StableTurnHistoryMessage[];
  fetcher?: Fetcher;
}

const CLASSIFIER_CACHE_LIMIT = 250;
const CLASSIFIER_MAX_OUTPUT_TOKENS = 8000;
const CLASSIFIER_RETRY_MAX_OUTPUT_TOKENS = 8000;
const MAX_CLASSIFIER_INVALID_OUTPUT_ATTEMPTS = 2;
const CLASSIFIER_HISTORY_LIMIT = 4;
const INTENT_IDS: StableIntentId[] = [
  'payment.failed',
  'fd.book.status',
  'fd.withdraw.premature',
  'kyc.status',
  'kyc.explainer',
  'fd.rates.compare',
  'maturity.payout.delay',
  'app.real.check',
  'ticket.status',
  'grievance.escalate',
  'support.contact',
  'payment.summary',
  'fd.summary',
  'account.overview',
  'refund.status',
  'secure.action.help',
  'conversation.goodbye',
  'unknown',
];

const AUTH_TIERS: Array<StableAuthTier | 'unknown'> = ['Tier A', 'Tier B', 'Tier C', 'Tier A/B', 'unknown'];
const classificationCache = new Map<string, StableIntentRoute>();

const INTENT_CLASSIFICATION_GUIDE: Record<StableIntentId, string> = {
  'payment.failed': 'Payment failed, money debited, FD not booked, amount stuck, refund, or reconciliation.',
  'fd.book.status': 'FD booking, booking confirmation, or whether an FD has been created.',
  'fd.withdraw.premature': 'Caller wants to break, close, or withdraw an FD before maturity.',
  'kyc.status': 'Caller asks about their own KYC status, review, approval, rejection, or next step.',
  'kyc.explainer': 'General explanation of what KYC means, not account-specific status.',
  'fd.rates.compare': 'Compare FD rates, interest rates, tenure, or issuer options.',
  'maturity.payout.delay': 'Matured FD payout delay or maturity amount not received.',
  'app.real.check': 'Trust, legitimacy, DICGC, partner bank, or whether Stable Money is real/safe.',
  'ticket.status': 'Status of an existing support ticket or complaint ticket.',
  'grievance.escalate': 'Complaint, escalation, formal grievance, or unresolved support issue.',
  'support.contact': 'Human support contact, support hours, contact page, or grievance contact details.',
  'payment.summary': 'General payment history, status, overview without issue framing, or "tell me about my payments".',
  'fd.summary': 'Overview of all FDs, FD list, deposit details, status buckets, or "tell me about my FDs".',
  'account.overview': 'General account status, what the caller has, account snapshot, or verified safe overview.',
  'refund.status': 'Refund timing, when refund will arrive, refund ETA, or refund state.',
  'secure.action.help': 'Mobile number change, bank account change, nominee update, or profile modification.',
  'conversation.goodbye': 'Caller is ending the conversation, says they are done, or asks to hang up.',
  unknown: 'Unrelated, too unclear, or not enough information to choose a Stable Money support intent.',
};
function getIntentClassifierModel(): string {
  return process.env.OPENAI_INTENT_MODEL || process.env.OPENAI_AGENT_MODEL || 'gpt-4o-mini';
}

function isReasoningModel(model: string): boolean {
  const m = model.toLowerCase();
  return m.startsWith('gpt-5') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4');
}

function cacheKey(input: Pick<IntentClassifierInput, 'transcript' | 'history'>): string {
  const historyKey = input.history
    .slice(-CLASSIFIER_HISTORY_LIMIT)
    .map((message) => `${message.role}:${message.text}`)
    .join('\n');
  return `${input.transcript.trim().toLowerCase()}\n---\n${historyKey.toLowerCase()}`;
}

function withClassifierHistoryWindow(input: IntentClassifierInput): IntentClassifierInput {
  if (input.history.length <= CLASSIFIER_HISTORY_LIMIT) return input;
  return {
    ...input,
    history: input.history.slice(-CLASSIFIER_HISTORY_LIMIT),
  };
}

function transcriptPreview(transcript: string): string {
  const trimmed = transcript.trim().replace(/\s+/g, ' ');
  return trimmed.length > 120 ? `${trimmed.slice(0, 120)}...` : trimmed;
}

function routingPreview(text: string | null): string | null {
  if (text === null) return null;
  return transcriptPreview(text);
}

function routeLogPayload(route: StableIntentRoute): Record<string, unknown> {
  return {
    intent: route.intent,
    authTier: route.authTier,
    tools: route.tools,
  };
}

function rememberClassification(key: string, route: StableIntentRoute) {
  classificationCache.set(key, route);
  if (classificationCache.size <= CLASSIFIER_CACHE_LIMIT) return;
  const oldest = classificationCache.keys().next().value;
  if (oldest) classificationCache.delete(oldest);
}

function extractOpenAIText(response: OpenAIClassifierResponse): string {
  // Try output_parsed first (structured output from Responses API)
  if (response.output_parsed && typeof response.output_parsed === 'object') {
    return JSON.stringify(response.output_parsed);
  }

  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }

  if (Array.isArray(response.output)) {
    const textParts: string[] = [];
    for (const outputItem of response.output) {
      if (typeof outputItem === 'string') {
        textParts.push(outputItem);
        continue;
      }
      if (!outputItem || typeof outputItem !== 'object') continue;
      if (outputItem.parsed && typeof outputItem.parsed === 'object') {
        return JSON.stringify(outputItem.parsed);
      }
      if (typeof outputItem.text === 'string') {
        textParts.push(outputItem.text);
      }
      if (!Array.isArray(outputItem.content)) continue;
      for (const content of outputItem.content) {
        if (!content || typeof content !== 'object') continue;
        if (content.parsed && typeof content.parsed === 'object') {
          return JSON.stringify(content.parsed);
        }
        if (typeof content.text === 'string') {
          textParts.push(content.text);
        }
      }
    }
    const joined = textParts.join('').trim();
    if (joined) return joined;
  }

  // Fallback: check text field directly
  if (typeof response.text === 'string') {
    return response.text.trim();
  }

  return '';
}

function parseClassification(text: string): ModelClassification | null {
  if (!text || !text.trim()) return null;

  // Validate JSON is complete (basic check for incomplete JSON)
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as ModelClassification;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function routeFromIntent(intent: StableIntentId): StableIntentRoute {
  if (intent === 'unknown') return { intent, authTier: 'Tier A', tools: [] };
  return { intent, ...getStableIntentPolicy(intent) };
}

function isKnownIntent(value: unknown): value is StableIntentId {
  return typeof value === 'string' && INTENT_IDS.includes(value as StableIntentId);
}

function normalizeModelAuthTier(value: unknown): StableAuthTier | 'unknown' {
  return typeof value === 'string' && AUTH_TIERS.includes(value as StableAuthTier) ? (value as StableAuthTier) : 'unknown';
}

function normalizeConfidence(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function logClassifierFailure(_input: IntentClassifierInput, _extra: Record<string, unknown>) {
}

function buildClassifierRequestBody(
  input: IntentClassifierInput,
  options: { maxOutputTokens: number },
): Record<string, unknown> {
  const model = getIntentClassifierModel();
  return {
    model,
    input: [
      {
        role: 'user',
        content: JSON.stringify({
          transcript: input.transcript,
          recent_history: input.history.slice(-CLASSIFIER_HISTORY_LIMIT),
          allowed_intents: INTENT_IDS,
          intent_classification_guide: INTENT_CLASSIFICATION_GUIDE,
          fixed_policy_by_intent: STABLE_INTENT_POLICIES,
          unknown_policy: { authTier: 'Tier A', tools: [] },
        }),
      },
    ],
    instructions: [
      'Classify a Stable Money voice-support transcript into exactly one fixed intent.',
      'Use your own semantic understanding and intelligence to infer the caller intent from the sentence in any language or script, including mixed-language speech.',
      'Do not rely on keyword matching alone; use meaning and recent_history context together.',
      'Return only the schema fields for routing. Do not answer the caller; the next agent layer creates the Roman-script spoken response for Rumik.',
      'Always use recent_history as conversation context. Treat the current transcript as the latest caller turn in that conversation, not as an isolated sentence.',
      'Preserve the active support intent from recent_history when the latest caller turn is a follow-up, correction, interruption, confirmation, verification answer, or other context-dependent continuation.',
      'CRITICAL TOPIC-SWITCH RULE: If the latest caller turn explicitly names or references a DIFFERENT product domain or entity than the active support intent (e.g. says "payment/pe/पे/پے" when history was about KYC, or says "FD/एफडी" when history was about payments, or says "KYC/केवाईसी" when history was about FDs), that is a TOPIC SWITCH. Classify based on what the caller explicitly mentions NOW, not what history was about. The caller is changing the subject. Numbers like transaction IDs or amounts alongside a domain word reinforce the switch.',
      'Do not preserve the active support intent when the latest caller turn is a farewell, polite decline, or "no thanks" style ending; classify that as conversation.goodbye.',
      'Short repair utterances such as "what happened?", "kya hua?", "kya ho gaya?", or "ruk gaya?" are conversation-context dependent. If recent_history shows an active support context, keep that active support context instead of treating the short repair utterance as a new unknown intent.',
      'The auth_tier is the expected tier for that intent. Application code will enforce the final auth tier and allowed tools from the fixed policy table.',
    ].join('\n'),
    max_output_tokens: options.maxOutputTokens,
    stream: false,
    ...(isReasoningModel(model) ? { reasoning: { effort: 'low' } } : {}),
    prompt_cache_key: 'stable-intent-classifier-v1',
    text: {
      format: {
        type: 'json_schema',
        name: 'stable_intent_classification',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            intent: { type: 'string', enum: INTENT_IDS },
            auth_tier: { type: 'string', enum: AUTH_TIERS },
            confidence: { type: 'number' },
            reason: { type: 'string' },
          },
          required: ['intent', 'auth_tier', 'confidence', 'reason'],
        },
      },
    },
  };
}

export async function classifyStableIntentWithAI(input: IntentClassifierInput): Promise<IntentClassificationResult> {
  const fallbackRoute = routeStableTurn(input.transcript, input.history);
  let lastInvalidResult: IntentClassificationResult | null = null;

  console.log('[stable-intent-classifier:start]', {
    transcript_preview: transcriptPreview(input.transcript),
    transcript_chars: input.transcript.length,
    history_messages: input.history.length,
    fallback_route: routeLogPayload(fallbackRoute),
  });

  for (let attempt = 1; attempt <= MAX_CLASSIFIER_INVALID_OUTPUT_ATTEMPTS; attempt += 1) {
    const response = await (input.fetcher ?? fetch)('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        buildClassifierRequestBody(input, {
          maxOutputTokens: attempt === 1 ? CLASSIFIER_MAX_OUTPUT_TOKENS : CLASSIFIER_RETRY_MAX_OUTPUT_TOKENS,
        }),
      ),
    });

    if (!response.ok) {
      const errorBody = typeof response.text === 'function' ? await response.text().catch(() => '') : '';
      logClassifierFailure(input, {
        event: 'classifier_http_error',
        attempt,
        status: response.status,
        response_body: errorBody.slice(0, 500),
        fallback_intent: fallbackRoute.intent,
      });
      return { accepted: false, route: fallbackRoute, confidence: 0, reason: `classifier_status_${response.status}`, modelAuthTier: 'unknown' };
    }

    const responseJson = (await response.json()) as OpenAIClassifierResponse;
    const responseText = extractOpenAIText(responseJson);
    const parsed = parseClassification(responseText);
    if (!parsed || !isKnownIntent(parsed.intent)) {
      const isIncompleteJson =
        responseText.length > 0 && responseText.length < 50 && (responseText.startsWith('{"') || responseText.startsWith('['));
      logClassifierFailure(input, {
        event: 'classifier_invalid_output',
        attempt,
        output_text: responseText.slice(0, 500),
        output_text_length: responseText.length,
        likely_incomplete_json: isIncompleteJson,
        response_status: responseJson.status,
        incomplete_details: responseJson.incomplete_details,
        response_json_keys: typeof responseJson === 'object' && responseJson ? Object.keys(responseJson).join(',') : 'not-object',
        response_json_output_type: Array.isArray(responseJson?.output) ? `array[${responseJson.output.length}]` : typeof responseJson?.output,
        fallback_intent: fallbackRoute.intent,
      });
      lastInvalidResult = {
        accepted: false,
        route: fallbackRoute,
        confidence: 0,
        reason: 'invalid_classifier_output',
        modelAuthTier: 'unknown',
      };
      continue;
    }

    const confidence = normalizeConfidence(parsed.confidence);
    const modelAuthTier = normalizeModelAuthTier(parsed.auth_tier);
    if (confidence < 0.55) {
      logClassifierFailure(input, {
        event: 'classifier_low_confidence',
        attempt,
        model_intent: parsed.intent,
        model_auth_tier: modelAuthTier,
        confidence,
        reason: typeof parsed.reason === 'string' ? parsed.reason : 'low_confidence',
        fallback_intent: fallbackRoute.intent,
      });
      return {
        accepted: false,
        route: fallbackRoute,
        confidence,
        reason: typeof parsed.reason === 'string' ? parsed.reason : 'low_confidence',
        modelAuthTier,
      };
    }

    const route = routeFromIntent(parsed.intent);
    console.log('[stable-intent-classifier:accepted]', {
      attempt,
      model_intent: parsed.intent,
      model_auth_tier: modelAuthTier,
      confidence,
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      route: routeLogPayload(route),
    });
    return {
      accepted: true,
      route,
      confidence,
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      modelAuthTier,
    };
  }

  return lastInvalidResult ?? { accepted: false, route: fallbackRoute, confidence: 0, reason: 'invalid_classifier_output', modelAuthTier: 'unknown' };
}

export async function resolveStableTurnRoute(input: IntentClassifierInput): Promise<StableIntentRoute> {
  const key = cacheKey(input);
  const cached = classificationCache.get(key);
  if (cached) {
    console.log('[stable-intent-classifier:cache-hit]', {
      transcript_preview: transcriptPreview(input.transcript),
      history_messages: input.history.length,
      route: routeLogPayload(cached),
    });
    return cached;
  }

  const deterministicTrace = traceStableTurnRoute(input.transcript, input.history);
  const deterministicRoute = deterministicTrace.route;
  if (deterministicRoute.intent !== 'unknown') {
    console.log('[stable-intent-classifier:deterministic-hit]', {
      transcript_preview: transcriptPreview(input.transcript),
      normalized_transcript_preview: routingPreview(deterministicTrace.normalizedTranscript),
      history_messages: input.history.length,
      match_source: deterministicTrace.matchSource,
      matched_pattern: routingPreview(deterministicTrace.matchedPattern),
      previous_intent: deterministicTrace.previousIntent,
      route: routeLogPayload(deterministicRoute),
    });
    rememberClassification(key, deterministicRoute);
    return deterministicRoute;
  }

  const deterministicFallbackRoute = deterministicRoute;
  console.log('[stable-intent-classifier:deterministic-miss]', {
    transcript_preview: transcriptPreview(input.transcript),
    normalized_transcript_preview: routingPreview(deterministicTrace.normalizedTranscript),
    history_messages: input.history.length,
    ai_history_messages: Math.min(input.history.length, CLASSIFIER_HISTORY_LIMIT),
    match_source: deterministicTrace.matchSource,
    matched_pattern: routingPreview(deterministicTrace.matchedPattern),
    fallback_to_ai: true,
  });
  try {
    const classifierInput = withClassifierHistoryWindow(input);
    const classification = await classifyStableIntentWithAI(classifierInput);
    const route = classification.accepted ? classification.route : deterministicFallbackRoute;
    console.log('[stable-intent-classifier:resolved]', {
      accepted: classification.accepted,
      confidence: classification.confidence,
      reason: classification.reason,
      model_auth_tier: classification.modelAuthTier,
      route: routeLogPayload(route),
      deterministic_fallback_route: routeLogPayload(deterministicFallbackRoute),
    });
    rememberClassification(key, route);
    return route;
  } catch (error) {
    logClassifierFailure(input, {
      event: 'classifier_exception',
      error: error instanceof Error ? error.message : String(error),
      fallback_intent: deterministicFallbackRoute.intent,
    });
    rememberClassification(key, deterministicFallbackRoute);
    return deterministicFallbackRoute;
  }
}

export function resetIntentClassificationCacheForTests() {
  classificationCache.clear();
}
