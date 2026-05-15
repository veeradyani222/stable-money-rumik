import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const clientSource = fs.readFileSync(
  path.join(process.cwd(), 'components', 'agent', 'AgentCallClient.tsx'),
  'utf8',
);

test('agent call client prewarms and reuses one Rumik socket across turns', () => {
  assert.match(clientSource, /ensureRumikSocket/);
  assert.match(clientSource, /warmRumikSocket/);
  assert.doesNotMatch(clientSource, /message\.type === 'done'[\s\S]{0,120}socket\.close\(\)/);
});

test('agent call client starts opening playback after realtime transcription is armed', () => {
  const startCallIndex = clientSource.indexOf('const startCall = useCallback');
  const getUserMediaIndex = clientSource.indexOf('navigator.mediaDevices.getUserMedia', startCallIndex);
  const connectRealtimeIndex = clientSource.indexOf('await connectOpenAIRealtimeTranscription(stream)', getUserMediaIndex);
  const connectedStateIndex = clientSource.indexOf("callStateRef.current = 'connected';", connectRealtimeIndex);
  const realtimeSyncIndex = clientSource.indexOf('syncRealtimeMicrophoneTrack(mutedRef.current, callStateRef.current);', connectedStateIndex);
  const openingPlaybackIndex = clientSource.indexOf('const openingPlayback = playOpeningAudio()', startCallIndex);

  assert.notEqual(startCallIndex, -1);
  assert.notEqual(getUserMediaIndex, -1);
  assert.notEqual(connectRealtimeIndex, -1);
  assert.notEqual(connectedStateIndex, -1);
  assert.notEqual(realtimeSyncIndex, -1);
  assert.notEqual(openingPlaybackIndex, -1);
  assert.ok(getUserMediaIndex < connectRealtimeIndex);
  assert.ok(connectRealtimeIndex < realtimeSyncIndex);
  assert.ok(realtimeSyncIndex < openingPlaybackIndex);
});

test('agent call client prefetches fixed opening audio before the call starts', () => {
  const prefetchIndex = clientSource.indexOf('void prefetchOpeningAudio();');
  const startCallIndex = clientSource.indexOf('const startCall = useCallback');

  assert.match(clientSource, /openingAudioCache/);
  assert.match(clientSource, /rumik:opening-cache:send-text/);
  assert.notEqual(prefetchIndex, -1);
  assert.notEqual(startCallIndex, -1);
  assert.ok(prefetchIndex < startCallIndex);
});

test('agent call client prefetches randomized thinking filler audio before turns need it', () => {
  const prefetchIndex = clientSource.indexOf('void prefetchThinkingFillerAudio();');
  const askAgentIndex = clientSource.indexOf('const askAgent = useCallback');

  assert.match(clientSource, /STABLE_THINKING_FILLERS/);
  assert.match(clientSource, /thinkingFillerAudioCaches/);
  assert.notEqual(prefetchIndex, -1);
  assert.notEqual(askAgentIndex, -1);
  assert.ok(prefetchIndex < askAgentIndex);
});

test('agent call client starts answer audio before the thinking filler finishes', () => {
  const askAgentIndex = clientSource.indexOf('const askAgent = useCallback');
  const fillerIndex = clientSource.indexOf('const thinkingFillerPlayback = playThinkingFillerAudio()', askAgentIndex);
  const queueIndex = clientSource.indexOf('let playbackQueue = Promise.resolve();', fillerIndex);
  const noResetIndex = clientSource.indexOf('playRumikText(chunk, { resetPlayback: false, waitForCompletion: false })', queueIndex);
  const waitForBothIndex = clientSource.indexOf('await Promise.all([thinkingFillerPlayback, playbackQueue]);', noResetIndex);

  assert.notEqual(askAgentIndex, -1);
  assert.notEqual(fillerIndex, -1);
  assert.notEqual(queueIndex, -1);
  assert.notEqual(noResetIndex, -1);
  assert.notEqual(waitForBothIndex, -1);
  assert.ok(fillerIndex < queueIndex);
  assert.ok(queueIndex < noResetIndex);
  assert.ok(noResetIndex < waitForBothIndex);
});

test('agent call client prefers cached opening playback instead of regenerating it on start', () => {
  assert.match(clientSource, /playCachedOpeningAudio/);
  assert.match(clientSource, /const openingPlayback = playOpeningAudio\(\)/);
  assert.match(clientSource, /await openingPlayback/);
  assert.doesNotMatch(clientSource, /warmRumikSocket\(STABLE_DEFAULT_OPENING\)/);
});

