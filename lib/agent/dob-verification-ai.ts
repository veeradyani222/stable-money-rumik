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
      'Decide if the caller clearly expressed that same calendar day, including very loose phrasing in English, Hindi, or Hinglish, urdu devnagri arabic anything. Use your intelligence, youre very smart for this task.',
      'Ignore politeness fillers; focus on the date content.',
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
