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

test('agent call client resumes the local mic analyser before opening playback', () => {
  const startCallIndex = clientSource.indexOf('const startCall = useCallback');
  const monitorContextIndex = clientSource.indexOf('const monitorContext = new AudioContext();', startCallIndex);
  const resumeIndex = clientSource.indexOf('await monitorContext.resume();', monitorContextIndex);
  const openingPlaybackIndex = clientSource.indexOf('const openingPlayback = playOpeningAudio()', monitorContextIndex);

  assert.notEqual(startCallIndex, -1);
  assert.notEqual(monitorContextIndex, -1);
  assert.notEqual(resumeIndex, -1);
  assert.notEqual(openingPlaybackIndex, -1);
  assert.ok(monitorContextIndex < resumeIndex);
  assert.ok(resumeIndex < openingPlaybackIndex);
});

test('agent call client does not prefetch generated opening audio', () => {
  assert.doesNotMatch(clientSource, /prefetchOpeningAudio/);
  assert.doesNotMatch(clientSource, /openingAudioCache/);
  assert.doesNotMatch(clientSource, /rumik:opening-cache/);
});

test('agent call client does not include thinking filler audio paths or generated filler copy', () => {
  assert.doesNotMatch(clientSource, /STABLE_THINKING_FILLERS/);
  assert.doesNotMatch(clientSource, /STATIC_RUMIK_(?:ALL_)?FILLER_SRCS/);
  assert.doesNotMatch(clientSource, /STATIC_RUMIK_MAIN_FILLER_SRCS/);
  assert.doesNotMatch(clientSource, /rumik-(?:main-)?filler-\d+\.wav/);
  assert.doesNotMatch(clientSource, /ThinkingFillerKind/);
  assert.doesNotMatch(clientSource, /prefetchThinkingFillerAudio/);
  assert.doesNotMatch(clientSource, /prefetchAudioCache/);
  assert.doesNotMatch(clientSource, /thinkingFillerAudioCaches/);
  assert.doesNotMatch(clientSource, /rumik:thinking-filler-cache/);
});

test('agent call client has no thinking filler playback helpers or call sites', () => {
  assert.doesNotMatch(clientSource, /playStaticThinkingFillerAudio/);
  assert.doesNotMatch(clientSource, /playThinkingFillerAudio/);
  assert.doesNotMatch(clientSource, /startImmediateVerificationFiller/);
  assert.doesNotMatch(clientSource, /startDelayedPostSpeechFiller/);
  assert.doesNotMatch(clientSource, /delayedPostSpeechFiller/);
  assert.doesNotMatch(clientSource, /immediateVerificationFiller/);
  assert.doesNotMatch(clientSource, /thinkingFillerPlayback/);
  assert.doesNotMatch(clientSource, /thinking-filler/);
  assert.doesNotMatch(clientSource, /verification-filler/);
  assert.doesNotMatch(clientSource, /post-speech-filler/);
});

test('agent call client reports voice timing milestones to the timing route without console logging', () => {
  assert.doesNotMatch(timingLogRouteSource, /console\./);
  assert.match(clientSource, /postVoiceTiming/);
  assert.match(clientSource, /event: 'transcript_ready'/);
  assert.match(clientSource, /event: 'agent_fetch_start'/);
  assert.doesNotMatch(clientSource, /event: 'filler_playback_start'/);
  assert.doesNotMatch(clientSource, /event: 'filler_playback_end'/);
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
  assert.doesNotMatch(respondStreamSource, /suppressFiller/);
  assert.match(respondStreamSource, /endCallAfterResponse/);
  assert.match(respondStreamSource, /conversation\.goodbye/);
});

