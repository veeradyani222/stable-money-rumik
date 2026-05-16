/**
 * Semantic date-of-birth check: compares caller utterance (ASR / chat text)
 * to the canonical YYYY-MM-DD on file. The AI verdict is final for this check.
 */

type Fetcher = typeof fetch;

export type DobAiVerdict = 'match' | 'no_match' | 'unclear';

export interface DobAiMatchInput {
  apiKey: string;
  callerUtterance: string;
  /** Persona record: strict ISO calendar date YYYY-MM-DD */
  recordIsoDate: string;
  fetcher?: Fetcher;
}

export interface DobAiMatchResult {
  verdict: DobAiVerdict;
  /** True when the HTTP call succeeded and JSON was valid */
  modelAnswered: boolean;
}

interface OpenAiDobResponse {
  output_text?: string;
  output_parsed?: unknown;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string; parsed?: unknown }>;
    text?: string;
    parsed?: unknown;
  } | string>;
}

function getDobVerificationModel(): string {
  return (
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

function extractOpenAiJsonText(response: OpenAiDobResponse): string {
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

function parseVerdict(text: string): DobAiVerdict | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  try {
    const parsed = JSON.parse(trimmed) as { verdict?: unknown };
    const v = parsed.verdict;
    if (v === 'match' || v === 'no_match' || v === 'unclear') return v;
    return null;
  } catch {
    return null;
  }
}

/**
 * Ask the model whether the caller stated the same calendar day as recordIsoDate.
 * Returns unclear when the model cannot infer a clear date. Callers should treat
 * unclear as a hard verification failure, not a deterministic fallback.
 */
export async function matchCallerDobWithPersonaAi(input: DobAiMatchInput): Promise<DobAiMatchResult> {
  const utterance = input.callerUtterance.trim();
  if (!utterance) return { verdict: 'unclear', modelAnswered: false };

  const dobModel = getDobVerificationModel();
  const body = {
    model: dobModel,
    input: [
      {
        role: 'user',
        content: JSON.stringify({
          caller_utterance: utterance,
          record_date_iso: input.recordIsoDate,
        }),
      },
    ],
    instructions: [
      'You verify whether a banking support caller stated their date of birth matching an internal record.',
      'The record_date_iso is the canonical calendar date on file (YYYY-MM-DD, no time zone).',
      'CRITICAL: The caller is based in India. In India the date convention is dd/mm/yyyy (day first, then month, then year). When a caller says a numeric date like "9/11/1995" or "9-11-1995", interpret it as 9th November 1995 (day=9, month=11), NOT September 11. Always assume dd/mm/yyyy for ambiguous numeric dates.',
      'The caller may speak in ANY language, script, or writing system. Common examples: English, Hindi, Hinglish, Urdu, Bengali (বাংলা), Tamil (தமிழ்), Telugu (తెలుగు), Kannada (ಕನ್ನಡ), Malayalam (മലയാളം), Marathi, Gujarati, Punjabi (ਪੰਜਾਬੀ), Devanagari, Arabic script, and more. Handle phonetic ASR transcriptions properly.',
      'Accept any natural date expression: "9 November 1995", "9/11/95", "november nine ninety five", "nau november unnis sau pachanve", "I said 9/11/1995", etc. Extract the date meaning from the full utterance.',
      'Ignore politeness fillers, "I said", "meri date of birth hai", etc.; focus only on the date content.',
      'verdict=match when the caller clearly conveys the same calendar day as record_date_iso.',
      'verdict=no_match when the caller clearly conveys a different calendar day.',
      'verdict=unclear when the utterance has no date content, is gibberish, or the date is too ambiguous to determine.',
      'Do not guess. If you are not confident, return unclear.',
    ].join('\n'),
    max_output_tokens: 8000,
    stream: false,
    ...(isReasoningModel(dobModel) ? { reasoning: { effort: 'low' } } : {}),
    prompt_cache_key: 'stable-dob-verification-v2',
    text: {
      format: {
        type: 'json_schema',
        name: 'stable_dob_verdict',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            verdict: { type: 'string', enum: ['match', 'no_match', 'unclear'] },
            reason: { type: 'string' },
          },
          required: ['verdict', 'reason'],
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
      return { verdict: 'unclear', modelAnswered: false };
    }

    const json = (await response.json()) as OpenAiDobResponse;
    const text = extractOpenAiJsonText(json);
    const verdict = parseVerdict(text);
    if (!verdict) return { verdict: 'unclear', modelAnswered: false };
    return { verdict, modelAnswered: true };
  } catch {
    return { verdict: 'unclear', modelAnswered: false };
  }
}
