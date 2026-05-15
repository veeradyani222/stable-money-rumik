# Terminal Goodbye Audio Design

## Goal

When the caller ends the conversation, Rumik should not play a cached thinking filler such as "main check kar rahi hoon." Rumik should speak the real goodbye response generated for that turn, then end the call automatically.

## Constraints

- The client must not use farewell keyword lists.
- The client must not run semantic matching on transcripts.
- Normal support turns should keep the fast cached thinking filler behavior.
- The goodbye response must finish playing before the call is torn down.

## Architecture

The server response stream becomes the source of truth for turn behavior. It emits early control metadata for the current turn, including whether cached filler is allowed and whether the client should end the call after speaking the response.

The client starts the streamed agent request immediately, but defers cached filler until it has either received the control metadata or a short grace period has elapsed. If the metadata says the turn is terminal, the client suppresses cached filler, streams/speaks the generated goodbye, waits for playback, and calls the existing `endCall()` cleanup path.

## Components

- `app/api/agent/respond-stream/route.ts`: include a stream policy signal derived from the existing agent/route decision.
- `components/agent/AgentCallClient.tsx`: defer filler playback, honor policy metadata, and end the call after terminal response playback.
- `tests/agent-call-client-flow.test.ts`: add source-level regression checks for terminal-turn filler suppression and post-playback hangup sequencing.

## Data Flow

1. User speech is transcribed by realtime transcription.
2. `askAgent()` sends the transcript to `/api/agent/respond-stream`.
3. The response stream sends early turn policy metadata.
4. If filler is allowed, the client plays cached thinking filler as it does today.
5. If filler is suppressed, the client waits for the generated response without canned audio.
6. The generated response audio is queued and played normally.
7. If the turn policy is terminal, the client calls `endCall()` only after queued playback and `waitForRumikPlaybackTurn()` complete.

## Error Handling

If the stream fails before policy metadata arrives, the existing fallback response path can still run. Cached filler should remain guarded by the same policy helper so failures do not accidentally play filler for a known terminal turn. If audio playback fails, the existing error path remains responsible for surfacing the failure.

## Testing

Add focused source-level tests matching the existing test style:

- The stream reader can surface non-delta policy metadata.
- `askAgent()` does not start `playThinkingFillerAudio()` before it has policy gating.
- Terminal turns skip cached filler.
- Terminal turns call `endCall()` after playback waits, not before the goodbye response has a chance to play.