test('respond stream no longer sends filler policy', () => {
  assert.doesNotMatch(respondStreamSource, /suppressFiller/);
  assert.match(respondStreamSource, /endCallAfterResponse: isTerminalGoodbye,/);
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

test('agent call client consumes timing and stream SSE events from respond-stream', () => {
  assert.match(clientSource, /message\.event === 'timing'/);
  assert.match(clientSource, /message\.event === 'stream'/);
  assert.match(clientSource, /serverElapsedMs/);
  assert.match(clientSource, /agent:stream:event/);
});

test('agent call client preserves stream error status for rate-limit recovery', () => {
  assert.match(clientSource, /class AgentResponseError extends Error/);
  assert.match(clientSource, /status\?: number/);
  const errorEventIndex = clientSource.indexOf("if (message.event === 'error')");
  const statusIndex = clientSource.indexOf("typeof message.data.status === 'number'", errorEventIndex);
  const throwIndex = clientSource.indexOf('throw new AgentResponseError', statusIndex);

  assert.notEqual(errorEventIndex, -1);
  assert.notEqual(statusIndex, -1);
  assert.notEqual(throwIndex, -1);
  assert.ok(errorEventIndex < statusIndex);
  assert.ok(statusIndex < throwIndex);
});

test('agent call client plays the 429 static fallback before retrying non-stream response', () => {
  const srcIndex = clientSource.indexOf("const STATIC_RUMIK_RATE_LIMIT_FALLBACK_SRC = '/assets/audio/rumik-429.wav';");
  const playHelperIndex = clientSource.indexOf('const playRateLimitFallbackAudio = useCallback');
  const catchIndex = clientSource.indexOf('} catch (agentError) {');
  const rateLimitGateIndex = clientSource.indexOf('agentError instanceof AgentResponseError && agentError.status === 429', catchIndex);
  const playbackIndex = clientSource.indexOf('await playRateLimitFallbackAudio();', rateLimitGateIndex);
  const fallbackRequestIndex = clientSource.indexOf("fetch('/api/agent/respond'", playbackIndex);
  const assetPath = path.join(process.cwd(), 'public', 'assets', 'audio', 'rumik-429.wav');

  assert.notEqual(srcIndex, -1);
  assert.notEqual(playHelperIndex, -1);
  assert.notEqual(catchIndex, -1);
  assert.notEqual(rateLimitGateIndex, -1);
  assert.notEqual(playbackIndex, -1);
  assert.notEqual(fallbackRequestIndex, -1);
  assert.ok(fs.existsSync(assetPath));
  assert.ok(rateLimitGateIndex < playbackIndex);
  assert.ok(playbackIndex < fallbackRequestIndex);
});

test('agent call client keeps the call connected after rate-limit fallback audio exhausts retries', () => {
  const catchIndex = clientSource.indexOf('} catch (agentError) {');
  const rateLimitPlayedIndex = clientSource.indexOf('let rateLimitFallbackPlayed = false;', catchIndex);
  const streamRateLimitIndex = clientSource.indexOf('rateLimitFallbackPlayed = await playRateLimitFallbackAudio();', rateLimitPlayedIndex);
  const fallbackCatchIndex = clientSource.indexOf('} catch (fallbackError) {', streamRateLimitIndex);
  const fallbackRateLimitIndex = clientSource.indexOf('rateLimitFallbackPlayed = await playRateLimitFallbackAudio();', fallbackCatchIndex);
  const recoverIndex = clientSource.indexOf('if (rateLimitFallbackPlayed) {', fallbackRateLimitIndex);
  const connectedRefIndex = clientSource.indexOf("callStateRef.current = 'connected';", recoverIndex);
  const connectedStateIndex = clientSource.indexOf("setCallState('connected');", connectedRefIndex);
  const returnIndex = clientSource.indexOf('return;', connectedStateIndex);
  const errorIndex = clientSource.indexOf("setCallState('error');", catchIndex);

  assert.notEqual(catchIndex, -1);
  assert.notEqual(rateLimitPlayedIndex, -1);
  assert.notEqual(streamRateLimitIndex, -1);
  assert.notEqual(fallbackCatchIndex, -1);
  assert.notEqual(fallbackRateLimitIndex, -1);
  assert.notEqual(recoverIndex, -1);
  assert.notEqual(connectedRefIndex, -1);
  assert.notEqual(connectedStateIndex, -1);
  assert.notEqual(returnIndex, -1);
  assert.notEqual(errorIndex, -1);
  assert.ok(catchIndex < rateLimitPlayedIndex);
  assert.ok(rateLimitPlayedIndex < streamRateLimitIndex);
  assert.ok(streamRateLimitIndex < fallbackCatchIndex);
  assert.ok(fallbackCatchIndex < fallbackRateLimitIndex);
  assert.ok(fallbackRateLimitIndex < recoverIndex);
  assert.ok(recoverIndex < connectedRefIndex);
  assert.ok(connectedStateIndex < returnIndex);
  assert.ok(returnIndex < errorIndex);
});

test('agent call client does not start filler before server policy arrives', () => {
  const askAgentIndex = clientSource.indexOf('const askAgent = useCallback');
  const fetchIndex = clientSource.indexOf("fetch('/api/agent/respond-stream'", askAgentIndex);
  const warmIndex = clientSource.indexOf('warmRumikSocket();', fetchIndex);
  const readStreamIndex = clientSource.indexOf('readAgentResponseStream(', fetchIndex);
  const policyCallbackIndex = clientSource.indexOf('(policy) => {', readStreamIndex);
  const policyGateIndex = clientSource.indexOf('const turnPolicy = createTurnPolicyGate', askAgentIndex);

  assert.notEqual(askAgentIndex, -1);
  assert.notEqual(fetchIndex, -1);
  assert.notEqual(warmIndex, -1);
  assert.notEqual(readStreamIndex, -1);
  assert.notEqual(policyCallbackIndex, -1);
  assert.equal(policyGateIndex, -1);
  assert.ok(readStreamIndex < policyCallbackIndex);
  assert.ok(fetchIndex < warmIndex);
  assert.doesNotMatch(clientSource.slice(fetchIndex, warmIndex), /Filler/);
  assert.doesNotMatch(clientSource.slice(policyCallbackIndex, policyCallbackIndex + 240), /suppressFiller|startThinkingFillerPlayback/);
});

test('agent call client does not start filler on speech stopped before transcript completion', () => {
  const realtimeMessageIndex = clientSource.indexOf("dataChannel.addEventListener('message'");
  const speechStoppedIndex = clientSource.indexOf("realtimeEvent.type === 'input_audio_buffer.speech_stopped'", realtimeMessageIndex);
  const transcriptCompletedIndex = clientSource.indexOf('const utterance = getRealtimeTranscript(realtimeEvent);', speechStoppedIndex);

  assert.notEqual(realtimeMessageIndex, -1);
  assert.notEqual(speechStoppedIndex, -1);
  assert.notEqual(transcriptCompletedIndex, -1);
  assert.doesNotMatch(clientSource.slice(speechStoppedIndex, transcriptCompletedIndex), /Filler|filler/);
});

test('agent call client has no delayed post-speech filler timer', () => {
  const askAgentIndex = clientSource.indexOf('const askAgent = useCallback');

  assert.notEqual(askAgentIndex, -1);
  assert.doesNotMatch(clientSource, /POST_SPEECH_FILLER_DELAY_MS/);
  assert.doesNotMatch(clientSource, /shouldUseDelayedPostSpeechFiller/);
  assert.doesNotMatch(clientSource, /delayedPostSpeechFillerTimerRef/);
  assert.doesNotMatch(clientSource, /delayedPostSpeechFillerRef/);
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
  const waitForPlaybackIndex = clientSource.indexOf('await playbackQueue;', askAgentIndex);
  const waitForTurnIndex = clientSource.indexOf('await waitForRumikPlaybackTurn();', waitForPlaybackIndex);
  const terminalEndIndex = clientSource.indexOf('if (data.endCallAfterResponse', waitForTurnIndex);
  const endCallIndex = clientSource.indexOf('endCall();', terminalEndIndex);

  assert.notEqual(askAgentIndex, -1);
  assert.notEqual(waitForPlaybackIndex, -1);
  assert.notEqual(waitForTurnIndex, -1);
  assert.notEqual(terminalEndIndex, -1);
  assert.notEqual(endCallIndex, -1);
  assert.ok(waitForPlaybackIndex < waitForTurnIndex);
  assert.ok(waitForTurnIndex < terminalEndIndex);
  assert.ok(terminalEndIndex < endCallIndex);
});

test('agent call client queues answer audio without waiting for filler playback', () => {
  const askAgentIndex = clientSource.indexOf('const askAgent = useCallback');
  const queueIndex = clientSource.indexOf('let playbackQueue = Promise.resolve();', askAgentIndex);
  const firstChunkIndex = clientSource.indexOf('if (!isFirstStreamChunk)', queueIndex);
  const queueAfterFillerIndex = clientSource.indexOf("playRumikText(chunk, { resetPlayback: false, waitForCompletion: false, timingLabel: 'answer' })", firstChunkIndex);
  const waitForPlaybackIndex = clientSource.indexOf('await playbackQueue;', queueAfterFillerIndex);
  const firstChunkSource = clientSource.slice(firstChunkIndex, waitForPlaybackIndex);

  assert.notEqual(askAgentIndex, -1);
  assert.notEqual(queueIndex, -1);
  assert.notEqual(firstChunkIndex, -1);
  assert.notEqual(queueAfterFillerIndex, -1);
  assert.notEqual(waitForPlaybackIndex, -1);
  assert.ok(queueIndex < queueAfterFillerIndex);
  assert.ok(queueAfterFillerIndex < waitForPlaybackIndex);
  assert.doesNotMatch(firstChunkSource, /cutActiveThinkingFiller/);
  assert.doesNotMatch(firstChunkSource, /resetPlayback: true/);
  assert.doesNotMatch(clientSource.slice(askAgentIndex, waitForPlaybackIndex), /thinkingFillerPlayback/);
});

test('agent call client only has static state restoration for opening and rate-limit audio', () => {
  const openingIndex = clientSource.indexOf('const playStaticOpeningAudio = useCallback');
  const rateLimitIndex = clientSource.indexOf('const playRateLimitFallbackAudio = useCallback');

  assert.notEqual(openingIndex, -1);
  assert.notEqual(rateLimitIndex, -1);
  assert.doesNotMatch(clientSource, /playStaticThinkingFillerAudio/);
});

test('agent call client queues fallback answers without waiting for filler playback', () => {
  const askAgentIndex = clientSource.indexOf('const askAgent = useCallback');
  const fallbackIndex = clientSource.indexOf("fetch('/api/agent/respond'", askAgentIndex);
  const speakAnswerIndex = clientSource.indexOf("const answerPlayback = playRumikText(answer, { resetPlayback: false, waitForCompletion: false, timingLabel: 'answer' });", fallbackIndex);
  const waitForAnswerIndex = clientSource.indexOf('await answerPlayback;', speakAnswerIndex);
  const waitForTurnIndex = clientSource.indexOf('await waitForRumikPlaybackTurn();', waitForAnswerIndex);
  const fallbackEndIndex = clientSource.indexOf('return;', waitForTurnIndex);
  const fallbackSource = clientSource.slice(fallbackIndex, fallbackEndIndex);

  assert.notEqual(askAgentIndex, -1);
  assert.notEqual(fallbackIndex, -1);
  assert.notEqual(speakAnswerIndex, -1);
  assert.notEqual(waitForAnswerIndex, -1);
  assert.notEqual(waitForTurnIndex, -1);
  assert.notEqual(fallbackEndIndex, -1);
  assert.ok(speakAnswerIndex < waitForAnswerIndex);
  assert.ok(waitForAnswerIndex < waitForTurnIndex);
  assert.doesNotMatch(fallbackSource, /cutActiveThinkingFiller/);
  assert.doesNotMatch(fallbackSource, /resetPlayback: true/);
  assert.doesNotMatch(fallbackSource, /await thinkingFillerPlayback;/);
  assert.doesNotMatch(fallbackSource, /thinkingFillerPlayback/);
});

test('agent call client starts the opening playback without warming generated audio', () => {
  assert.match(clientSource, /const openingPlayback = playOpeningAudio\(\)/);
  assert.match(clientSource, /await openingPlayback/);
  assert.doesNotMatch(clientSource, /warmRumikSocket\(STABLE_DEFAULT_OPENING\)/);
  assert.doesNotMatch(clientSource, /playCachedOpeningAudio/);
});

test('agent call client uses the static Rumik opening asset before live Rumik fallback', () => {
  const srcIndex = clientSource.indexOf("const STATIC_RUMIK_OPENING_SRC = '/assets/audio/rumik-opening.wav';");
  const playOpeningIndex = clientSource.indexOf('const playOpeningAudio = useCallback');
  const staticIndex = clientSource.indexOf('await playStaticOpeningAudio()', playOpeningIndex);
  const generatedIndex = clientSource.indexOf('await playRumikText(STABLE_DEFAULT_OPENING', playOpeningIndex);

  assert.notEqual(srcIndex, -1);
  assert.notEqual(playOpeningIndex, -1);
  assert.notEqual(staticIndex, -1);
  assert.notEqual(generatedIndex, -1);
  assert.ok(staticIndex < generatedIndex);
  assert.doesNotMatch(clientSource.slice(playOpeningIndex, generatedIndex), /playCachedOpeningAudio/);
});

test('agent call client stops static opening audio during assistant stop paths', () => {
  const refIndex = clientSource.indexOf('const staticOpeningAudioRef = useRef<HTMLAudioElement | null>(null);');
  const finishRefIndex = clientSource.indexOf('const staticOpeningFinishRef = useRef<(() => void) | null>(null);');
  const stopIndex = clientSource.indexOf('const stopRumikAudio = useCallback');
  const pauseIndex = clientSource.indexOf('staticOpeningAudioRef.current?.pause();', stopIndex);
  const finishIndex = clientSource.indexOf('staticOpeningFinishRef.current?.();', pauseIndex);
  const clearIndex = clientSource.indexOf('staticOpeningAudioRef.current = null;', finishIndex);

  assert.notEqual(refIndex, -1);
  assert.notEqual(finishRefIndex, -1);
  assert.notEqual(stopIndex, -1);
  assert.notEqual(pauseIndex, -1);
  assert.notEqual(finishIndex, -1);
  assert.notEqual(clearIndex, -1);
  assert.ok(stopIndex < pauseIndex);
  assert.ok(pauseIndex < finishIndex);
  assert.ok(finishIndex < clearIndex);
});

test('agent call client ignores raw server VAD while the static opener is playing', () => {
  const helperIndex = clientSource.indexOf('function shouldBargeInOnRealtimeSpeechStart');
  const staticGuardIndex = clientSource.indexOf('if (input.staticOpeningPlaying) return false;', helperIndex);
  const speechStartedIndex = clientSource.indexOf("realtimeEvent.type === 'input_audio_buffer.speech_started'");
  const shouldBargeIndex = clientSource.indexOf('shouldBargeInOnRealtimeSpeechStart({', speechStartedIndex);
  const staticInputIndex = clientSource.indexOf('staticOpeningPlaying: staticOpeningAudioRef.current !== null', shouldBargeIndex);

  assert.notEqual(helperIndex, -1);
  assert.notEqual(staticGuardIndex, -1);
  assert.notEqual(speechStartedIndex, -1);
  assert.notEqual(shouldBargeIndex, -1);
  assert.notEqual(staticInputIndex, -1);
  assert.ok(helperIndex < speechStartedIndex);
  assert.ok(speechStartedIndex < shouldBargeIndex);
});

test('agent call client uses local mic energy to stop the static opener at speech start', () => {
  const calibrationIndex = clientSource.indexOf('const STATIC_OPENING_ECHO_CALIBRATION_MS = 900;');
  const sampleMsIndex = clientSource.indexOf('const STATIC_OPENING_BARGE_IN_SAMPLE_MS = 60;');
  const helperIndex = clientSource.indexOf('function shouldStopStaticOpeningForMicRms');
  const timerRefIndex = clientSource.indexOf('const staticOpeningBargeInTimerRef = useRef<number | null>(null);');
  const echoRefIndex = clientSource.indexOf('const staticOpeningEchoFloorRef = useRef(0);');
  const intervalIndex = clientSource.indexOf('staticOpeningBargeInTimerRef.current = window.setInterval');
  const analyserIndex = clientSource.indexOf('analyser.getFloatTimeDomainData(data);', intervalIndex);
  const decisionIndex = clientSource.indexOf('shouldStopStaticOpeningForMicRms({', analyserIndex);
  const bargeIndex = clientSource.indexOf("performRealtimeBargeIn('static-opening-local-vad')", decisionIndex);

  assert.notEqual(calibrationIndex, -1);
  assert.notEqual(sampleMsIndex, -1);
  assert.notEqual(helperIndex, -1);
  assert.notEqual(timerRefIndex, -1);
  assert.notEqual(echoRefIndex, -1);
  assert.notEqual(intervalIndex, -1);
  assert.notEqual(analyserIndex, -1);
  assert.notEqual(decisionIndex, -1);
  assert.notEqual(bargeIndex, -1);
  assert.ok(helperIndex < intervalIndex);
  assert.ok(intervalIndex < bargeIndex);
});

test('agent call client filters static opener echo before accepting realtime transcript interruptions', () => {
  const echoHelperIndex = clientSource.indexOf('function isLikelyStaticOpeningEcho');
  const transcriptIndex = clientSource.indexOf('const utterance = getRealtimeTranscript(realtimeEvent);');
  const echoGateIndex = clientSource.indexOf('isLikelyStaticOpeningEcho(utterance)', transcriptIndex);
  const transcriptBargeIndex = clientSource.indexOf("performRealtimeBargeIn('realtime-transcript-completed')", echoGateIndex);
  const askIndex = clientSource.indexOf('void askAgent(utterance);', transcriptBargeIndex);

  assert.notEqual(echoHelperIndex, -1);
  assert.notEqual(transcriptIndex, -1);
  assert.notEqual(echoGateIndex, -1);
  assert.notEqual(transcriptBargeIndex, -1);
  assert.notEqual(askIndex, -1);
  assert.ok(echoHelperIndex < transcriptIndex);
  assert.ok(echoGateIndex < transcriptBargeIndex);
  assert.ok(transcriptBargeIndex < askIndex);
});

test('agent call client defers closing connecting Rumik sockets until open', () => {
  const closeSocketIndex = clientSource.indexOf('const closeRumikSocket = useCallback');
  const connectingIndex = clientSource.indexOf('socket?.readyState === WebSocket.CONNECTING', closeSocketIndex);
  const deferIndex = clientSource.indexOf('socketToClose.addEventListener(', connectingIndex);
  const openEventIndex = clientSource.indexOf("'open'", deferIndex);
  const closeIndex = clientSource.indexOf('socketToClose.close();', deferIndex);
  const connectingBlock = clientSource.slice(connectingIndex, closeIndex);

  assert.notEqual(closeSocketIndex, -1);
  assert.notEqual(connectingIndex, -1);
  assert.notEqual(deferIndex, -1);
  assert.notEqual(openEventIndex, -1);
  assert.notEqual(closeIndex, -1);
  assert.doesNotMatch(connectingBlock, /socket\.close\(\)/);
});

test('agent call client does not wait for generated opening cache before speaking', () => {
  const playOpeningIndex = clientSource.indexOf('const playOpeningAudio = useCallback');
  const playOpeningEndIndex = clientSource.indexOf('}, [playRumikText, playStaticOpeningAudio]', playOpeningIndex);
  const playOpeningSource = clientSource.slice(playOpeningIndex, playOpeningEndIndex);

  assert.notEqual(playOpeningIndex, -1);
  assert.notEqual(playOpeningEndIndex, -1);
  assert.doesNotMatch(playOpeningSource, /await prefetchOpeningAudio\(\)/);
  assert.doesNotMatch(playOpeningSource, /playCachedOpeningAudio/);
  assert.match(playOpeningSource, /await playRumikText\(STABLE_DEFAULT_OPENING/);
});

test('agent call client preserves every fallback opening audio packet', () => {
  const playOpeningIndex = clientSource.indexOf('const playOpeningAudio = useCallback');
  const playOpeningEndIndex = clientSource.indexOf('}, [playRumikText, playStaticOpeningAudio]', playOpeningIndex);
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

test('agent call client offers persona switching from the side panel and reloads the active call', () => {
  assert.match(clientSource, /import \{ PERSONAS \} from '@\/lib\/personas';/);
  assert.match(clientSource, /import \{ PersonaDetailModal \} from '@\/components\/onboarding\/PersonaDetailModal';/);
  assert.match(clientSource, /type PanelTab = 'persona' \| 'questions' \| 'changePersona';/);
  assert.match(clientSource, /const \[personaChangeError, setPersonaChangeError\] = useState\(''\);/);
  assert.match(clientSource, /const \[personaChangeSubmittingId, setPersonaChangeSubmittingId\] = useState<string \| null>\(null\);/);
  assert.match(clientSource, /const \[detailPersona, setDetailPersona\] = useState<PersonaSeed \| null>\(null\);/);
  assert.match(clientSource, /fetch\('\/api\/onboarding\/select-persona'/);
  assert.match(clientSource, /body: JSON\.stringify\(\{ session_id: session\.session_id, persona_id: personaId \}\)/);
  assert.match(clientSource, /window\.location\.assign\(`\/agent\?session_id=\$\{encodeURIComponent\(session\.session_id\)\}`\)/);
  assert.match(clientSource, /activeTab === 'changePersona'/);
  assert.match(clientSource, /Change persona/);
  assert.match(clientSource, /PERSONAS\.map\(\(persona\) =>/);
  assert.match(clientSource, /className=\{`persona-card persona-change-card/);
  assert.match(clientSource, /className="persona-card__body"/);
  assert.match(clientSource, /className="persona-card__name"/);
  assert.match(clientSource, /className="persona-card__details-btn"/);
  assert.match(clientSource, /onClick=\{\(\) => setDetailPersona\(persona\)\}/);
  assert.match(clientSource, /<PersonaDetailModal/);
  assert.match(clientSource, /await changePersona\(id\);/);
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

test('agent call client logs raw and normalized Rumik text at the TTS boundary', () => {
  const playIndex = clientSource.indexOf('const playRumikText = useCallback');
  const alwaysOnIndex = clientSource.indexOf('const ALWAYS_ON_VOICE_DEBUG_EVENTS = new Set');
  const normalizeIndex = clientSource.indexOf('const normalizedText = normalizeRumikText', playIndex);
  const logIndex = clientSource.indexOf("logVoiceDebug('rumik:normalize:text'", normalizeIndex);
  const packetIndex = clientSource.indexOf('const packet = { text: normalizedText.slice(0, 2000), speaker_id: 0 };', normalizeIndex);
  const sendIndex = clientSource.indexOf('socket.send(JSON.stringify(packet))', packetIndex);

  assert.notEqual(playIndex, -1);
  assert.notEqual(alwaysOnIndex, -1);
  assert.notEqual(normalizeIndex, -1);
  assert.notEqual(logIndex, -1);
  assert.notEqual(packetIndex, -1);
  assert.notEqual(sendIndex, -1);
  assert.match(clientSource.slice(alwaysOnIndex, normalizeIndex), /rumik:normalize:text/);
  assert.ok(playIndex < normalizeIndex);
  assert.ok(normalizeIndex < logIndex);
  assert.ok(logIndex < packetIndex);
  assert.ok(packetIndex < sendIndex);
  assert.match(clientSource.slice(logIndex, packetIndex), /rawText: text/);
  assert.match(clientSource.slice(logIndex, packetIndex), /normalizedText/);
  assert.match(clientSource.slice(logIndex, packetIndex), /changed: normalizedText !== text/);
});

test('agent call client logs that agent chunks are queued before Rumik normalization', () => {
  const alwaysOnIndex = clientSource.indexOf('const ALWAYS_ON_VOICE_DEBUG_EVENTS = new Set');
  const queueIndex = clientSource.indexOf('const queueRumikChunk = (chunk: string) =>');
  const chunkLogIndex = clientSource.indexOf("logVoiceDebug('agent:stream:chunk-before-rumik-normalize'", queueIndex);
  const playIndex = clientSource.indexOf('playRumikText(chunk, { resetPlayback: false', chunkLogIndex);

  assert.notEqual(alwaysOnIndex, -1);
  assert.notEqual(queueIndex, -1);
  assert.notEqual(chunkLogIndex, -1);
  assert.notEqual(playIndex, -1);
  assert.match(clientSource.slice(alwaysOnIndex, queueIndex), /agent:stream:chunk-before-rumik-normalize/);
  assert.ok(queueIndex < chunkLogIndex);
  assert.ok(chunkLogIndex < playIndex);
  assert.match(clientSource.slice(chunkLogIndex, playIndex), /rawChunk: chunk/);
  assert.match(clientSource.slice(chunkLogIndex, playIndex), /chunkChars: chunk\.length/);
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

test('agent call client retries stalled Rumik TTS text sends once', () => {
  assert.match(clientSource, /RUMIK_TTS_FIRST_AUDIO_TIMEOUT_MS/);
  assert.match(clientSource, /RUMIK_TTS_MAX_SEND_RETRIES/);
  assert.match(clientSource, /pendingRumikRequestQueueRef/);
  assert.match(clientSource, /scheduleFirstAudioWatchdog/);
  assert.match(clientSource, /rumik:send:first-audio-timeout:retry/);
  assert.match(clientSource, /rumik:send:first-audio-timeout:give-up/);
});

test('agent call client can schedule Rumik packets without an extra safety pad', () => {
  assert.match(clientSource, /scheduledAtRef\.current = Math\.max\(scheduledAtRef\.current, audioContextRef\.current\.currentTime\)/);
  assert.match(clientSource, /const startAt = Math\.max\(scheduledAtRef\.current, context\.currentTime\)/);
  assert.doesNotMatch(clientSource, /currentTime \+ 0\.04/);
  assert.doesNotMatch(clientSource, /context\.currentTime \+ 0\.02/);
});

test('agent call client speaks final done-only answers from tool-backed responses', () => {
  const askAgentIndex = clientSource.indexOf('const askAgent = useCallback');
  const appendAgentIndex = clientSource.indexOf("appendTranscript('agent', answer);", askAgentIndex);
  const awaitPlaybackIndex = clientSource.indexOf('await playbackQueue;', appendAgentIndex);
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

test('agent call client deduplicates transcript submissions before sending to the agent', () => {
  const refIndex = clientSource.indexOf('recentSubmittedUtteranceRef');
  const helperIndex = clientSource.indexOf('function shouldSkipDuplicateSubmittedUtterance');
  const askAgentIndex = clientSource.indexOf('const askAgent = useCallback');
  const skipIndex = clientSource.indexOf('shouldSkipDuplicateSubmittedUtterance({', askAgentIndex);
  const pendingIndex = clientSource.indexOf('if (respondingRef.current)', askAgentIndex);
  const appendIndex = clientSource.indexOf("appendTranscript('user', text);", askAgentIndex);
  const fetchIndex = clientSource.indexOf("fetch('/api/agent/respond-stream'", askAgentIndex);

  assert.notEqual(refIndex, -1);
  assert.notEqual(helperIndex, -1);
  assert.notEqual(askAgentIndex, -1);
  assert.notEqual(skipIndex, -1);
  assert.notEqual(pendingIndex, -1);
  assert.notEqual(appendIndex, -1);
  assert.notEqual(fetchIndex, -1);
  assert.ok(refIndex < askAgentIndex);
  assert.ok(skipIndex < pendingIndex);
  assert.ok(skipIndex < appendIndex);
  assert.ok(appendIndex < fetchIndex);
  assert.match(clientSource.slice(helperIndex, askAgentIndex), /NEAR_SIMULTANEOUS_UTTERANCE_WINDOW_MS/);
  assert.match(clientSource.slice(helperIndex, askAgentIndex), /DUPLICATE_UTTERANCE_WINDOW_MS/);
});

test('agent call client blocks double call starts from creating duplicate realtime streams', () => {
  const refIndex = clientSource.indexOf('callStartInFlightRef');
  const startCallIndex = clientSource.indexOf('const startCall = useCallback');
  const guardIndex = clientSource.indexOf('callStartInFlightRef.current', startCallIndex);
  const setIndex = clientSource.indexOf('callStartInFlightRef.current = true;', startCallIndex);
  const realtimeIndex = clientSource.indexOf('await connectOpenAIRealtimeTranscription(stream)', startCallIndex);

  assert.notEqual(refIndex, -1);
  assert.notEqual(startCallIndex, -1);
  assert.notEqual(guardIndex, -1);
  assert.notEqual(setIndex, -1);
  assert.notEqual(realtimeIndex, -1);
  assert.ok(refIndex < startCallIndex);
  assert.ok(guardIndex < setIndex);
  assert.ok(setIndex < realtimeIndex);
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
  assert.match(clientSource, /isInterruptibleTranscript\(input\.utterance\)/);
});

test('agent call client rejects tiny realtime fragments after assistant playback finishes', () => {
  const meaningfulHelperIndex = clientSource.indexOf('function isMeaningfulRealtimeTranscript');
  const helperIndex = clientSource.indexOf('function shouldAcceptRealtimeTranscript');
  const connectedBranchIndex = clientSource.indexOf("input.callState === 'connected'", helperIndex);
  const meaningfulGateIndex = clientSource.indexOf('return isMeaningfulRealtimeTranscript(input.utterance);', connectedBranchIndex);
  const realtimeMessageIndex = clientSource.indexOf("dataChannel.addEventListener('message'");
  const acceptGateIndex = clientSource.indexOf('shouldAcceptRealtimeTranscript({', realtimeMessageIndex);
  const askIndex = clientSource.indexOf('void askAgent(utterance);', acceptGateIndex);

  assert.notEqual(meaningfulHelperIndex, -1);
  assert.notEqual(helperIndex, -1);
  assert.notEqual(connectedBranchIndex, -1);
  assert.notEqual(meaningfulGateIndex, -1);
  assert.notEqual(acceptGateIndex, -1);
  assert.notEqual(askIndex, -1);
  assert.ok(meaningfulHelperIndex < helperIndex);
  assert.ok(acceptGateIndex < askIndex);
  assert.doesNotMatch(clientSource.slice(connectedBranchIndex, acceptGateIndex), /return input\.utterance\.length >= 2;/);
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

test('agent call client re-arms realtime transcription when the channel drops', () => {
  const reconnectRefIndex = clientSource.indexOf('const realtimeReconnectTimerRef = useRef<number | null>(null);');
  const connectIndex = clientSource.indexOf('const connectOpenAIRealtimeTranscription = useCallback');
  const scheduleIndex = clientSource.indexOf('const scheduleRealtimeReconnect', connectIndex);
  const channelCloseIndex = clientSource.indexOf("dataChannel.addEventListener('close'", connectIndex);
  const channelErrorIndex = clientSource.indexOf("dataChannel.addEventListener('error'", connectIndex);
  const peerStateIndex = clientSource.indexOf("peer.addEventListener('connectionstatechange'", connectIndex);
  const reconnectCallIndex = clientSource.indexOf('void connectOpenAIRealtimeTranscription(stream)', scheduleIndex);

  assert.notEqual(reconnectRefIndex, -1);
  assert.notEqual(scheduleIndex, -1);
  assert.notEqual(channelCloseIndex, -1);
  assert.notEqual(channelErrorIndex, -1);
  assert.notEqual(peerStateIndex, -1);
  assert.notEqual(reconnectCallIndex, -1);
  assert.ok(scheduleIndex < channelCloseIndex);
  assert.ok(scheduleIndex < reconnectCallIndex);
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