test('agent call client does not wait for unfinished opening cache before speaking', () => {
  const playOpeningIndex = clientSource.indexOf('const playOpeningAudio = useCallback');
  const playOpeningEndIndex = clientSource.indexOf('}, [playCachedOpeningAudio, playRumikText]);', playOpeningIndex);
  const playOpeningSource = clientSource.slice(playOpeningIndex, playOpeningEndIndex);

  assert.notEqual(playOpeningIndex, -1);
  assert.notEqual(playOpeningEndIndex, -1);
  assert.doesNotMatch(playOpeningSource, /await prefetchOpeningAudio\(\)/);
  assert.match(playOpeningSource, /if \(await playCachedOpeningAudio\(\)\) return;/);
  assert.match(playOpeningSource, /await playRumikText\(STABLE_DEFAULT_OPENING/);
});

test('agent call client can play opening cache while it is still loading', () => {
  assert.match(clientSource, /openingAudioCache\.waiters/);
  assert.match(clientSource, /openingAudioCache\.chunks\.length < 1/);
  assert.doesNotMatch(clientSource, /openingAudioCache\.status !== 'ready' \|\| openingAudioCache\.chunks\.length < 1/);
});

test('agent call client refreshes the opening cache timeout while audio is arriving', () => {
  const prefetchIndex = clientSource.indexOf('function prefetchOpeningAudio');
  const prefetchEndIndex = clientSource.indexOf('function prefetchAudioCache', prefetchIndex);
  const prefetchSource = clientSource.slice(prefetchIndex, prefetchEndIndex);

  assert.notEqual(prefetchIndex, -1);
  assert.notEqual(prefetchEndIndex, -1);
  assert.match(prefetchSource, /const refreshOpeningCacheTimeout = \(\) =>/);
  assert.match(prefetchSource, /refreshOpeningCacheTimeout\(\);[\s\S]*socket = new WebSocket/);
  assert.match(prefetchSource, /textPackets \+= 1;[\s\S]*refreshOpeningCacheTimeout\(\);/);
  assert.match(prefetchSource, /binaryPackets \+= 1;[\s\S]*refreshOpeningCacheTimeout\(\);/);
  assert.match(prefetchSource, /rumik:opening-cache:timeout/);
});

test('agent call client preserves every cached opening audio packet', () => {
  const playCachedOpeningIndex = clientSource.indexOf('const playCachedOpeningAudio = useCallback');
  const playCachedOpeningEndIndex = clientSource.indexOf('}, [stopRumikAudio]);', playCachedOpeningIndex);
  const playCachedOpeningSource = clientSource.slice(playCachedOpeningIndex, playCachedOpeningEndIndex);

  assert.notEqual(playCachedOpeningIndex, -1);
  assert.notEqual(playCachedOpeningEndIndex, -1);
  assert.doesNotMatch(playCachedOpeningSource, /silent-leading-drop/);
  assert.doesNotMatch(playCachedOpeningSource, /RUMIK_LEADING_SILENCE_RMS_THRESHOLD/);
});

test('agent call client preserves every fallback opening audio packet', () => {
  const playOpeningIndex = clientSource.indexOf('const playOpeningAudio = useCallback');
  const playOpeningEndIndex = clientSource.indexOf('}, [playCachedOpeningAudio, playRumikText]);', playOpeningIndex);
  const playOpeningSource = clientSource.slice(playOpeningIndex, playOpeningEndIndex);

  assert.notEqual(playOpeningIndex, -1);
  assert.notEqual(playOpeningEndIndex, -1);
  assert.match(playOpeningSource, /playRumikText\(STABLE_DEFAULT_OPENING, \{ trimLeadingSilence: false \}\)/);
});

test('agent call client does not add internal connection status to the visible transcript', () => {
  assert.doesNotMatch(clientSource, /appendTranscript\('system', `Connected as/);
});

test('agent call client starts a fresh microphone recorder after confirmed speech', () => {
  const speechStartIndex = clientSource.indexOf("logVoiceDebug('vad:speech-start'");
  const recorderStartIndex = clientSource.indexOf('utteranceRecorder.start(240)', speechStartIndex - 500);

  assert.notEqual(speechStartIndex, -1);
  assert.notEqual(recorderStartIndex, -1);
  assert.ok(recorderStartIndex < speechStartIndex);
});

test('agent call client stops the utterance recorder before uploading audio', () => {
  const speechEndIndex = clientSource.indexOf("logVoiceDebug('vad:speech-end'");
  const stopIndex = clientSource.indexOf('currentRecorder.stop()', speechEndIndex);
  const flushIndex = clientSource.indexOf('void flushUtterance()', speechEndIndex);

  assert.notEqual(speechEndIndex, -1);
  assert.notEqual(stopIndex, -1);
  assert.notEqual(flushIndex, -1);
  assert.ok(stopIndex < flushIndex);
});

test('agent call client logs demo voice debug events and errors', () => {
  assert.match(clientSource, /logVoiceDebug/);
  assert.match(clientSource, /\[voice-debug\]/);
  assert.match(clientSource, /shouldLogDiagnosticEvent/);
  assert.match(clientSource, /console\.info\('\[voice-debug\]'/);
  assert.match(clientSource, /rumik:socket:error/);
  assert.match(clientSource, /rumik:send:error/);
  assert.match(clientSource, /rumik:message:text:parse-error/);
  assert.match(clientSource, /realtime:sdp:error/);
  assert.match(clientSource, /agent:error/);
  assert.doesNotMatch(clientSource, /console\.(?:log|debug|info|warn|error)\([^)]*token/);
});

test('agent call client prints agent route and tool decisions to the browser console', () => {
  assert.match(clientSource, /message\.event === 'route'/);
  assert.match(clientSource, /console\.info\('\[stable-agent:route\]', message\.data\)/);
  assert.match(clientSource, /message\.event === 'tool'/);
  assert.match(clientSource, /console\.info\('\[stable-agent:tool\]', message\.data\)/);
});

test('agent call client trims silent Rumik lead-in packets before speech starts', () => {
  assert.match(clientSource, /RUMIK_LEADING_SILENCE_RMS_THRESHOLD/);
  assert.match(clientSource, /rumikLeadingSilenceRef/);
  assert.match(clientSource, /rumik:message:binary:silent-leading-drop/);
});

test('agent call client waits for scheduled Rumik audio before returning to listening', () => {
  assert.match(clientSource, /pendingRumikSourcesRef/);
  assert.match(clientSource, /finishRumikPlaybackTurn/);
  assert.match(clientSource, /rumik:message:text:done-waiting-playback/);
  assert.doesNotMatch(clientSource, /message\.type === 'done'[\s\S]{0,220}setCallState\('connected'\)/);
});

test('agent call client speaks final done-only answers from tool-backed responses', () => {
  const askAgentIndex = clientSource.indexOf('const askAgent = useCallback');
  const appendAgentIndex = clientSource.indexOf("appendTranscript('agent', answer);", askAgentIndex);
  const awaitPlaybackIndex = clientSource.indexOf('await Promise.all([thinkingFillerPlayback, playbackQueue]);', appendAgentIndex);
  const doneAnswerSpeakIndex = clientSource.indexOf("logVoiceDebug('agent:stream:done-answer-speakable'", askAgentIndex);

  assert.notEqual(askAgentIndex, -1);
  assert.notEqual(appendAgentIndex, -1);
  assert.notEqual(awaitPlaybackIndex, -1);
  assert.notEqual(doneAnswerSpeakIndex, -1);
  assert.ok(doneAnswerSpeakIndex < awaitPlaybackIndex);
  assert.match(clientSource, /if \(!hasQueuedStreamAudio && answer\)/);
  assert.match(clientSource, /queueRumikChunk\(answer\)/);
});

test('agent call client persists verified status for the active call', () => {
  assert.match(clientSource, /callVerifiedRef/);
  assert.doesNotMatch(clientSource, /call_verified: callVerifiedRef\.current/);
  assert.match(clientSource, /call_id: callIdRef\.current/);
  assert.equal((clientSource.match(/if \(data\.verified\) callVerifiedRef\.current = true;/g) ?? []).length, 2);
  assert.match(clientSource, /callVerifiedRef\.current = false;/);
});

test('agent call client keeps the latest interruption instead of dropping it', () => {
  assert.match(clientSource, /pendingInterruptRef/);
  assert.match(clientSource, /stopRumikAudio\(\);/);
  assert.match(clientSource, /pendingInterruptRef\.current = text;/);
  assert.match(clientSource, /const pendingInterrupt = pendingInterruptRef\.current;/);
  assert.match(clientSource, /void askAgent\(pendingInterrupt\);/);
});

test('agent call client keeps realtime transcription live while assistant can be interrupted', () => {
  assert.match(clientSource, /shouldPauseRealtimeMicrophoneTrack/);
  assert.match(clientSource, /return !\['calling', 'connecting', 'connected', 'thinking', 'speaking'\]\.includes\(input\.callState\)/);
  assert.match(clientSource, /syncRealtimeMicrophoneTrack\(muted, callStateRef\.current\)/);
});

test('agent call client only treats completed transcript words as interruptions', () => {
  const realtimeMessageIndex = clientSource.indexOf("dataChannel.addEventListener('message'");
  const transcriptIndex = clientSource.indexOf('const utterance = getRealtimeTranscript(realtimeEvent);', realtimeMessageIndex);
  const askIndex = clientSource.indexOf('void askAgent(utterance);', transcriptIndex);

  assert.notEqual(realtimeMessageIndex, -1);
  assert.notEqual(transcriptIndex, -1);
  assert.notEqual(askIndex, -1);
  assert.ok(transcriptIndex < askIndex);
  assert.match(clientSource, /isInterruptibleTranscript\(utterance\)/);
});

test('agent call client stops stale assistant audio immediately on server VAD speech start', () => {
  const realtimeMessageIndex = clientSource.indexOf("dataChannel.addEventListener('message'");
  const speechStartedIndex = clientSource.indexOf("realtimeEvent.type === 'input_audio_buffer.speech_started'", realtimeMessageIndex);
  const bargeIndex = clientSource.indexOf("performRealtimeBargeIn('server-vad-speech-start')", speechStartedIndex);
  const transcriptIndex = clientSource.indexOf('const utterance = getRealtimeTranscript(realtimeEvent);', realtimeMessageIndex);

  assert.notEqual(realtimeMessageIndex, -1);
  assert.notEqual(speechStartedIndex, -1);
  assert.notEqual(bargeIndex, -1);
  assert.notEqual(transcriptIndex, -1);
  assert.ok(speechStartedIndex < bargeIndex);
  assert.ok(bargeIndex < transcriptIndex);
  assert.match(clientSource, /interruptionInProgressRef/);
});

test('agent call client closes the Rumik socket on barge-in so old chunks cannot leak', () => {
  const bargeInIndex = clientSource.indexOf('const performRealtimeBargeIn = useCallback');
  const closeIndex = clientSource.indexOf('closeRumikSocket();', bargeInIndex);
  const abortIndex = clientSource.indexOf('agentAbortControllerRef.current?.abort();', bargeInIndex);

  assert.notEqual(bargeInIndex, -1);
  assert.notEqual(closeIndex, -1);
  assert.notEqual(abortIndex, -1);
  assert.ok(closeIndex < abortIndex);
});

test('agent call client enables realtime mic after attaching the stream', () => {
  const connectIndex = clientSource.indexOf('const connectOpenAIRealtimeTranscription = useCallback');
  const addTrackIndex = clientSource.indexOf('peer.addTrack(track, stream);', connectIndex);
  const syncIndex = clientSource.indexOf('syncRealtimeMicrophoneTrack(mutedRef.current, callStateRef.current);', addTrackIndex);

  assert.notEqual(connectIndex, -1);
  assert.notEqual(addTrackIndex, -1);
  assert.notEqual(syncIndex, -1);
  assert.ok(addTrackIndex < syncIndex);
});

test('agent call client aborts stale streamed agent responses on interruption', () => {
  assert.match(clientSource, /agentAbortControllerRef/);
  assert.match(clientSource, /agentAbortControllerRef\.current\?\.abort\(\)/);
  assert.match(clientSource, /const controller = new AbortController\(\)/);
  assert.match(clientSource, /signal: controller\.signal/);
  assert.match(clientSource, /agent:interrupt:abort-current/);
  assert.match(clientSource, /agent:request:aborted/);
});

test('agent call client pauses microphone recorder while muted to avoid noisy drop logs', () => {
  assert.match(clientSource, /mic:muted:pause-recorder/);
  assert.match(clientSource, /mic:muted:resume-recorder/);
  assert.match(clientSource, /recorder\.pause\(\)/);
  assert.match(clientSource, /recorder\.resume\(\)/);
});

test('agent call client pauses microphone recorder while assistant is not listening', () => {
  assert.match(clientSource, /shouldPauseMicrophoneRecorder/);
  assert.match(clientSource, /mic:recorder:auto-pause/);
  assert.match(clientSource, /mic:recorder:auto-resume/);
});

test('agent call client does not record quiet room chunks before speech starts', () => {
  assert.match(clientSource, /latestMicRmsRef/);
  assert.match(clientSource, /createUtteranceRecorder/);
  assert.match(clientSource, /isCapturingUtteranceRef\.current = true/);
  assert.doesNotMatch(clientSource, /mic:chunk:preroll/);
  assert.doesNotMatch(clientSource, /mic:chunk:silence/);
});
