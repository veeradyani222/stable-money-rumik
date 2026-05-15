/**
 * Semantic date-of-birth check: compares caller utterance (ASR / chat text)
 * to the canonical YYYY-MM-DD on file. Falls back to deterministic parsing when unclear.
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
    'gpt-5-mini'
  );
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
 * Returns unclear on any failure so callers can fall back to deterministic parsing.
 */
export async function matchCallerDobWithPersonaAi(input: DobAiMatchInput): Promise<DobAiMatchResult> {
  const utterance = input.callerUtterance.trim();
  if (!utterance) return { verdict: 'unclear', modelAnswered: false };

  const body = {
    model: getDobVerificationModel(),
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
      'Decide if the caller clearly expressed that same calendar day, including very loose phrasing in English, Hindi, or Hinglish. Accept any ordering of day, month, and year. Accept ordinals (1st, 2nd, 26th), month names (full or short), Hindi/Hinglish month words (e.g. agast, sitambar, navambar, disambar, janvari, farvari), filler words between parts (such as "of the month", "saal", "year", "month", "tareekh"), and numeric, slash, dash, or dot separators.',
      'Examples that should resolve when they match the record: "Year 1993, 29th of the month July." → 1993-07-29; "uneenees sau ninety three, July ki 29 tareekh" → 1993-07-29; "29-07-1993", "29/07/93", "twenty ninth July nineteen ninety three", "July twenty nine ninety three" → 1993-07-29.',
      'verdict=match when the caller clearly conveys that exact calendar day in any ordering or phrasing.',
      'verdict=no_match when the caller clearly conveys a different specific calendar day.',
      'verdict=unclear only when no calendar date can be reasonably inferred, when there are multiple conflicting dates in the same utterance, or when the utterance is clearly not a date at all (e.g. only an age, only a zodiac, gibberish).',
      'Do not match based on age alone, zodiac alone, or partial guesses (e.g. only a year).',
      'Ignore politeness fillers; focus on the date content.',
    ].join('\n'),
    max_output_tokens: 8000,
    stream: false,
    reasoning: { effort: 'low' },
    prompt_cache_key: 'stable-dob-verification-v1',
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
