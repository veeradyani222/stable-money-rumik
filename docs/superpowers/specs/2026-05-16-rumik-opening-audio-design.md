# Rumik Opening Audio Asset Design

## Goal

Reduce the delay before the first assistant line after the user answers an incoming Stable Money support call.

The opening line should play immediately after the user taps Answer. Voice activity detection must remain active, so the user can interrupt the assistant during the opener.

## Current Behavior

`AgentCallClient.tsx` already prefetches the fixed opening line from Rumik into an in-memory PCM cache. If that cache has chunks by call start, the opener plays from memory. If the cache is not ready, the client falls back to live Rumik text-to-speech generation.

That still leaves a latency path on reload, slow network, cache timeout, or any Rumik setup delay.

## Recommended Approach

Store the fixed Rumik-generated opening line as a static browser asset under `public/assets/audio/`.

After the user taps Answer, keep the startup order:

1. Request microphone permission.
2. Connect OpenAI realtime transcription so server VAD is armed.
3. Attach the local analyser and set the call to `connected`.
4. Enable the realtime microphone track according to mute and call state.
5. Play the local Rumik opening asset immediately.

The local asset becomes the primary opening playback path. The existing cached/live Rumik path remains as a fallback if the asset cannot load or play.

## VAD and Interruption

During the local opening asset, the call state should be `speaking`, matching current assistant playback behavior.

OpenAI realtime transcription stays connected and the microphone track remains enabled for `speaking`, so `input_audio_buffer.speech_started` can still trigger the existing barge-in flow. On barge-in, any active local opening audio must stop before the interrupted utterance is handled.

The legacy RMS VAD fallback should continue to listen only while the call is `connected`, as it does today.

## Implementation Notes

Add a constant for the static opener source, for example `/assets/audio/rumik-opening.mp3` or `/assets/audio/rumik-opening.wav`.

Add a local asset playback helper that:

- Uses `new Audio(src)` with `preload = 'auto'` and `playsInline`.
- Sets call state to `speaking` while the opener plays.
- Returns to `connected` after playback ends unless the call is idle or errored.
- Can be stopped by the existing audio stop/barge-in path.
- Resolves `false` on load or playback failure so the existing Rumik fallback can run.

Keep the existing `prefetchOpeningAudio()` code as fallback unless a later cleanup removes it deliberately.

## Testing

Update source-level tests in `tests/agent-call-client-flow.test.ts` to confirm:

- The static Rumik opening asset constant exists.
- `playOpeningAudio()` prefers the static asset before cached/live Rumik generation.
- Startup still connects realtime transcription and syncs the microphone track before opening playback.
- The barge-in/stop path stops local opening audio as well as Rumik audio.

Run the focused agent call flow test after implementation.
