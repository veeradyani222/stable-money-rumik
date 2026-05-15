export type VoiceCallState =
  | 'incoming'
  | 'idle'
  | 'calling'
  | 'connecting'
  | 'connected'
  | 'thinking'
  | 'speaking'
  | 'error';

export const VOICE_TURN_DETECTION = {
  silenceCutoffMs: 1100,
  minSpeechMs: 700,
  rmsThreshold: 0.028,
  preRollRmsThreshold: 0.012,
  requiredSpeechFrames: 3,
  preRollChunks: 4,
} as const;

export interface MicrophoneAudioGateInput {
  muted: boolean;
  callState: VoiceCallState;
  dataSize: number;
}

export function shouldSendMicrophoneAudio(input: MicrophoneAudioGateInput): boolean {
  if (input.muted || input.dataSize <= 0) return false;
  return input.callState === 'connected';
}

export interface MicrophonePreRollInput {
  rms: number;
  threshold: number;
}

export function shouldKeepMicrophonePreRoll(input: MicrophonePreRollInput): boolean {
  return input.rms >= input.threshold;
}
