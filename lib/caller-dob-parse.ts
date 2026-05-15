/**
 * Parse caller-supplied date-of-birth strings into a canonical YYYY-MM-DD (calendar date, no TZ shift).
 * Accepts common English / Indian numeric orders and many natural-language phrasings.
 */

export type CallerDobParseResult = { ok: true; isoDate: string } | { ok: false };

const MONTH_NAMES: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const ORDINAL_WORDS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
  thirteenth: 13,
  fourteenth: 14,
  fifteenth: 15,
  sixteenth: 16,
  seventeenth: 17,
  eighteenth: 18,
  nineteenth: 19,
  twentieth: 20,
  twentyfirst: 21,
  twentysecond: 22,
  twentythird: 23,
  twentyfourth: 24,
  twentyfifth: 25,
  twentysixth: 26,
  twentyseventh: 27,
  twentyeighth: 28,
  twentyninth: 29,
  thirtieth: 30,
  thirtyfirst: 31,
};

const CARDINAL_WORDS: Record<string, number> = {
  zero: 0,
  oh: 0,
  o: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatIsoDateOnly(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || year < 1000 || year > 9999) return false;
  const dim = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= dim[month - 1]!;
}

function expandTwoDigitYear(y: number): number {
  if (y >= 100) return y;
  return y <= 29 ? 2000 + y : 1900 + y;
}

function tryIsoYmd(text: string): string | null {
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!isValidCalendarDate(year, month, day)) return null;
  return formatIsoDateOnly(year, month, day);
}

/** Year-month-day with slash or dot separators: 2005/02/26 or 2005.2.26 */
function tryYmdNumeric(text: string): string | null {
  const m = text.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!isValidCalendarDate(year, month, day)) return null;
  return formatIsoDateOnly(year, month, day);
}

/**
 * d/m/y or m/d/y when last segment is year; prefer d/m/y (India) when both parts ≤ 12.
 */
function tryDmyOrMdyNumeric(text: string): string | null {
  const m = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/);
  if (!m) return null;
  let a = Number(m[1]);
  let b = Number(m[2]);
  let y = Number(m[3]);
  if (m[3]!.length === 2) y = expandTwoDigitYear(y);

  let day: number;
  let month: number;
  const year = y;

  if (a > 12) {
    day = a;
    month = b;
  } else if (b > 12) {
    month = a;
    day = b;
  } else {
    day = a;
    month = b;
  }

  if (!isValidCalendarDate(year, month, day)) {
    if (a > 12 || b > 12) return null;
    const altDay = b;
    const altMonth = a;
    if (isValidCalendarDate(year, altMonth, altDay)) {
      return formatIsoDateOnly(year, altMonth, altDay);
    }
    return null;
  }

  return formatIsoDateOnly(year, month, day);
}

function isPureNumericDateTriplet(candidate: string): boolean {
  return /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(candidate);
}

function monthFromToken(token: string): number | null {
  const key = token.toLowerCase();
  return MONTH_NAMES[key] ?? null;
}

