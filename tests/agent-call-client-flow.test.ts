import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const clientSource = fs.readFileSync(
  path.join(process.cwd(), 'components', 'agent', 'AgentCallClient.tsx'),
  'utf8',
);
const respondStreamSource = fs.readFileSync(
  path.join(process.cwd(), 'app', 'api', 'agent', 'respond-stream', 'route.ts'),
  'utf8',
);
const openAiAgentSource = fs.readFileSync(
  path.join(process.cwd(), 'lib', 'agent', 'openai-agent.ts'),
  'utf8',
);
const timingLogRouteSource = fs.readFileSync(
  path.join(process.cwd(), 'app', 'api', 'voice', 'timing-log', 'route.ts'),
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
  const prefetchEndIndex = clientSource.indexOf('function prefetchAudioCache', prefetchIndex);
  const prefetchSource = clientSource.slice(prefetchIndex, prefetchEndIndex);

  assert.match(clientSource, /openingAudioCache/);
  assert.doesNotMatch(prefetchSource, /socket\?\.send\(JSON\.stringify\(packet\)\)/);
  assert.notEqual(prefetchIndex, -1);
  assert.notEqual(startCallIndex, -1);
  assert.ok(prefetchIndex < startCallIndex);
});

test('agent call client prefetches randomized thinking filler audio before turns need it', () => {
  const prefetchIndex = clientSource.indexOf('void prefetchThinkingFillerAudio();');
  const askAgentIndex = clientSource.indexOf('const askAgent = useCallback');
  const cacheIndex = clientSource.indexOf('function prefetchAudioCache');
  const cacheEndIndex = clientSource.indexOf('function prefetchThinkingFillerAudio', cacheIndex);
  const cacheSource = clientSource.slice(cacheIndex, cacheEndIndex);

  assert.match(clientSource, /STABLE_THINKING_FILLERS/);
  assert.match(clientSource, /thinkingFillerAudioCaches/);
  assert.doesNotMatch(cacheSource, /socket\?\.send\(JSON\.stringify/);
  assert.notEqual(prefetchIndex, -1);
  assert.notEqual(askAgentIndex, -1);
  assert.ok(prefetchIndex < askAgentIndex);
});

test('cached thinking fillers are unique stable copy variants', () => {
  const fillerBlockMatch = clientSource.match(/const STABLE_THINKING_FILLERS = \[([\s\S]*?)\] as const;/);
  assert.ok(fillerBlockMatch);
  const fillers = [...fillerBlockMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);

  assert.ok(fillers.length >= 2);
  assert.equal(new Set(fillers).size, fillers.length);
  for (const filler of fillers) {
    assert.match(filler, /^\[neutral\] /);
  }
});

test('agent call client reports voice timing milestones to the timing route without console logging', () => {
  assert.doesNotMatch(timingLogRouteSource, /console\./);
  assert.match(clientSource, /postVoiceTiming/);
  assert.match(clientSource, /event: 'transcript_ready'/);
  assert.match(clientSource, /event: 'agent_fetch_start'/);
  assert.match(clientSource, /event: 'filler_playback_start'/);
  assert.match(clientSource, /event: 'filler_playback_end'/);
  assert.match(clientSource, /event: 'agent_first_delta'/);
  assert.match(clientSource, /event: 'agent_first_speakable_chunk'/);
  assert.match(clientSource, /event: 'rumik_answer_text_sent'/);
  assert.match(clientSource, /event: 'rumik_answer_first_audio_packet'/);
  assert.match(clientSource, /event: 'rumik_answer_first_audio_scheduled'/);
  assert.match(clientSource, /queueMs/);
  assert.match(clientSource, /delayMs/);
  assert.match(clientSource, /\/api\/voice\/timing-log/);
});

test('respond stream sends terminal turn policy from server route metadata', () => {
  assert.match(respondStreamSource, /event: 'policy'/);
  assert.match(respondStreamSource, /suppressFiller/);
  assert.match(respondStreamSource, /endCallAfterResponse/);
  assert.match(respondStreamSource, /conversation\.goodbye/);
});

test('respond stream sends server agent timing milestones over SSE without console logging', () => {
  assert.doesNotMatch(respondStreamSource, /console\./);
  assert.match(respondStreamSource, /debugEvent\.type === 'timing'/);
  assert.match(openAiAgentSource, /agent_start/);
  assert.match(openAiAgentSource, /route_resolved/);
  assert.match(openAiAgentSource, /openai_stream_request_start/);
  assert.match(openAiAgentSource, /openai_stream_response_ready/);
  assert.match(openAiAgentSource, /openai_stream_first_event/);
  assert.match(openAiAgentSource, /openai_stream_end/);
  assert.match(openAiAgentSource, /agent_finish/);
});

test('agent call client starts cached thinking filler immediately after the agent stream request', () => {
  const askAgentIndex = clientSource.indexOf('const askAgent = useCallback');
  const fetchIndex = clientSource.indexOf("fetch('/api/agent/respond-stream'", askAgentIndex);
  const fillerIndex = clientSource.indexOf('const thinkingFillerPlayback = playThinkingFillerAudio()', fetchIndex);
  const warmIndex = clientSource.indexOf('warmRumikSocket();', fetchIndex);
  const readStreamIndex = clientSource.indexOf('readAgentResponseStream(', fetchIndex);
  const policyGateIndex = clientSource.indexOf('const turnPolicy = createTurnPolicyGate', askAgentIndex);

  assert.notEqual(askAgentIndex, -1);
  assert.notEqual(fetchIndex, -1);
  assert.notEqual(fillerIndex, -1);
  assert.notEqual(warmIndex, -1);
  assert.notEqual(readStreamIndex, -1);
  assert.equal(policyGateIndex, -1);
  assert.ok(fetchIndex < fillerIndex);
  assert.ok(fillerIndex < readStreamIndex);
  assert.ok(fetchIndex < warmIndex);
});

test('agent call client starts the agent stream before warming Rumik voice', () => {
  const askAgentIndex = clientSource.indexOf('const askAgent = useCallback');
  const fetchIndex = clientSource.indexOf("fetch('/api/agent/respond-stream'", askAgentIndex);
  const warmIndex = clientSource.indexOf('warmRumikSocket();', askAgentIndex);

  assert.notEqual(askAgentIndex, -1);
  assert.notEqual(fetchIndex, -1);
  assert.notEqual(warmIndex, -1);
  assert.ok(fetchIndex < warmIndex);
});

test('agent call client ends terminal goodbye turns after response playback finishes', () => {
  const askAgentIndex = clientSource.indexOf('const askAgent = useCallback');
  const waitForBothIndex = clientSource.indexOf('await Promise.all([thinkingFillerPlayback, playbackQueue]);', askAgentIndex);
  const waitForTurnIndex = clientSource.indexOf('await waitForRumikPlaybackTurn();', waitForBothIndex);
  const terminalEndIndex = clientSource.indexOf('if (data.endCallAfterResponse', waitForTurnIndex);
  const endCallIndex = clientSource.indexOf('endCall();', terminalEndIndex);

  assert.notEqual(askAgentIndex, -1);
  assert.notEqual(waitForBothIndex, -1);
  assert.notEqual(waitForTurnIndex, -1);
  assert.notEqual(terminalEndIndex, -1);
  assert.notEqual(endCallIndex, -1);
  assert.ok(waitForBothIndex < waitForTurnIndex);
  assert.ok(waitForTurnIndex < terminalEndIndex);
  assert.ok(terminalEndIndex < endCallIndex);
});

test('agent call client queues answer audio without cutting the thinking filler mid-sentence', () => {
  const askAgentIndex = clientSource.indexOf('const askAgent = useCallback');
  const fillerIndex = clientSource.indexOf('const thinkingFillerPlayback = playThinkingFillerAudio()', askAgentIndex);
  const queueIndex = clientSource.indexOf('let playbackQueue = Promise.resolve();', fillerIndex);
  const firstChunkIndex = clientSource.indexOf('if (!isFirstStreamChunk)', queueIndex);
  const queueAfterFillerIndex = clientSource.indexOf("playRumikText(chunk, { resetPlayback: false, waitForCompletion: false, timingLabel: 'answer' })", firstChunkIndex);
  const waitForBothIndex = clientSource.indexOf('await Promise.all([thinkingFillerPlayback, playbackQueue]);', queueAfterFillerIndex);
  const firstChunkSource = clientSource.slice(firstChunkIndex, waitForBothIndex);

  assert.notEqual(askAgentIndex, -1);
  assert.notEqual(fillerIndex, -1);
  assert.notEqual(queueIndex, -1);
  assert.notEqual(firstChunkIndex, -1);
  assert.notEqual(queueAfterFillerIndex, -1);
  assert.notEqual(waitForBothIndex, -1);
  assert.ok(fillerIndex < queueIndex);
  assert.ok(queueIndex < queueAfterFillerIndex);
  assert.ok(queueAfterFillerIndex < waitForBothIndex);
  assert.doesNotMatch(firstChunkSource, /cutActiveThinkingFiller/);
  assert.doesNotMatch(firstChunkSource, /resetPlayback: true/);
});

test('agent call client queues fallback answers before waiting for the thinking filler to finish', () => {
  const askAgentIndex = clientSource.indexOf('const askAgent = useCallback');
  const fallbackIndex = clientSource.indexOf("fetch('/api/agent/respond'", askAgentIndex);
  const speakAnswerIndex = clientSource.indexOf("const answerPlayback = playRumikText(answer, { resetPlayback: false, waitForCompletion: false, timingLabel: 'answer' });", fallbackIndex);
  const waitForBothIndex = clientSource.indexOf('await Promise.all([thinkingFillerPlayback, answerPlayback]);', speakAnswerIndex);
  const waitForTurnIndex = clientSource.indexOf('await waitForRumikPlaybackTurn();', waitForBothIndex);
  const fallbackEndIndex = clientSource.indexOf('return;', waitForTurnIndex);
  const fallbackSource = clientSource.slice(fallbackIndex, fallbackEndIndex);

  assert.notEqual(askAgentIndex, -1);
  assert.notEqual(fallbackIndex, -1);
  assert.notEqual(speakAnswerIndex, -1);
  assert.notEqual(waitForBothIndex, -1);
  assert.notEqual(waitForTurnIndex, -1);
  assert.notEqual(fallbackEndIndex, -1);
  assert.ok(speakAnswerIndex < waitForBothIndex);
  assert.ok(waitForBothIndex < waitForTurnIndex);
  assert.doesNotMatch(fallbackSource, /cutActiveThinkingFiller/);
  assert.doesNotMatch(fallbackSource, /resetPlayback: true/);
  assert.doesNotMatch(fallbackSource, /await thinkingFillerPlayback;/);
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

test('agent call client exposes an accessible mobile persona drawer handle and outside-close backdrop', () => {
  assert.match(clientSource, /const \[isPersonaPanelOpen, setIsPersonaPanelOpen\] = useState\(false\);/);
  assert.match(clientSource, /className="mobile-panel-handle"/);
  assert.match(clientSource, /className="mobile-panel-backdrop"/);
  assert.match(clientSource, /aria-controls="agent-persona-panel"/);
  assert.match(clientSource, /aria-expanded=\{isPersonaPanelOpen\}/);
  assert.match(clientSource, /setIsPersonaPanelOpen\(true\)/);
  assert.match(clientSource, /setIsPersonaPanelOpen\(false\)/);
  assert.doesNotMatch(clientSource, /className="mobile-panel-toggle"/);
  assert.doesNotMatch(clientSource, /className="mobile-panel-close"/);
});

test('agent call client starts a fresh microphone recorder after confirmed speech', () => {
  const recorderStartIndex = clientSource.indexOf('utteranceRecorder.start(240)');
  const listeningIndex = clientSource.indexOf('setIsListening(true);', recorderStartIndex);

  assert.notEqual(recorderStartIndex, -1);
  assert.notEqual(listeningIndex, -1);
  assert.ok(recorderStartIndex < listeningIndex);
});

test('agent call client stops the utterance recorder before uploading audio', () => {
  const captureEndIndex = clientSource.lastIndexOf('isCapturingUtteranceRef.current = false;');
  const stopIndex = clientSource.indexOf('currentRecorder.stop()', captureEndIndex);
  const flushIndex = clientSource.indexOf('void flushUtterance()', captureEndIndex);

  assert.notEqual(captureEndIndex, -1);
  assert.notEqual(stopIndex, -1);
  assert.notEqual(flushIndex, -1);
  assert.ok(stopIndex < flushIndex);
});

test('agent call client keeps runtime source free of console logging', () => {
  assert.match(clientSource, /logVoiceDebug/);
  assert.doesNotMatch(clientSource, /console\.(?:log|debug|info|warn|error)\s*\(/);
  assert.match(clientSource, /rumik:socket:error/);
  assert.match(clientSource, /rumik:send:error/);
  assert.match(clientSource, /rumik:message:text:parse-error/);
  assert.match(clientSource, /realtime:sdp:error/);
  assert.match(clientSource, /agent:error/);
});

test('agent call client consumes agent route and tool SSE events without console logging', () => {
  assert.doesNotMatch(clientSource, /\[stable-agent:route\]/);
  assert.doesNotMatch(clientSource, /\[stable-agent:tool\]/);
  assert.doesNotMatch(clientSource, /console\.(?:log|debug|info|warn|error)\s*\(/);
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
  const doneAnswerSpeakIndex = clientSource.indexOf('if (!hasQueuedStreamAudio && answer)', askAgentIndex);

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

test('agent call client accepts bare four digit verification transcripts', () => {
  const gateIndex = clientSource.indexOf('function isInterruptibleTranscript');
  const askIndex = clientSource.indexOf('void askAgent(utterance);', gateIndex);

  assert.notEqual(gateIndex, -1);
  assert.notEqual(askIndex, -1);
  assert.match(clientSource.slice(gateIndex, askIndex), /replace\(\/\\D\/g, ''\)/);
  assert.match(clientSource.slice(gateIndex, askIndex), /(?:\^|\\b)\\d\{4\}(?:\$|\\b)/);
  assert.match(clientSource.slice(gateIndex, askIndex), /return true;/);
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
