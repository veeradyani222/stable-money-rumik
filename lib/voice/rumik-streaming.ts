export interface RumikChunkBuffer {
  pending: string;
}

const MIN_COMMA_CHUNK_CHARS = 36;
const MAX_CHUNK_CHARS = 100;
const STRONG_BOUNDARY_PATTERN = /[.!?]\s+/;

export function createRumikChunkBuffer(): RumikChunkBuffer {
  return { pending: '' };
}

function findChunkBoundary(text: string): number {
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1] ?? '';
    if ((char === '.' || char === '!' || char === '?') && (!next || /\s/.test(next))) {
      return index + 1;
    }
    if (char === ',' && index + 1 >= MIN_COMMA_CHUNK_CHARS && /\s/.test(next)) {
      return index + 1;
    }
  }

  if (text.length < MAX_CHUNK_CHARS || STRONG_BOUNDARY_PATTERN.test(text)) return -1;

  const lastSpace = text.lastIndexOf(' ', MAX_CHUNK_CHARS);
  return lastSpace > MIN_COMMA_CHUNK_CHARS ? lastSpace : MAX_CHUNK_CHARS;
}

export function pushRumikTextDelta(buffer: RumikChunkBuffer, delta: string): string[] {
  buffer.pending += delta;
  const chunks: string[] = [];

  while (true) {
    const boundary = findChunkBoundary(buffer.pending);
    if (boundary < 0) break;

    const chunk = buffer.pending.slice(0, boundary).trim();
    buffer.pending = buffer.pending.slice(boundary).replace(/^\s+/, '');
    if (chunk) chunks.push(chunk);
  }

  return chunks;
}

export function flushRumikChunkBuffer(buffer: RumikChunkBuffer): string {
  const chunk = buffer.pending.trim();
  buffer.pending = '';
  return chunk;
}