function cleanSpokenToken(token: string): string {
  return token.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function numberFromSpokenPhrase(phrase: string): number | null {
  const compactPhrase = phrase.toLowerCase().replace(/[-\s]+/g, '');
  if (/^\d{1,4}$/.test(compactPhrase)) return Number(compactPhrase);
  if (ORDINAL_WORDS[compactPhrase] != null) return ORDINAL_WORDS[compactPhrase];

  const tokens = phrase
    .toLowerCase()
    .replace(/-/g, ' ')
    .split(/\s+/)
    .map(cleanSpokenToken)
    .filter(Boolean);
  if (!tokens.length) return null;

  let total = 0;
  for (const token of tokens) {
    const ordinal = ORDINAL_WORDS[token];
    const cardinal = CARDINAL_WORDS[token];
    if (ordinal == null && cardinal == null) return null;
    total += ordinal ?? cardinal;
  }
  return total;
}

function yearFromSpokenPhrase(phrase: string): number | null {
  const normalized = phrase.toLowerCase().replace(/-/g, ' ').replace(/\band\b/g, ' ');
  const tokens = normalized.split(/\s+/).map(cleanSpokenToken).filter(Boolean);
  if (!tokens.length) return null;

  if (tokens.length === 1) {
    const n = numberFromSpokenPhrase(tokens[0]!);
    if (n == null) return null;
    return n < 100 ? expandTwoDigitYear(n) : n;
  }

  if (tokens[0] === 'nineteen' || tokens[0] === 'twenty') {
    const first = tokens[0] === 'nineteen' ? 1900 : 2000;
    const rest = numberFromSpokenPhrase(tokens.slice(1).join(' '));
    if (rest == null || rest < 0 || rest > 99) return null;
    return first + rest;
  }

  if (tokens.length === 2) {
    const first = numberFromSpokenPhrase(tokens[0]!);
    const second = numberFromSpokenPhrase(tokens[1]!);
    if (first === 19 && second != null && second >= 0 && second <= 99) return 1900 + second;
    if (first === 20 && second != null && second >= 0 && second <= 99) return 2000 + second;
  }

  const summedYear = numberFromSpokenPhrase(tokens.join(' '));
  if (summedYear != null && summedYear >= 0 && summedYear < 100) {
    return expandTwoDigitYear(summedYear);
  }

  const digits = tokens.map((token) => CARDINAL_WORDS[token]).filter((value) => value != null);
  if (digits.length === tokens.length && digits.every((value) => value >= 0 && value <= 9)) {
    const value = Number(digits.join(''));
    return value < 100 ? expandTwoDigitYear(value) : value;
  }

  return null;
}

function monthFromSpokenPhrase(phrase: string): number | null {
  const direct = monthFromToken(phrase);
  if (direct) return direct;
  const n = numberFromSpokenPhrase(phrase);
  return n != null && n >= 1 && n <= 12 ? n : null;
}

function stripOrdinals(s: string): string {
  return s.replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, '$1');
}

/**
 * Match "26 February 2005", "26th February 2005", "26 feb 2005"
 */
function tryDayMonthYearWords(text: string): string | null {
  const t = stripOrdinals(text).replace(/\s+/g, ' ').trim();
  const re = /^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/i;
  const m = t.match(re);
  if (!m) return null;
  const day = Number(m[1]);
  const month = monthFromToken(m[2]!);
  const year = Number(m[3]);
  if (!month || !isValidCalendarDate(year, month, day)) return null;
  return formatIsoDateOnly(year, month, day);
}

/**
 * "February 26 2005", "Feb 26, 2005", "February 26th, 2005", "February the 26th 2005"
 */
function tryMonthDayYearWords(text: string): string | null {
  const t = stripOrdinals(text).replace(/\s+/g, ' ').trim();
  const re = /^([a-z]+)\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i;
  const m = t.match(re);
  if (!m) return null;
  const month = monthFromToken(m[1]!);
  const day = Number(m[2]);
  const year = Number(m[3]);
  if (!month || !isValidCalendarDate(year, month, day)) return null;
  return formatIsoDateOnly(year, month, day);
}

/**
 * "Feb 26 2005" after normalizing — same as month day year.
 * "2005 February 26"
 */
function tryYearMonthDayWords(text: string): string | null {
  const t = stripOrdinals(text).replace(/\s+/g, ' ').trim();
  const re = /^(\d{4})\s+([a-z]+)\s+(\d{1,2})$/i;
  const m = t.match(re);
  if (!m) return null;
  const year = Number(m[1]);
  const month = monthFromToken(m[2]!);
  const day = Number(m[3]);
  if (!month || !isValidCalendarDate(year, month, day)) return null;
  return formatIsoDateOnly(year, month, day);
}

