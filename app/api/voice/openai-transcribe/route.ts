import { NextResponse } from 'next/server';

import { shouldLogDiagnosticEvent } from '@/lib/diagnostics/log-filter';
import { logOpenAITranscriptionConsole } from '@/lib/voice/openai-transcription-console';
import { OpenAITranscribeError, transcribeOpenAIAudio } from '@/lib/voice/openai-transcribe';

function logOpenAITranscribeRoute(event: string, details?: Record<string, unknown>) {
  if (!shouldLogDiagnosticEvent({ event })) return;

  console.info('[openai-transcribe-route]', event, {
    at: new Date().toISOString(),
    ...(details ?? {}),
  });
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const audioFile = formData.get('audio');
  if (!(audioFile instanceof File)) {
    logOpenAITranscribeRoute('request:invalid', { reason: 'missing-audio-file' });
    logOpenAITranscriptionConsole('route:invalid', { reason: 'missing-audio-file' });
    return NextResponse.json({ error: 'Missing audio file' }, { status: 400 });
  }

  const bytes = Buffer.from(await audioFile.arrayBuffer());
  logOpenAITranscriptionConsole('route:request', {
    byteLength: bytes.length,
    mimeType: audioFile.type || 'audio/webm',
    filename: audioFile.name || 'utterance.webm',
  });

  try {
    const transcript = await transcribeOpenAIAudio({
      data: bytes,
      mimeType: audioFile.type || 'audio/webm',
      filename: audioFile.name || 'utterance.webm',
    });

    return NextResponse.json({ transcript });
  } catch (error) {
    if (error instanceof OpenAITranscribeError) {
      logOpenAITranscribeRoute('response:error', {
        status: error.status,
        message: error.message,
        detailsPreview: error.details.slice(0, 400),
      });
      logOpenAITranscriptionConsole('route:error', {
        status: error.status,
        message: error.message,
        detailsPreview: error.details.slice(0, 400),
      });
      return NextResponse.json({ error: error.message, details: error.details }, { status: error.status });
    }

    logOpenAITranscribeRoute('response:error', {
      status: 500,
      message: error instanceof Error ? error.message : 'Unknown transcription error',
    });
    logOpenAITranscriptionConsole('route:error', {
      status: 500,
      message: error instanceof Error ? error.message : 'Unknown transcription error',
    });
    return NextResponse.json({ error: 'OpenAI transcription failed' }, { status: 500 });
  }
}
