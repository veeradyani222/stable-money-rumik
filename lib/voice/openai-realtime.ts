import { OPENAI_ROMAN_TRANSCRIPT_PROMPT } from './openai-transcribe';

/**
 * Realtime `session.audio.input.transcription.prompt` is only valid for legacy-style Whisper ids.
 * GPT / realtime / transcribe SKUs reject it. `OPENAI_REALTIME_TRANSCRIPTION_USE_PROMPT=false` (or
 * `off`) disables the hint even when the model id would otherwise allow it.
 */
export function realtimeTranscriptionModelSupportsPrompt(model: string): boolean {
  const flag = process.env.OPENAI_REALTIME_TRANSCRIPTION_USE_PROMPT?.trim().toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'off') return false;

  const m = model.toLowerCase();
  if (m.startsWith('gpt-') || m.includes('realtime') || m.includes('transcribe') || !m.includes('whisper')) {
    return false;
  }

  return true;
}

export function realtimeTranscriptionModelSupportsTurnDetection(model: string): boolean {
  return model.trim().toLowerCase() !== 'gpt-realtime-whisper';
}

export interface OpenAIRealtimeClientSecret {
  value: string;
  expires_at?: number;
}

interface OpenAIRealtimeTranscriptionSessionResponse {
  value?: string;
  expires_at?: number;
  client_secret?: OpenAIRealtimeClientSecret | null;
}

export class OpenAIRealtimeError extends Error {
  status: number;
  details: string;

  constructor(status: number, details: string, message = 'OpenAI Realtime token failed') {
    super(message);
    this.name = 'OpenAIRealtimeError';
    this.status = status;
    this.details = details;
  }
}

export function buildOpenAIRealtimeClientSecretRequest() {
  const transcriptionModel =
    process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL?.trim() ||
    process.env.OPENAI_STT_MODEL?.trim() ||
    'gpt-4o-mini-transcribe';
  const transcriptionLanguage = process.env.OPENAI_REALTIME_TRANSCRIBE_LANGUAGE?.trim();
  const transcription: {
    model: string;
    prompt?: string;
    language?: string;
  } = {
    model: transcriptionModel,
    ...(transcriptionLanguage ? { language: transcriptionLanguage } : {}),
  };
  if (realtimeTranscriptionModelSupportsPrompt(transcriptionModel)) {
    transcription.prompt = OPENAI_ROMAN_TRANSCRIPT_PROMPT;
  }

  return {
    session: {
      type: 'transcription',
      audio: {
        input: {
          transcription,
          turn_detection: realtimeTranscriptionModelSupportsTurnDetection(transcriptionModel)
            ? {
                type: 'server_vad',
                threshold: 0.5,
                prefix_padding_ms: 300,
                silence_duration_ms: 400,
                interrupt_response: false,
                create_response: false,
              }
            : null,
        },
      },
    },
  };
}

export async function createOpenAIRealtimeClientSecret(input: {
  safetyIdentifier?: string;
} = {}): Promise<OpenAIRealtimeClientSecret> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const message = 'Missing required environment variable: OPENAI_API_KEY';
    throw new OpenAIRealtimeError(500, message, message);
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (input.safetyIdentifier) {
    headers['OpenAI-Safety-Identifier'] = input.safetyIdentifier;
  }

  const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers,
    body: JSON.stringify(buildOpenAIRealtimeClientSecretRequest()),
  });

  const details = await response.text();
  if (!response.ok) {
    throw new OpenAIRealtimeError(response.status, details);
  }

  const parsed = JSON.parse(details) as OpenAIRealtimeTranscriptionSessionResponse;
  const value = parsed.value ?? parsed.client_secret?.value;
  if (!value) {
    throw new OpenAIRealtimeError(response.status, details, 'OpenAI Realtime token response was missing a value');
  }

  return {
    value,
    expires_at: parsed.expires_at ?? parsed.client_secret?.expires_at,
  };
}