function trySpokenDobWords(text: string): string | null {
  const t = stripOrdinals(text)
    .toLowerCase()
    .replace(/[-,]/g, ' ')
    .replace(/\b(?:the|of)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || /\d/.test(t)) return null;

  const tokens = t.split(/\s+/).map(cleanSpokenToken).filter(Boolean);
  if (tokens.length < 3 || tokens.length > 6) return null;

  const build = (dayPhrase: string, monthPhrase: string, yearPhrase: string): string | null => {
    const day = numberFromSpokenPhrase(dayPhrase);
    const month = monthFromSpokenPhrase(monthPhrase);
    const year = yearFromSpokenPhrase(yearPhrase);
    if (day == null || month == null || year == null) return null;
    if (!isValidCalendarDate(year, month, day)) return null;
    return formatIsoDateOnly(year, month, day);
  };

  for (let dayEnd = 1; dayEnd <= Math.min(2, tokens.length - 2); dayEnd += 1) {
    for (let monthEnd = dayEnd + 1; monthEnd <= Math.min(dayEnd + 2, tokens.length - 1); monthEnd += 1) {
      const iso = build(
        tokens.slice(0, dayEnd).join(' '),
        tokens.slice(dayEnd, monthEnd).join(' '),
        tokens.slice(monthEnd).join(' '),
      );
      if (iso) return iso;
    }
  }

  for (let monthEnd = 1; monthEnd <= Math.min(2, tokens.length - 2); monthEnd += 1) {
    for (let dayEnd = monthEnd + 1; dayEnd <= Math.min(monthEnd + 2, tokens.length - 1); dayEnd += 1) {
      const iso = build(
        tokens.slice(monthEnd, dayEnd).join(' '),
        tokens.slice(0, monthEnd).join(' '),
        tokens.slice(dayEnd).join(' '),
      );
      if (iso) return iso;
    }
  }

  return null;
}

