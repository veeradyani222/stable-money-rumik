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
    const raw = typeof parsed.extracted_last_four === 'string' ? parsed.extracted_last_four.replace(/\D/g, '') : '';
    const extractedLastFour = /^\d{4}$/.test(raw) ? raw : null;
    return { verdict: v, extractedLastFour };
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
      'The caller may speak in ANY language, script, or writing system worldwide. Common Indian languages and scripts include English, Hindi, Hinglish, Urdu, Bengali (বাংলা, e.g. পাঁচ=5 ছয়=6 সাত=7 আট=8 নয়=9), Tamil (தமிழ்), Telugu (తెలుగు), Kannada (ಕನ್ನಡ), Malayalam (മലയാളം), Marathi, Gujarati, Punjabi (ਪੰਜਾਬੀ), Arabic script, Devanagari, Gurmukhi, and more.',
      'Handle phonetic ASR transcriptions, number words in any language, and creative phrasing like "double", "triple", "ek do teen char", "পাঁচ পাঁচ নয় আট", "ڈبل ون ٹو تھری", etc. Use your intelligence to decode what four digits the caller intended.',
      'verdict=match when the caller clearly conveys all four digits in the same order as record_last_four.',
      'verdict=no_match when the caller clearly conveys four digits that differ from record_last_four.',
      'verdict=unclear when the utterance has no digit content, is gibberish, or you cannot confidently determine all four digits.',
      'If you can determine the four digits the caller intended, return them as a four-digit string in extracted_last_four. Otherwise return an empty string for extracted_last_four.',
      'Do not guess. If you are not confident, return unclear.',
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
