import { normalizeOpenAITranscript } from '@/lib/voice/transcript-text';

interface OpenAITranscribeResponse {
  text?: string;
}

export class OpenAITranscribeError extends Error {
  status: number;
  details: string;

  constructor(status: number, details: string, message = 'OpenAI transcription failed') {
    super(message);
    this.name = 'OpenAITranscribeError';
    this.status = status;
    this.details = details;
  }
}

export const OPENAI_TRANSCRIPT_PROMPT =
  'Transcribe the complete user utterance from this call audio. Preserve the user language and script as spoken or typed, including Devanagari, Bangla, Gurmukhi, Urdu, Arabic, Tamil, Telugu, Kannada, Malayalam, Gujarati, Marathi, English, Hindi, Hinglish, or mixed script. Return only transcript text, no markdown, no labels. Do not omit any words. Do not add any words. If the audio is not clear, return your best guess for the complete utterance.';

function getSttModel(): string {
  return process.env.OPENAI_STT_MODEL || 'gpt-4o-mini-transcribe';
}

export async function transcribeOpenAIAudio(input: {
  data: Buffer;
  mimeType: string;
  filename?: string;
}): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const message = 'Missing required environment variable: OPENAI_API_KEY';
    throw new OpenAITranscribeError(500, message, message);
  }

  const model = getSttModel();

  const formData = new FormData();
  formData.append('file', new File([new Uint8Array(input.data)], input.filename ?? 'audio.webm', { type: input.mimeType }));
  formData.append('model', model);
  formData.append('response_format', 'json');
  formData.append('temperature', '0');
  formData.append('prompt', OPENAI_TRANSCRIPT_PROMPT);

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    const details = await response.text();
    throw new OpenAITranscribeError(response.status, details);
  }

  const transcript = normalizeOpenAITranscript(((await response.json()) as OpenAITranscribeResponse).text ?? '');
  return transcript;
}
