export type RumikTone = 'happy' | 'excited' | 'sad' | 'angry' | 'neutral' | 'whisper';

const TONE_TAG_PATTERN = /\[([^\]]+)\]/g;
const STARTING_TONE_PATTERN = /^\[(happy|excited|sad|angry|neutral|whisper)\] /;
const EVENT_TAG_PATTERN = /<([a-z]+)>/g;
const CURRENCY_PREFIX_AMOUNT_PATTERN = /(?:₹\s*([0-9][0-9,]*)|\b(?:rs\.?|inr|rupees?)\s*([0-9][0-9,]*))/gi;
const CURRENCY_SUFFIX_AMOUNT_PATTERN = /\b([0-9][0-9,]*)\s*(?:rs\.?|inr|rupees?)\b/gi;
const SPOKEN_DATE_PATTERN =
  /\b([0-9]{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+([0-9]{4})\b/gi;
const NUMBER_RANGE_PATTERN = /\b([0-9]{1,3})\s+(se|to)\s+([0-9]{1,3})\b/gi;
const NUMBER_WITH_UNIT_PATTERN = /\b([0-9]{1,3})\s+(months?|hours?|days?|years?|working hours?)\b/gi;
const NUMBER_TOKEN_PATTERN = /\b[0-9][0-9,]*\b/g;
const DASH_PATTERN = /[\u2010-\u2015-]+/g;
const STAR_PATTERN = /[*]+/g;
const SLASH_PATTERN = /[\\/]+/g;
const COLON_SEMICOLON_PATTERN = /[:;]+/g;
const FD_DETAIL_INTRO_PATTERN = /Aapke?\s+FD\s+ki\s+details\s+ye\s+hain\s*:?\s*/i;
const FD_DETAIL_LABEL_PATTERN = /\b(Bank|Amount|Status|Tenure|Booking date|Maturity date)\s*:/gi;
const FD_DETAIL_SUFFIX_PATTERN = /\b(?:Confirmation|Agar|Please|Iske|Usually)\b/i;

const RUMIK_TONES: RumikTone[] = ['happy', 'excited', 'sad', 'angry', 'neutral', 'whisper'];
const RUMIK_TONE_SET = new Set<string>(RUMIK_TONES);
const SMALL_NUMBER_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
] as const;
const TENS_NUMBER_WORDS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'] as const;
const ORDINAL_NUMBER_WORDS: Record<number, string> = {
  1: 'first',
  2: 'second',
  3: 'third',
  4: 'fourth',
  5: 'fifth',
  6: 'sixth',
  7: 'seventh',
  8: 'eighth',
  9: 'ninth',
  10: 'tenth',
  11: 'eleventh',
  12: 'twelfth',
  13: 'thirteenth',
  14: 'fourteenth',
  15: 'fifteenth',
  16: 'sixteenth',
  17: 'seventeenth',
  18: 'eighteenth',
  19: 'nineteenth',
  20: 'twentieth',
  21: 'twenty first',
  22: 'twenty second',
  23: 'twenty third',
  24: 'twenty fourth',
  25: 'twenty fifth',
  26: 'twenty sixth',
  27: 'twenty seventh',
  28: 'twenty eighth',
  29: 'twenty ninth',
  30: 'thirtieth',
  31: 'thirty first',
};

const COMPATIBLE_EVENTS: Record<string, Set<string>> = {
  happy: new Set(['laugh', 'chuckle']),
  excited: new Set(['laugh']),
  sad: new Set(['sigh']),
  angry: new Set(['sigh']),
  neutral: new Set(),
  whisper: new Set(['chuckle', 'sigh']),
};

function coerceRumikTone(value: string | null | undefined): RumikTone | null {
  const normalized = value?.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ') ?? '';
  if (RUMIK_TONE_SET.has(normalized)) return normalized as RumikTone;
  for (const tone of RUMIK_TONES) {
    if (new RegExp(`\\b${tone}\\b`).test(normalized)) return tone;
  }
  return null;
}

function numberBelowHundredToWords(value: number): string {
  if (value < 20) return SMALL_NUMBER_WORDS[value];
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  return ones === 0 ? TENS_NUMBER_WORDS[tens] : `${TENS_NUMBER_WORDS[tens]} ${SMALL_NUMBER_WORDS[ones]}`;
}

function numberBelowThousandToWords(value: number): string {
  if (value < 100) return numberBelowHundredToWords(value);
  const hundreds = Math.floor(value / 100);
  const remainder = value % 100;
  const prefix = `${SMALL_NUMBER_WORDS[hundreds]} hundred`;
  return remainder === 0 ? prefix : `${prefix} ${numberBelowHundredToWords(remainder)}`;
}

function numberToIndianWords(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) return '';
  if (value < 1000) return numberBelowThousandToWords(value);

  const parts: string[] = [];
  const units: Array<[number, string]> = [
    [10000000, 'crore'],
    [100000, 'lakh'],
    [1000, 'thousand'],
  ];
  let remainder = value;

  for (const [unitValue, unitName] of units) {
    if (remainder < unitValue) continue;
    const count = Math.floor(remainder / unitValue);
    parts.push(`${numberBelowThousandToWords(count)} ${unitName}`);
    remainder %= unitValue;
  }

  if (remainder > 0) parts.push(numberBelowThousandToWords(remainder));
  return parts.join(' ');
}

