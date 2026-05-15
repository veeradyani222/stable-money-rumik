/** Always-on console trail for OpenAI STT paths (not gated by DEBUG_LOG_ALL). */
export function logOpenAITranscriptionConsole(phase: string, details?: Record<string, unknown>) {
  console.log('[openai-transcription]', phase, {
    at: new Date().toISOString(),
    ...(details ?? {}),
  });
}
