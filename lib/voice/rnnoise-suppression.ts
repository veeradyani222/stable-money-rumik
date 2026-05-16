export type RnnoiseSuppressionSource = 'rnnoise' | 'browser';

export interface PreparedRnnoiseMicrophoneStream {
  stream: MediaStream;
  source: RnnoiseSuppressionSource;
  cleanup: () => void;
}

export type RnnoiseStreamEnhancer = (stream: MediaStream) => Promise<{
  stream: MediaStream;
  cleanup: () => void;
}>;

type RnnoiseModule = {
  Rnnoise: {
    load: () => Promise<{
      frameSize: number;
      createDenoiseState: () => {
        processFrame: (frame: Float32Array) => void;
        destroy: () => void;
      };
    }>;
  };
};

type AudioContextWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

export function buildRnnoiseMicrophoneConstraints(): MediaTrackConstraints {
  return {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
    sampleRate: 48000,
  };
}

export async function prepareRnnoiseMicrophoneStream(
  rawStream: MediaStream,
  enhanceStream: RnnoiseStreamEnhancer = createRnnoiseSuppressedStream,
  logEvent?: (event: string, details?: Record<string, unknown>) => void,
): Promise<PreparedRnnoiseMicrophoneStream> {
  try {
    const enhanced = await enhanceStream(rawStream);
    logEvent?.('mic:rnnoise:enabled');
    return {
      stream: enhanced.stream,
      source: 'rnnoise',
      cleanup: enhanced.cleanup,
    };
  } catch (error) {
    logEvent?.('mic:rnnoise:fallback', {
      message: error instanceof Error ? error.message : 'RNNoise setup failed',
    });
    return {
      stream: rawStream,
      source: 'browser',
      cleanup: () => undefined,
    };
  }
}

export async function createRnnoiseSuppressedStream(rawStream: MediaStream): Promise<{
  stream: MediaStream;
  cleanup: () => void;
}> {
  const audioWindow = window as AudioContextWindow;
  const AudioContextConstructor = audioWindow.AudioContext || audioWindow.webkitAudioContext;
  if (!AudioContextConstructor) {
    throw new Error('AudioContext is unavailable');
  }

  const inputTrack = rawStream.getAudioTracks()[0];
  if (!inputTrack) {
    throw new Error('Microphone stream has no audio track');
  }

  const { Rnnoise } = (await import('@shiguredo/rnnoise-wasm')) as RnnoiseModule;
  const rnnoise = await Rnnoise.load();
  const denoiseState = rnnoise.createDenoiseState();
  const audioContext = new AudioContextConstructor({ sampleRate: 48000 });
  const source = audioContext.createMediaStreamSource(rawStream);
  const destination = audioContext.createMediaStreamDestination();
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  const frameSize = rnnoise.frameSize;
  let pending = new Float32Array(0);

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const output = event.outputBuffer.getChannelData(0);
    const combined = new Float32Array(pending.length + input.length);
    combined.set(pending);
    combined.set(input, pending.length);

    let readOffset = 0;
    let writeOffset = 0;
    while (readOffset + frameSize <= combined.length) {
      const frame = combined.slice(readOffset, readOffset + frameSize);
      denoiseState.processFrame(frame);
      output.set(frame.subarray(0, Math.min(frame.length, output.length - writeOffset)), writeOffset);
      readOffset += frameSize;
      writeOffset += frameSize;
    }

    pending = combined.slice(readOffset);
    if (writeOffset < output.length) {
      output.fill(0, writeOffset);
    }
  };

  source.connect(processor);
  processor.connect(destination);

  return {
    stream: destination.stream,
    cleanup: () => {
      processor.disconnect();
      source.disconnect();
      denoiseState.destroy();
      void audioContext.close();
    },
  };
}
