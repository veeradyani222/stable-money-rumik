import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRnnoiseMicrophoneConstraints,
  prepareRnnoiseMicrophoneStream,
  type RnnoiseStreamEnhancer,
} from '../lib/voice/rnnoise-suppression';

test('buildRnnoiseMicrophoneConstraints requests browser cleanup and RNNoise-friendly audio', () => {
  assert.deepEqual(buildRnnoiseMicrophoneConstraints(), {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
    sampleRate: 48000,
  });
});

test('prepareRnnoiseMicrophoneStream uses an enhanced stream when RNNoise succeeds', async () => {
  const rawStream = { id: 'raw' } as MediaStream;
  const enhancedStream = { id: 'rnnoise' } as MediaStream;
  const enhancer: RnnoiseStreamEnhancer = async (stream) => {
    assert.equal(stream, rawStream);
    return { stream: enhancedStream, cleanup: () => undefined };
  };

  const prepared = await prepareRnnoiseMicrophoneStream(rawStream, enhancer);

  assert.equal(prepared.stream, enhancedStream);
  assert.equal(prepared.source, 'rnnoise');
  assert.equal(typeof prepared.cleanup, 'function');
});

test('prepareRnnoiseMicrophoneStream falls back to raw browser stream when RNNoise fails', async () => {
  const rawStream = { id: 'raw' } as MediaStream;
  const events: string[] = [];
  const enhancer: RnnoiseStreamEnhancer = async () => {
    throw new Error('wasm unavailable');
  };

  const prepared = await prepareRnnoiseMicrophoneStream(rawStream, enhancer, (event) => events.push(event));

  assert.equal(prepared.stream, rawStream);
  assert.equal(prepared.source, 'browser');
  assert.deepEqual(events, ['mic:rnnoise:fallback']);
});
