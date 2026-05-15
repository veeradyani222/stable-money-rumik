import { NextResponse } from 'next/server';

import { OpenAITranscribeError, transcribeOpenAIAudio } from '@/lib/voice/openai-transcribe';

export async function POST(request: Request) {
  const formData = await request.formData();
  const audioFile = formData.get('audio');
  if (!(audioFile instanceof File)) {
    return NextResponse.json({ error: 'Missing audio file' }, { status: 400 });
  }

  const bytes = Buffer.from(await audioFile.arrayBuffer());

  try {
    const transcript = await transcribeOpenAIAudio({
      data: bytes,
      mimeType: audioFile.type || 'audio/webm',
      filename: audioFile.name || 'utterance.webm',
    });

    return NextResponse.json({ transcript });
  } catch (error) {
    if (error instanceof OpenAITranscribeError) {
      return NextResponse.json({ error: error.message, details: error.details }, { status: error.status });
    }

    return NextResponse.json({ error: 'OpenAI transcription failed' }, { status: 500 });
  }
}