function yearToWords(value: number): string {
  if (value >= 1900 && value <= 1999) {
    const remainder = value - 1900;
    return remainder === 0 ? 'nineteen hundred' : `nineteen ${numberBelowHundredToWords(remainder)}`;
  }
  if (value >= 2010 && value <= 2099) {
    return `twenty ${numberBelowHundredToWords(value - 2000)}`;
  }
  if (value >= 2000 && value <= 2009) {
    const remainder = value - 2000;
    return remainder === 0 ? 'two thousand' : `two thousand ${numberBelowHundredToWords(remainder)}`;
  }
  return numberToIndianWords(value);
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

function digitsWithGaps(value: string): string {
  return digitsOnly(value).split('').join(' ');
}

function amountTokenToWords(value: string): string {
  const digits = digitsOnly(value);
  if (!digits) return value;
  const words = numberToIndianWords(Number(digits));
  return words || digitsWithGaps(value);
}

function normalizeNumberToken(token: string): string {
  const digits = digitsOnly(token);
  if (!digits) return token;
  if (token.includes(',') || (digits.length >= 5 && digits.length <= 7)) return amountTokenToWords(token);
  return digitsWithGaps(token);
}

function normalizeSpokenDate(day: string, month: string, year: string): string {
  const dayNumber = Number(day);
  const yearNumber = Number(year);
  const dayWords = ORDINAL_NUMBER_WORDS[dayNumber] ?? numberBelowHundredToWords(dayNumber);
  return `${dayWords} ${month} ${yearToWords(yearNumber)}`;
}

function normalizeFieldValue(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function dateFieldValue(value: string): string {
  return normalizeFieldValue(value.match(SPOKEN_DATE_PATTERN)?.[0] ?? value);
}

function simpleFieldValue(value: string): string {
  const suffix = value.search(FD_DETAIL_SUFFIX_PATTERN);
  return normalizeFieldValue(suffix >= 0 ? value.slice(0, suffix) : value);
}

function sentenceCaseValue(value: string): string {
  const normalized = simpleFieldValue(value).toLowerCase();
  return normalized ? normalized : value;
}

function rewriteLabelledFdDetails(text: string): string {
  const matches = [...text.matchAll(FD_DETAIL_LABEL_PATTERN)];
  if (matches.length < 2) return text;

  const fields: Record<string, string> = {};
  let blockEnd = matches.at(-1)?.index ?? text.length;

  matches.forEach((match, index) => {
    const label = String(match[1] ?? '').toLowerCase();
    const valueStart = (match.index ?? 0) + match[0].length;
    const nextStart = matches[index + 1]?.index ?? text.length;
    const rawValue = text.slice(valueStart, nextStart);
    const value = label.includes('date') ? dateFieldValue(rawValue) : simpleFieldValue(rawValue);
    fields[label] = value;
    if (index === matches.length - 1) {
      blockEnd = valueStart + rawValue.indexOf(value) + value.length;
    }
  });

  if (!fields.bank && !fields.amount && !fields.status) return text;

  const intro = text.match(FD_DETAIL_INTRO_PATTERN);
  const blockStart = intro?.index ?? matches[0]?.index ?? 0;
  const before = text.slice(0, blockStart).trim();
  const after = text.slice(blockEnd).trim();
  const sentences: string[] = [];

  if (before) sentences.push(before);
  sentences.push('Aapki FD details ye hain.');
  if (fields.bank && fields.amount) {
    sentences.push(`FD ${fields.bank} mein ${fields.amount} ki hai.`);
  } else if (fields.bank) {
    sentences.push(`FD ${fields.bank} mein hai.`);
  } else if (fields.amount) {
    sentences.push(`FD amount ${fields.amount} hai.`);
  }
  if (fields.status) sentences.push(`Status ${sentenceCaseValue(fields.status)} hai.`);
  if (fields.tenure) sentences.push(`Tenure ${fields.tenure} hai.`);
  if (fields['booking date']) sentences.push(`Booking date ${fields['booking date']} hai.`);
  if (fields['maturity date']) sentences.push(`Maturity date ${fields['maturity date']} hai.`);
  if (after) sentences.push(after);

  return sentences.join(' ');
}

function normalizeSimpleSpeech(text: string): string {
  return text
    .replace(CURRENCY_PREFIX_AMOUNT_PATTERN, (_match, symbolAmount: string | undefined, wordAmount: string | undefined) => {
      return `rupees ${amountTokenToWords(symbolAmount ?? wordAmount ?? '')}`;
    })
    .replace(CURRENCY_SUFFIX_AMOUNT_PATTERN, (_match, amount: string) => {
      return `rupees ${amountTokenToWords(amount)}`;
    })
    .replace(SPOKEN_DATE_PATTERN, (_match, day: string, month: string, year: string) => {
      return normalizeSpokenDate(day, month, year);
    })
    .replace(NUMBER_RANGE_PATTERN, (_match, start: string, connector: string, end: string) => {
      const spokenConnector = connector.toLowerCase() === 'to' ? 'to' : 'se';
      return `${numberBelowThousandToWords(Number(start))} ${spokenConnector} ${numberBelowThousandToWords(Number(end))}`;
    })
    .replace(NUMBER_WITH_UNIT_PATTERN, (_match, amount: string, unit: string) => {
      return `${numberBelowThousandToWords(Number(amount))} ${unit.toLowerCase()}`;
    })
    .replace(NUMBER_TOKEN_PATTERN, (token) => normalizeNumberToken(token))
    .replace(STAR_PATTERN, ' ')
    .replace(SLASH_PATTERN, ' or ')
    .replace(DASH_PATTERN, ' ')
    .replace(COLON_SEMICOLON_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSpokenBody(text: string): string {
  return normalizeSimpleSpeech(rewriteLabelledFdDetails(text));
}

function normalizeSpeakableText(text: string): string {
  const match = text.match(/^(\[(?:happy|excited|sad|angry|neutral|whisper)\] )([\s\S]*)$/);
  if (!match) return normalizeSpokenBody(text);
  return `${match[1]}${normalizeSpokenBody(match[2])}`.trim();
}

export function extractRumikStartingTone(text: string): RumikTone | null {
  return coerceRumikTone(text.trim().match(/^\[([^\]]+)\]\s*/)?.[1]);
}

export function normalizeRumikText(text: string, fallbackTone: RumikTone = 'neutral'): string {
  let normalized = text.trim().replace(/\s+/g, ' ');
  const startingTone = extractRumikStartingTone(normalized) ?? fallbackTone;

  normalized = normalized.replace(TONE_TAG_PATTERN, (_tag, tone, offset) => {
    const coercedTone = coerceRumikTone(tone);
    return offset === 0 && coercedTone === startingTone ? `[${startingTone}]` : '';
  });

  if (!STARTING_TONE_PATTERN.test(normalized)) {
    normalized = `[${startingTone}] ${normalized.replace(/^\[[^\]]+\]\s*/, '')}`;
  }

  normalized = normalized.replace(EVENT_TAG_PATTERN, (tag, event) => {
    return COMPATIBLE_EVENTS[startingTone]?.has(event) ? tag : '';
  });

  return normalizeSpeakableText(normalized).replace(/\s+/g, ' ');
}