function normalizeForDateParse(text: string): string {
  return stripOrdinals(text)
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip common spoken / chat prefixes so "born on 26 feb 2005" parses like "26 feb 2005". */
function stripConversationalDobContext(text: string): string {
  let t = text.replace(/\s+/g, ' ').trim();
  const filler = /^(?:yeah|yep|yes|ok|okay|uh+|um+|well|so|actually|basically|like|you know|i mean)\b[,.\s]*/i;
  for (let i = 0; i < 4; i++) {
    const next = t.replace(filler, '').trim();
    if (next === t) break;
    t = next;
  }

  const patterns: RegExp[] = [
    /^(?:(?:my|the|meri|mera)\s+)?(?:date\s+of\s+birth|d\.?o\.?b\.?|birth\s*date|birthday|janam\s*tithi|paidaish\s+ki\s+tareekh)\s*(?:is|was|hai|thi|:)?\s*/i,
    /^(?:i\s*was|i'?m)\s+born\s*(?:on|in)?\s*/i,
    /^was\s+born\s*(?:on|in)?\s*/i,
    /^born\s*(?:on|in)?\s*/i,
    /^(?:it(?:'s|\s+is)|that(?:'s|\s+is))\s*/i,
  ];
  for (const re of patterns) {
    const u = t.replace(re, '').trim();
    if (u.length > 0 && u.length < t.length) t = u;
  }

  t = t.replace(/^(?:the|a)\s+/i, '').trim();
  t = t.replace(/\s+(?:hai|hain|hi|ji|please|thanks?|thank you|you know)\s*\.?$/i, '').trim();

  return t;
}

function collectEmbeddedDateSnippets(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: string | undefined) => {
    const v = (s ?? '').replace(/\s+/g, ' ').trim();
    if (v.length >= 6 && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  };

  const src = text;
  const isoWord = /\b\d{4}-\d{2}-\d{2}\b/g;
  let m: RegExpExecArray | null;
  while ((m = isoWord.exec(src))) push(m[0]);

  const numericTriplet = /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g;
  while ((m = numericTriplet.exec(src))) push(m[0]);

  const dmyWord =
    /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s*,?\s+\d{4}\b/gi;
  while ((m = dmyWord.exec(src))) push(m[0]);

  const mdyWord =
    /\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(?:the\s+)?\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b/gi;
  while ((m = mdyWord.exec(src))) push(m[0]);

  const ymdWord = /\b\d{4}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+\d{1,2}(?:st|nd|rd|th)?\b/gi;
  while ((m = ymdWord.exec(src))) push(m[0]);

  return out;
}

function buildParseCandidates(raw: string): string[] {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return [];

  const stripped = stripConversationalDobContext(trimmed);
  const collapsed = trimmed.replace(/\s+/g, ' ').trim();
  const strippedCollapsed = stripped.replace(/\s+/g, ' ').trim();

  const ordinalCollapsed = trimmed
    .replace(/\s+/g, ' ')
    .replace(/\b(\d{1,2})(st|nd|rd|th)?\s+of\s+/gi, '$1 ')
    .trim();

  const pieces = trimmed
    .split(/(?:\s*[,;|]\s*|\s+-\s+|\s+—\s+|\s+and\s+|\s+or\s+)/i)
    .map((p) => p.trim())
    .filter((p) => p.length >= 6);

  const embedded = collectEmbeddedDateSnippets(trimmed);
  if (stripped !== trimmed) embedded.push(...collectEmbeddedDateSnippets(stripped));

  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const c of [
    strippedCollapsed,
    stripped,
    ordinalCollapsed,
    collapsed,
    trimmed,
    ...embedded,
    ...pieces,
  ]) {
    const v = c.replace(/\s+/g, ' ').trim();
    if (v.length >= 6 && !seen.has(v)) {
      seen.add(v);
      ordered.push(v);
    }
  }
  return ordered;
}

function tryEcmaDateParse(text: string): string | null {
  const candidate = normalizeForDateParse(text);
  if (!candidate) return null;
  const parsed = new Date(candidate);
  const t = parsed.getTime();
  if (Number.isNaN(t)) return null;
  const y = parsed.getFullYear();
  const mo = parsed.getMonth() + 1;
  const d = parsed.getDate();
  if (!isValidCalendarDate(y, mo, d)) return null;
  return formatIsoDateOnly(y, mo, d);
}

/** Only when input is not a pure numeric triplet (handled above) to avoid engine-specific reordering. */
function tryLooseEnglishDateParse(text: string): string | null {
  const candidate = normalizeForDateParse(text);
  if (!candidate || isPureNumericDateTriplet(candidate)) return null;
  return tryEcmaDateParse(candidate);
}

function tryParseSingleCandidate(candidate: string): string | null {
  const collapsed = candidate
    .replace(/\s+/g, ' ')
    .replace(/\b(\d{1,2})(st|nd|rd|th)?\s+of\s+/gi, '$1 ')
    .trim();

  const strategies: Array<() => string | null> = [
    () => tryIsoYmd(collapsed),
    () => tryIsoYmd(candidate),
    () => tryYmdNumeric(collapsed),
    () => tryDmyOrMdyNumeric(collapsed),
    () => tryDayMonthYearWords(collapsed),
    () => tryMonthDayYearWords(collapsed),
    () => tryYearMonthDayWords(collapsed),
    () => trySpokenDobWords(collapsed),
    () => tryLooseEnglishDateParse(collapsed),
    () => tryLooseEnglishDateParse(candidate),
  ];

  for (const fn of strategies) {
    const iso = fn();
    if (iso) return iso;
  }
  return null;
}

/**
 * Parse flexible caller DOB input to YYYY-MM-DD for comparison with stored persona DOB.
 */
export function parseCallerDobToIsoDate(raw: unknown): CallerDobParseResult {
  const text = String(raw ?? '').trim();
  if (!text) return { ok: false };

  for (const candidate of buildParseCandidates(text)) {
    const iso = tryParseSingleCandidate(candidate);
    if (iso) return { ok: true, isoDate: iso };
  }

  return { ok: false };
}
