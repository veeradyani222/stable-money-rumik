import test from 'node:test';
import assert from 'node:assert/strict';

import {
  shouldKeepMicrophonePreRoll,
  shouldSendMicrophoneAudio,
  VOICE_TURN_DETECTION,
} from '../lib/voice/agent-audio';

test('shouldSendMicrophoneAudio blocks mic audio while Rumik is speaking', () => {
  assert.equal(shouldSendMicrophoneAudio({ muted: false, callState: 'speaking', dataSize: 320 }), false);
});

test('shouldSendMicrophoneAudio streams non-empty mic audio while connected', () => {
  assert.equal(shouldSendMicrophoneAudio({ muted: false, callState: 'connected', dataSize: 320 }), true);
});

test('shouldSendMicrophoneAudio blocks muted mic audio', () => {
  assert.equal(shouldSendMicrophoneAudio({ muted: true, callState: 'connected', dataSize: 320 }), false);
});

test('voice turn detection keeps responses quick while preserving pre-roll', () => {
  assert.equal(VOICE_TURN_DETECTION.silenceCutoffMs, 1100);
  assert.equal(VOICE_TURN_DETECTION.preRollChunks, 4);
  assert.equal(VOICE_TURN_DETECTION.preRollRmsThreshold, 0.012);
  assert.equal(VOICE_TURN_DETECTION.requiredSpeechFrames, 3);
});

test('shouldKeepMicrophonePreRoll ignores quiet room chunks', () => {
  assert.equal(shouldKeepMicrophonePreRoll({ rms: 0.004, threshold: 0.012 }), false);
});

test('shouldKeepMicrophonePreRoll keeps chunks that are close to speech', () => {
  assert.equal(shouldKeepMicrophonePreRoll({ rms: 0.018, threshold: 0.012 }), true);
});
