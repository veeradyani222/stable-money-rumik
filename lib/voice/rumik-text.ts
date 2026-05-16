export type RumikTone = 'happy' | 'excited' | 'sad' | 'angry' | 'neutral' | 'whisper';

const TONE_TAG_PATTERN = /\[(happy|excited|sad|angry|neutral|whisper)\]/g;
const STARTING_TONE_PATTERN = /^\[(happy|excited|sad|angry|neutral|whisper)\] /;
const EVENT_TAG_PATTERN = /<([a-z]+)>/g;

const COMPATIBLE_EVENTS: Record<string, Set<string>> = {
  happy: new Set(['laugh', 'chuckle']),
  excited: new Set(['laugh']),
  sad: new Set(['sigh']),
  angry: new Set(['sigh']),
  neutral: new Set(),
  whisper: new Set(['chuckle', 'sigh']),
};

export function extractRumikStartingTone(text: string): RumikTone | null {
  const tone = text.trim().match(STARTING_TONE_PATTERN)?.[1];
  return tone ? (tone as RumikTone) : null;
}

export function normalizeRumikText(text: string, fallbackTone: RumikTone = 'neutral'): string {
  let normalized = text.trim().replace(/\s+/g, ' ');
  const startingTone = extractRumikStartingTone(normalized) ?? fallbackTone;

  normalized = normalized.replace(TONE_TAG_PATTERN, (tag, tone, offset) => {
    return offset === 0 && tone === startingTone ? tag : '';
  });

  if (!STARTING_TONE_PATTERN.test(normalized)) {
    normalized = `[${startingTone}] ${normalized.replace(/^\[[^\]]+\]\s*/, '')}`;
  }

  normalized = normalized.replace(EVENT_TAG_PATTERN, (tag, event) => {
    return COMPATIBLE_EVENTS[startingTone]?.has(event) ? tag : '';
  });

  return normalized.trim().replace(/\s+/g, ' ');
}
