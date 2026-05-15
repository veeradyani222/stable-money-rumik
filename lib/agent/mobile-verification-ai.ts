/**
 * Semantic mobile-last-four check: compares caller utterance (ASR / chat text)
 * to the canonical last four digits on file. Tolerant of any language,
 * script, or spoken pattern (English, Hindi, Hinglish, Urdu, Arabic script,
 * Devanagari, mixed code-switching, "double", "triple", filler words, etc.).
 *
 * Returns:
 *   match    -> caller clearly stated the same four digits in any ordering
 *               that maps to the record (digits are positional, so order
 *               matters: 1123 ≠ 2311).
 *   no_match -> caller clearly stated four different digits.
 *   unclear  -> not enough digits, gibberish, or ambiguous.
 *
 * Callers should treat unclear as "ask again" rather than as a hard failure.
 */

type Fetcher = typeof fetch;

export type MobileAiVerdict = 'match' | 'no_match' | 'unclear';

export interface MobileAiMatchInput {
  apiKey: string;
  callerUtterance: string;
  /** Canonical four digit string on file, e.g. "3210". */
  recordLastFour: string;
  fetcher?: Fetcher;
}

export interface MobileAiMatchResult {
  verdict: MobileAiVerdict;
  /** Four-digit string the model believes the caller intended, when confident. */
  extractedLastFour: string | null;
  /** True when the HTTP call succeeded and JSON was valid. */
  modelAnswered: boolean;
}

interface OpenAiMobileResponse {
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

function getMobileVerificationModel(): string {
  return (
    process.env.OPENAI_MOBILE_VERIFICATION_MODEL ||
    process.env.OPENAI_DO_VERIFICATION_MODEL ||
    process.env.OPENAI_INTENT_MODEL ||
    process.env.OPENAI_AGENT_MODEL ||
    'gpt-4o-mini'
  );
}

function isReasoningModel(model: string): boolean {
  const m = model.toLowerCase();
  return m.startsWith('gpt-5') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4');
}

function extractOpenAiJsonText(response: OpenAiMobileResponse): string {
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

function parseMobileVerdict(text: string): { verdict: MobileAiVerdict; extractedLastFour: string | null } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  try {
    const parsed = JSON.parse(trimmed) as { verdict?: unknown; extracted_last_four?: unknown };
    const v = parsed.verdict;
    if (v !== 'match' && v !== 'no_match' && v !== 'unclear') return null;
    const extractedRaw = typeof parsed.extracted_last_four === 'string' ? parsed.extracted_last_four : '';
    const extracted = /^\d{4}$/.test(extractedRaw) ? extractedRaw : null;
    return { verdict: v, extractedLastFour: extracted };
  } catch {
    return null;
  }
}

/**
 * Ask the model whether the caller's utterance states the same four digits as
 * the record. Returns unclear on any failure so callers can fall back to
 * deterministic extraction.
 */
export async function matchCallerMobileLastFourAi(input: MobileAiMatchInput): Promise<MobileAiMatchResult> {
  const utterance = input.callerUtterance.trim();
  if (!utterance) {
    return { verdict: 'unclear', extractedLastFour: null, modelAnswered: false };
  }
  if (!/^\d{4}$/.test(input.recordLastFour)) {
    return { verdict: 'unclear', extractedLastFour: null, modelAnswered: false };
  }

  const mobileModel = getMobileVerificationModel();
  const body = {
    model: mobileModel,
    input: [
      {
        role: 'user',
        content: JSON.stringify({
          caller_utterance: utterance,
          record_last_four: input.recordLastFour,
        }),
      },
    ],
    instructions: [
      'You verify whether a banking support caller stated the last four digits of their registered mobile number.',
      'record_last_four is the canonical four digit string on file (positional, order matters; e.g. "1123" ≠ "2311").',
      'The caller may speak in English, Hindi, Hinglish, Urdu, Arabic script, Devanagari, or any other language, and may use spoken patterns such as "double one two three", "triple seven five", "ek do teen char", "ون ون ٹو تھری", "ڈبل ون ٹو تھری", or simply the digits "1123".',
      'Map digit words (zero through nine) in any language to digits. Examples: "double X" -> X X. "triple X" -> X X X. "ek/एक" -> 1, "do/दो" -> 2, "teen/तीन" -> 3, "char/चार" -> 4. Urdu: "صفر"=0, "ون/ایک"=1, "ٹو/دو"=2, "تھری/تین"=3, "فور/چار"=4, "فائیو/پانچ"=5, "سکس/چھ"=6, "سیون/سات"=7, "ایٹ/آٹھ"=8, "نائن/نو"=9, "ڈبل"=double, "ٹرپل"=triple.',
      'Ignore politeness fillers, "hai", "the digits are", "last four", "is", "are", "yes", "ok", scope words, and other non-digit content.',
      'If the utterance yields exactly four digits in sequence, return extracted_last_four with those four digits. Compare to record_last_four positionally.',
      'verdict=match when the caller clearly conveys all four digits in the same order as record_last_four.',
      'verdict=no_match when the caller clearly conveys four different digits.',
      'verdict=unclear when fewer than four digits can be extracted, when more than four digits appear without a clear "last four" of them, when the utterance has no digit content, or when it is gibberish.',
      'Do not guess. If you are not confident the caller said four specific digits, return unclear with extracted_last_four="".',
    ].join('\n'),
    max_output_tokens: 4000,
    stream: false,
    ...(isReasoningModel(mobileModel) ? { reasoning: { effort: 'low' } } : {}),
    prompt_cache_key: 'stable-mobile-last4-verification-v1',
    text: {
      format: {
        type: 'json_schema',
        name: 'stable_mobile_last_four_verdict',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            verdict: { type: 'string', enum: ['match', 'no_match', 'unclear'] },
            extracted_last_four: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['verdict', 'extracted_last_four', 'reason'],
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
      return { verdict: 'unclear', extractedLastFour: null, modelAnswered: false };
    }

    const json = (await response.json()) as OpenAiMobileResponse;
    const text = extractOpenAiJsonText(json);
    const parsed = parseMobileVerdict(text);
    if (!parsed) return { verdict: 'unclear', extractedLastFour: null, modelAnswered: false };
    return { ...parsed, modelAnswered: true };
  } catch {
    return { verdict: 'unclear', extractedLastFour: null, modelAnswered: false };
  }
}
