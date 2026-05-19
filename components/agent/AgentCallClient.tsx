'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import type { PersonaSuggestion, PersonaBrief } from '@/lib/agent/persona-suggestions';
import { buildPersonaDetailSections } from '@/lib/agent/persona-panel';
import { STABLE_DEFAULT_OPENING } from '@/lib/agent/stable-call-copy';
import type { PersonaSeed } from '@/lib/personas';
import { AgentAudioVisualizerBar, type AgentVisualizerSpeaker } from '@/components/agents-ui/agent-audio-visualizer-bar';
import {
  shouldSendMicrophoneAudio,
  VOICE_TURN_DETECTION,
  type VoiceCallState,
} from '@/lib/voice/agent-audio';
import { normalizeOpenAITranscript } from '@/lib/voice/transcript-text';
import { createRumikChunkBuffer, flushRumikChunkBuffer, pushRumikTextDelta } from '@/lib/voice/rumik-streaming';
import { extractRumikStartingTone, normalizeRumikText, type RumikTone } from '@/lib/voice/rumik-text';

type CallState = VoiceCallState;
type HistoryMessage = { role: 'user' | 'model'; text: string };
type TranscriptLine = { role: 'user' | 'agent' | 'system'; text: string };

interface AgentSessionPayload {
  session_id: string;
  email: string;
  persona: PersonaSeed;
  brief: PersonaBrief;
  suggestions: PersonaSuggestion[];
}

interface RumikSessionData {
  ws_url: string;
  token: string;
}

interface OpenAIRealtimeTokenData {
  client_secret?: string;
  expires_at?: number;
  error?: string;
}

interface OpenAIRealtimeTranscriptEvent {
  type?: string;
  transcript?: string;
  delta?: string;
}

interface AgentStreamResult {
  text: string;
  toolCalls: string[];
  verified?: boolean;
  endCallAfterResponse?: boolean;
}

interface AgentStreamMessage {
  event: string;
  data: Record<string, unknown>;
}

class AgentResponseError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'AgentResponseError';
    this.status = status;
  }
}

interface VoiceTimingTurn {
  id: string;
  startedAt: number;
  firstDeltaLogged: boolean;
  firstSpeakableLogged: boolean;
  firstAnswerTextSentLogged: boolean;
  firstAnswerAudioLogged: boolean;
  firstAnswerAudioScheduledLogged: boolean;
}

interface SubmittedUtteranceMarker {
  normalized: string;
  topic: string;
  submittedAt: number;
}

interface PendingRumikTtsRequest {
  id: number;
  packet: { text: string; speaker_id: number };
  playbackId: number;
  retryCount: number;
  receivedAudio: boolean;
  timer: number | null;
}

interface AgentTurnPolicy {
  endCallAfterResponse?: boolean;
}

type VerificationStatus = 'none' | 'checking' | 'mobile_matched' | 'mobile_failed' | 'dob_failed' | 'verified';

const RUMIK_LEADING_SILENCE_RMS_THRESHOLD = 0.004;
const RUMIK_MAX_LEADING_SILENCE_DROPS = 20;
const RUMIK_TTS_FIRST_AUDIO_TIMEOUT_MS = 7000;
const RUMIK_TTS_MAX_SEND_RETRIES = 1;
const USE_OPENAI_REALTIME_TRANSCRIPTION = true;
const VOICE_TIMING_LOGS_ENABLED = false;
const ALWAYS_ON_VOICE_DEBUG_EVENTS = new Set([
  'agent:stream:chunk-before-rumik-normalize',
  'rumik:normalize:text',
]);
const AGENT_CLIENT_HISTORY_LIMIT = 16;
/** Ringtones: MP3 only, from `public/assets/` → `/assets/…` */
const INCOMING_RINGTONE_SRC = '/assets/ringtone.mp3';
const OUTGOING_RINGTONE_SRC = '/assets/dragon-ringing.mp3';
const STATIC_RUMIK_OPENING_SRC = '/assets/audio/rumik-opening.wav';
const STATIC_RUMIK_RATE_LIMIT_FALLBACK_SRC = '/assets/audio/rumik-429.wav';
const STATIC_OPENING_ECHO_CALIBRATION_MS = 900;
const STATIC_OPENING_BARGE_IN_SAMPLE_MS = 60;
const STATIC_OPENING_BARGE_IN_REQUIRED_FRAMES = 2;
const STATIC_OPENING_BARGE_IN_MIN_RMS = 0.04;
const STATIC_OPENING_ECHO_DELTA_RMS = 0.022;
const STATIC_OPENING_ECHO_MULTIPLIER = 2.4;
const NEAR_SIMULTANEOUS_UTTERANCE_WINDOW_MS = 1200;
const DUPLICATE_UTTERANCE_WINDOW_MS = 3000;
const SHORT_REALTIME_REPLY_PATTERN =
  /(?:^|\s)(?:yes|yeah|yep|haan|han|ha|ji|ok|okay|no|nah|nahi|na|theek)(?:\s|$)|हाँ|हां|नहीं|ठीक|جی|ہاں|نہیں|ٹھیک|হ্যাঁ|না|ঠিক|ਹਾਂ|ਨਹੀਂ|ਠੀਕ/iu;
const SHORT_REALTIME_COMMAND_PATTERN =
  /fd|f\s*d|fixed|fix|deposit|payment|pay|paisa|paise|kyc|status|help|madad|balance|booking|book|refund|maturity|interest|rate|nominee|एफ\s*डी|फिक्स|फिक्स्ड|डिपॉजिट|डिपोजिट|जमा|पेमेंट|भुगतान|पैसा|मदद|स्टेटस|केवाईसी|ایف\s*ڈی|فکس|فکسڈ|ڈپاز|ڈپوز|جمع|پیمنٹ|ادائیگی|پیسہ|پیسے|مدد|اسٹیٹس|کے\s*وائی\s*سی|এফ\s*ডি|ফিক্স|ডিপোজিট|জমা|পেমেন্ট|টাকা|সাহায্য|স্ট্যাটাস|ਐਫ\s*ਡੀ|ਫਿਕਸ|ਡਿਪਾਜ|ਜਮ੍ਹਾ|ਪੇਮੈਂਟ|ਪੈਸਾ|ਮਦਦ|ਸਟੇਟਸ|எப்\s*டி|பணம்|உதவி|ಸ್ಥಿತಿ|ಹಣ|ಸಹಾಯ|డబ్బు|సహాయం|പണം|സഹായം/iu;
const FD_TOPIC_PATTERN =
  /fd|f\s*d|fixed|fix|deposit|एफ\s*डी|फिक्स|फिक्स्ड|डिपॉजिट|डिपोजिट|ایف\s*ڈی|فکس|فکسڈ|ڈپاز|ڈپوز|এফ\s*ডি|ফিক্স|ডিপোজিট|ਐਫ\s*ਡੀ|ਫਿਕਸ|ਡਿਪਾਜ|எப்\s*டி/iu;
const PAYMENT_TOPIC_PATTERN =
  /payment|pay|paisa|paise|refund|पेमेंट|भुगतान|पैसा|रिफंड|پیمنٹ|ادائیگی|پیسہ|پیسے|ریفنڈ|পেমেন্ট|টাকা|রিফান্ড|ਪੇਮੈਂਟ|ਪੈਸਾ|ਰਿਫੰਡ|பணம்|ಹಣ|డబ్బు|പണം/iu;
const KYC_TOPIC_PATTERN = /kyc|केवाईसी|के\s*वाई\s*सी|کے\s*وائی\s*سی|কেওয়াইসি|ਕੇ\s*ਵਾਈ\s*ਸੀ/iu;
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M15 18 9 12l6-6" />
    </svg>
  );
}

function PhoneOffIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" style={{ transform: 'rotate(135deg)' }}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 10.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function PhoneHandsetIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 10.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <path d="M12 19v3" />
    </svg>
  );
}

function MicOffIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M9 9v3a3 3 0 0 0 5.1 2.1" />
      <path d="M15 9V6a3 3 0 0 0-5.1-2.1" />
      <path d="M17 16.9A7 7 0 0 1 5 12v-2" />
      <path d="M19 10v2c0 1-.2 1.9-.6 2.7" />
      <path d="M12 19v3" />
      <path d="M2 2 22 22" />
    </svg>
  );
}

function pcm16ToAudioBuffer(audioContext: AudioContext, chunk: ArrayBuffer): AudioBuffer {
  const samples = new Int16Array(chunk);
  const buffer = audioContext.createBuffer(1, samples.length, 24000);
  const channel = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index += 1) {
    channel[index] = Math.max(-1, Math.min(1, samples[index] / 32768));
  }
  return buffer;
}

function getPcm16Rms(chunk: ArrayBuffer): number {
  const samples = new Int16Array(chunk);
  if (!samples.length) return 0;

  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index] / 32768;
    sum += value * value;
  }

  return Math.sqrt(sum / samples.length);
}

function logVoiceDebug(event: string, details?: Record<string, unknown>) {
  if (!VOICE_TIMING_LOGS_ENABLED && !ALWAYS_ON_VOICE_DEBUG_EVENTS.has(event)) return;
  const normalized = event.toLowerCase();
  const isWebsocketLog =
    normalized.includes('socket') ||
    normalized.includes('websocket') ||
    normalized.includes('ws:') ||
    normalized.includes('realtime:data-channel');
  if (isWebsocketLog) return;
  if (typeof window === 'undefined') return;

  const payload = JSON.stringify({
    event: `voice-debug:${event}`.slice(0, 80),
    details: details ?? {},
  });
  if (navigator.sendBeacon) {
    const sent = navigator.sendBeacon('/api/voice/timing-log', new Blob([payload], { type: 'application/json' }));
    if (sent) return;
  }
  void fetch('/api/voice/timing-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  }).catch(() => {});
}

function postVoiceTiming(input: {
  callId: string;
  turn: VoiceTimingTurn;
  event: string;
  details?: Record<string, unknown>;
}) {
  if (!VOICE_TIMING_LOGS_ENABLED) return;
  if (typeof window === 'undefined') return;

  const payload = {
    event: input.event,
    call_id: input.callId,
    turn_id: input.turn.id,
    elapsedMs: performance.now() - input.turn.startedAt,
    details: input.details ?? {},
  };

  const body = JSON.stringify(payload);
  if (navigator.sendBeacon) {
    const sent = navigator.sendBeacon('/api/voice/timing-log', new Blob([body], { type: 'application/json' }));
    if (sent) return;
  }

  void fetch('/api/voice/timing-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {});
}

function getRealtimeTranscript(event: OpenAIRealtimeTranscriptEvent): string {
  if (event.type !== 'conversation.item.input_audio_transcription.completed') return '';
  return typeof event.transcript === 'string' ? normalizeOpenAITranscript(event.transcript) : '';
}

function normalizeSubmittedUtterance(utterance: string): string {
  return utterance
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function getSubmittedUtteranceTopic(utterance: string, normalized: string): string {
  const searchable = `${utterance} ${normalized}`;
  if (FD_TOPIC_PATTERN.test(searchable)) return 'fd';
  if (PAYMENT_TOPIC_PATTERN.test(searchable)) return 'payment';
  if (KYC_TOPIC_PATTERN.test(searchable)) return 'kyc';
  return '';
}

function createSubmittedUtteranceMarker(utterance: string, now: number): SubmittedUtteranceMarker {
  const normalized = normalizeSubmittedUtterance(utterance);
  return {
    normalized,
    topic: getSubmittedUtteranceTopic(utterance, normalized),
    submittedAt: now,
  };
}

function shouldSkipDuplicateSubmittedUtterance(input: {
  utterance: string;
  recent: SubmittedUtteranceMarker | null;
  now: number;
}): { skip: boolean; marker: SubmittedUtteranceMarker; reason: string } {
  const marker = createSubmittedUtteranceMarker(input.utterance, input.now);
  const ageMs = input.recent ? input.now - input.recent.submittedAt : Number.POSITIVE_INFINITY;
  if (!input.recent || ageMs < 0) return { skip: false, marker, reason: '' };
  if (ageMs <= NEAR_SIMULTANEOUS_UTTERANCE_WINDOW_MS) return { skip: true, marker, reason: 'near-simultaneous' };
  if (ageMs <= DUPLICATE_UTTERANCE_WINDOW_MS && marker.normalized === input.recent.normalized) {
    return { skip: true, marker, reason: 'same-transcript' };
  }
  if (ageMs <= DUPLICATE_UTTERANCE_WINDOW_MS && marker.topic && marker.topic === input.recent.topic) {
    return { skip: true, marker, reason: `same-topic:${marker.topic}` };
  }
  return { skip: false, marker, reason: '' };
}

function isInterruptibleTranscript(utterance: string): boolean {
  const digits = utterance.replace(/\D/g, '');
  if (/^\d{4}$/.test(digits)) return true;
  const words = utterance.trim().split(/\s+/).filter(Boolean);
  return words.length >= 3;
}

function isMeaningfulRealtimeTranscript(utterance: string): boolean {
  const normalized = normalizeSubmittedUtterance(utterance);
  if (!normalized) return false;
  const digits = utterance.replace(/\D/g, '');
  if (/^\d{4}$/.test(digits)) return true;
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length >= 3) return true;
  if (SHORT_REALTIME_REPLY_PATTERN.test(utterance) || SHORT_REALTIME_REPLY_PATTERN.test(normalized)) return true;
  if (SHORT_REALTIME_COMMAND_PATTERN.test(utterance) || SHORT_REALTIME_COMMAND_PATTERN.test(normalized)) return true;
  return normalized.length >= 14;
}

function shouldAcceptRealtimeTranscript(input: {
  utterance: string;
  responding: boolean;
  callState: CallState;
}): boolean {
  if (input.responding || input.callState === 'thinking' || input.callState === 'speaking') {
    return isInterruptibleTranscript(input.utterance);
  }

  if (input.callState === 'connected') {
    return isMeaningfulRealtimeTranscript(input.utterance);
  }

  return false;
}

function normalizeRealtimeEchoText(text: string): string {
  return text
    .replace(/\[[^\]]+\]/g, ' ')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function isLikelyStaticOpeningEcho(utterance: string): boolean {
  const spoken = normalizeRealtimeEchoText(utterance);
  if (spoken.length < 8) return false;

  const opening = normalizeRealtimeEchoText(STABLE_DEFAULT_OPENING);
  return opening.includes(spoken) || spoken.includes(opening);
}

function shouldBargeInOnRealtimeSpeechStart(input: {
  responding: boolean;
  callState: CallState;
  staticOpeningPlaying: boolean;
}): boolean {
  if (input.staticOpeningPlaying) return false;
  return input.responding || input.callState === 'thinking' || input.callState === 'speaking';
}

function getFloatTimeDomainRms(data: Float32Array<ArrayBuffer>): number {
  let sum = 0;
  for (let index = 0; index < data.length; index += 1) {
    sum += data[index] * data[index];
  }
  return Math.sqrt(sum / data.length);
}

function getStaticOpeningBargeInThreshold(echoFloor: number): number {
  return Math.max(
    STATIC_OPENING_BARGE_IN_MIN_RMS,
    echoFloor + STATIC_OPENING_ECHO_DELTA_RMS,
    echoFloor * STATIC_OPENING_ECHO_MULTIPLIER,
  );
}

function shouldStopStaticOpeningForMicRms(input: {
  rms: number;
  echoFloor: number;
  openingAgeMs: number;
  speechFrameCount: number;
}): boolean {
  if (input.openingAgeMs < STATIC_OPENING_ECHO_CALIBRATION_MS) return false;
  if (input.speechFrameCount < STATIC_OPENING_BARGE_IN_REQUIRED_FRAMES) return false;
  return input.rms >= getStaticOpeningBargeInThreshold(input.echoFloor);
}

function parseAgentStreamBlock(block: string): AgentStreamMessage | null {
  let event = 'message';
  const dataLines: string[] = [];

  block.split(/\r?\n/).forEach((line) => {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  });

  if (!dataLines.length) return null;

  try {
    const data = JSON.parse(dataLines.join('\n')) as Record<string, unknown>;
    return { event, data };
  } catch {
    return null;
  }
}

async function readAgentResponseStream(
  response: Response,
  onDelta: (delta: string) => void,
  onPolicy?: (policy: AgentTurnPolicy) => void,
  onTiming?: (timing: { event: string; elapsedMs?: number; details?: Record<string, unknown> }) => void,
  onStream?: (event: Record<string, unknown>) => void,
  onTool?: (tool: Record<string, unknown>) => void,
): Promise<AgentStreamResult> {
  if (!response.body) throw new Error('Agent stream did not include a response body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let result: AgentStreamResult = { text: '', toolCalls: [] };

  while (true) {
    const { value, done } = await reader.read();
    pending += decoder.decode(value, { stream: !done });

    const blocks = pending.split(/\r?\n\r?\n/);
    pending = blocks.pop() ?? '';

    for (const block of blocks) {
      const message = parseAgentStreamBlock(block);
      if (!message) continue;
      if (message.event === 'delta') {
        const delta = typeof message.data.delta === 'string' ? message.data.delta : '';
        if (delta) onDelta(delta);
      }
      if (message.event === 'policy') {
        const policy = {
          endCallAfterResponse:
            typeof message.data.endCallAfterResponse === 'boolean' ? message.data.endCallAfterResponse : undefined,
        };
        result = { ...result, ...policy };
        onPolicy?.(policy);
      }
      if (message.event === 'timing') {
        const event = typeof message.data.event === 'string' ? message.data.event : '';
        if (event) {
          onTiming?.({
            event,
            elapsedMs: typeof message.data.elapsedMs === 'number' ? message.data.elapsedMs : undefined,
            details: message.data.details && typeof message.data.details === 'object'
              ? (message.data.details as Record<string, unknown>)
              : undefined,
          });
        }
      }
      if (message.event === 'stream') {
        onStream?.(message.data);
      }
      if (message.event === 'tool') {
        onTool?.(message.data);
      }
      if (message.event === 'done') {
        result = {
          text: typeof message.data.text === 'string' ? message.data.text : result.text,
          toolCalls: Array.isArray(message.data.toolCalls) ? message.data.toolCalls.map(String) : [],
          verified: typeof message.data.verified === 'boolean' ? message.data.verified : result.verified,
          endCallAfterResponse: result.endCallAfterResponse,
        };
      }
      if (message.event === 'error') {
        const status = typeof message.data.status === 'number' ? message.data.status : undefined;
        throw new AgentResponseError(typeof message.data.error === 'string' ? message.data.error : 'Agent stream failed', status);
      }
    }

    if (done) break;
  }

  return result;
}

function prefetchStaticAudio() {
  if (typeof Audio === 'undefined') return;
  [STATIC_RUMIK_RATE_LIMIT_FALLBACK_SRC].forEach((src) => {
    const audio = new Audio(src);
    audio.preload = 'auto';
    audio.load();
  });
}

function shouldPauseMicrophoneRecorder(input: { muted: boolean; callState: CallState }): boolean {
  return input.muted || input.callState !== 'connected';
}

function shouldPauseRealtimeMicrophoneTrack(input: { muted: boolean; callState: CallState }): boolean {
  if (input.muted) return true;
  return !['calling', 'connecting', 'connected', 'thinking', 'speaking'].includes(input.callState);
}

function isInactiveCallState(callState: CallState): boolean {
  return callState !== 'connected' && callState !== 'thinking' && callState !== 'speaking';
}

export function AgentCallClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id') ?? '';

  const [session, setSession] = useState<AgentSessionPayload | null>(null);
  const [sessionError, setSessionError] = useState('');
  const [hasEnteredCall, setHasEnteredCall] = useState(false);
  const [callState, setCallState] = useState<CallState>('idle');
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState('');
  const [duration, setDuration] = useState(0);
  const [interimText, setInterimText] = useState('');
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [playOutboundTone, setPlayOutboundTone] = useState(false);
  const [userVoiceVisual, setUserVoiceVisual] = useState(false);
  const [voiceAnalyser, setVoiceAnalyser] = useState<AnalyserNode | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>('none');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const analyserDataRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const vadTimerRef = useRef<number | null>(null);
  const speechStartedAtRef = useRef(0);
  const lastSpeechAtRef = useRef(0);
  const chunkPartsRef = useRef<Blob[]>([]);
  const isCapturingUtteranceRef = useRef(false);
  const flushAfterRecorderStopRef = useRef(false);
  const utteranceInFlightRef = useRef(false);
  const callStartInFlightRef = useRef(false);
  const recentSubmittedUtteranceRef = useRef<SubmittedUtteranceMarker | null>(null);
  const pendingSubmittedUtteranceRef = useRef<SubmittedUtteranceMarker | null>(null);
  const rumikRef = useRef<WebSocket | null>(null);
  const rumikReadyRef = useRef<Promise<WebSocket> | null>(null);
  const rumikDoneRef = useRef<(() => void) | null>(null);
  const pendingRumikRequestsRef = useRef(0);
  const pendingRumikRequestQueueRef = useRef<PendingRumikTtsRequest[]>([]);
  const pendingRumikSourcesRef = useRef(0);
  const rumikStreamDoneRef = useRef(false);
  const rumikToneRef = useRef<RumikTone>('neutral');
  const realtimePeerRef = useRef<RTCPeerConnection | null>(null);
  const realtimeDataChannelRef = useRef<RTCDataChannel | null>(null);
  const realtimeReconnectTimerRef = useRef<number | null>(null);
  const rumikSpeakingRef = useRef(false);
  const rumikPlaybackIdRef = useRef(0);
  const staticOpeningAudioRef = useRef<HTMLAudioElement | null>(null);
  const staticOpeningFinishRef = useRef<(() => void) | null>(null);
  const staticOpeningStartedAtRef = useRef(0);
  const staticOpeningBargeInTimerRef = useRef<number | null>(null);
  const staticOpeningEchoFloorRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const scheduledAtRef = useRef(0);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const historyRef = useRef<HistoryMessage[]>([]);
  const callVerifiedRef = useRef(false);
  const callIdRef = useRef('');
  const respondingRef = useRef(false);
  const pendingInterruptRef = useRef('');
  const agentAbortControllerRef = useRef<AbortController | null>(null);
  const interruptionInProgressRef = useRef(false);
  const mutedRef = useRef(muted);
  const callStateRef = useRef<CallState>(callState);
  const openingPlayedRef = useRef(false);
  const micPacketCountRef = useRef(0);
  const rumikTextPacketCountRef = useRef(0);
  const rumikBinaryPacketCountRef = useRef(0);
  const rumikTtsRequestIdRef = useRef(0);
  const transcriptionAttemptRef = useRef(0);
  const rumikLeadingSilenceRef = useRef({ trimming: true, dropped: 0 });
  const latestMicRmsRef = useRef(0);
  const activeVoiceTimingTurnRef = useRef<VoiceTimingTurn | null>(null);
  const callAbortRef = useRef<AbortController | null>(null);
  const rumikAnswerStreamActiveRef = useRef(false);

  const syncMicrophoneRecorder = useCallback((nextMuted: boolean, nextCallState: CallState) => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    const shouldPause = shouldPauseMicrophoneRecorder({ muted: nextMuted, callState: nextCallState });

    if (shouldPause && recorder.state === 'recording') {
      logVoiceDebug(nextMuted ? 'mic:muted:pause-recorder' : 'mic:recorder:auto-pause', {
        callState: nextCallState,
      });
      recorder.pause();
      return;
    }

    if (!shouldPause && recorder.state === 'paused') {
      logVoiceDebug(nextMuted ? 'mic:muted:resume-recorder' : 'mic:recorder:auto-resume', {
        callState: nextCallState,
      });
      recorder.resume();
    }
  }, []);

  const syncRealtimeMicrophoneTrack = useCallback((nextMuted: boolean, nextCallState: CallState) => {
    const stream = micStreamRef.current;
    if (!stream) return;
    const shouldPause = shouldPauseRealtimeMicrophoneTrack({ muted: nextMuted, callState: nextCallState });
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !shouldPause;
    });
  }, []);

  useEffect(() => {
    mutedRef.current = muted;
    syncMicrophoneRecorder(muted, callStateRef.current);
    syncRealtimeMicrophoneTrack(muted, callStateRef.current);
  }, [muted, syncMicrophoneRecorder, syncRealtimeMicrophoneTrack]);

  useEffect(() => {
    syncMicrophoneRecorder(mutedRef.current, callState);
    syncRealtimeMicrophoneTrack(mutedRef.current, callState);
  }, [callState, syncMicrophoneRecorder, syncRealtimeMicrophoneTrack]);

  useEffect(() => {
    callStateRef.current = callState;
    logVoiceDebug('call:state', { callState });

    if (callState !== 'idle' && typeof window !== 'undefined') {
      setTimeout(() => {
        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: 'smooth',
        });
      }, 100);
    }
  }, [callState]);

  useEffect(() => {
    prefetchStaticAudio();
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!sessionId) {
      setSessionError('Missing session_id. Please restart onboarding.');
      return;
    }

    fetch(`/api/agent/session?session_id=${encodeURIComponent(sessionId)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || 'Could not load session');
        return data as AgentSessionPayload;
      })
      .then((data) => {
        if (!cancelled) {
          setSession(data);
          setDuration(0);
          setCallState('idle');
        }
      })
      .catch((loadError) => {
        if (!cancelled) setSessionError(loadError?.message || 'Could not load session');
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!['calling', 'connecting', 'connected', 'thinking', 'speaking'].includes(callState)) {
      return undefined;
    }
    const timer = window.setInterval(() => setDuration((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [callState]);

  useEffect(() => {
    if (callState !== 'incoming') return undefined;
    const audio = new Audio(INCOMING_RINGTONE_SRC);
    audio.loop = true;
    audio.preload = 'auto';
    audio.setAttribute('playsInline', '');
    void audio.play().catch((playError) => {
      logVoiceDebug('ringtone:incoming:play-failed', {
        src: INCOMING_RINGTONE_SRC,
        message: playError instanceof Error ? playError.message : 'unknown',
      });
    });
    return () => {
      audio.pause();
      audio.removeAttribute('src');
    };
  }, [callState]);

  useEffect(() => {
    if (!playOutboundTone) return undefined;
    const audio = new Audio(OUTGOING_RINGTONE_SRC);
    audio.loop = true;
    audio.volume = 0.88;
    audio.preload = 'auto';
    audio.setAttribute('playsInline', '');
    void audio.play().catch((playError) => {
      logVoiceDebug('ringtone:outgoing:play-failed', {
        src: OUTGOING_RINGTONE_SRC,
        message: playError instanceof Error ? playError.message : 'unknown',
      });
    });
    return () => {
      audio.pause();
      audio.removeAttribute('src');
    };
  }, [playOutboundTone]);

  const appendTranscript = useCallback((role: TranscriptLine['role'], text: string) => {
    const cleanText = text.trim();
    if (!cleanText) return;
    setTranscript((lines) => [...lines.slice(-50), { role, text: cleanText }]);
  }, []);

  const finishRumikPlaybackTurn = useCallback(() => {
    if (rumikAnswerStreamActiveRef.current || !rumikStreamDoneRef.current || pendingRumikRequestsRef.current > 0 || pendingRumikSourcesRef.current > 0) return;

    rumikSpeakingRef.current = false;
    rumikDoneRef.current?.();
    rumikDoneRef.current = null;
    if (['speaking', 'thinking'].includes(callStateRef.current)) {
      callStateRef.current = 'connected';
      setCallState('connected');
    }
  }, []);

  const clearPendingRumikTtsRequest = useCallback((request: PendingRumikTtsRequest) => {
    if (request.timer !== null) {
      window.clearTimeout(request.timer);
      request.timer = null;
    }
  }, []);

  const stopRumikAudio = useCallback(() => {
    logVoiceDebug('rumik:playback:stop', { activeSources: sourcesRef.current.length });
    rumikPlaybackIdRef.current += 1;
    staticOpeningAudioRef.current?.pause();
    staticOpeningFinishRef.current?.();
    staticOpeningFinishRef.current = null;
    staticOpeningAudioRef.current = null;
    staticOpeningStartedAtRef.current = 0;
    staticOpeningEchoFloorRef.current = 0;
    if (staticOpeningBargeInTimerRef.current) {
      window.clearInterval(staticOpeningBargeInTimerRef.current);
      staticOpeningBargeInTimerRef.current = null;
    }
    rumikSpeakingRef.current = false;
    pendingRumikRequestQueueRef.current.forEach(clearPendingRumikTtsRequest);
    pendingRumikRequestQueueRef.current = [];
    pendingRumikRequestsRef.current = 0;
    pendingRumikSourcesRef.current = 0;
    rumikStreamDoneRef.current = true;
    rumikToneRef.current = 'neutral';
    rumikDoneRef.current?.();
    rumikDoneRef.current = null;
    sourcesRef.current.forEach((source) => {
      try {
        source.stop();
      } catch {
        // Already ended.
      }
    });
    sourcesRef.current = [];
    scheduledAtRef.current = audioContextRef.current?.currentTime ?? 0;
  }, [clearPendingRumikTtsRequest]);

  const closeRumikSocket = useCallback(() => {
    stopRumikAudio();
    const socket = rumikRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      const closePacket = { type: 'close' };
      logVoiceDebug('rumik:send:close', closePacket);
      socket.send(JSON.stringify(closePacket));
      socket.close();
    } else if (socket?.readyState === WebSocket.CONNECTING) {
      logVoiceDebug('rumik:close:connecting');
      const socketToClose = socket;
      socketToClose.addEventListener(
        'open',
        () => {
          socketToClose.close();
        },
        { once: true },
      );
    }
    rumikRef.current = null;
    rumikReadyRef.current = null;
  }, [stopRumikAudio]);

  const performRealtimeBargeIn = useCallback(
    (reason: string) => {
      interruptionInProgressRef.current = true;
      logVoiceDebug('realtime:barge-in', { reason });
      closeRumikSocket();
      logVoiceDebug('agent:interrupt:abort-current', { reason });
      agentAbortControllerRef.current?.abort();
      agentAbortControllerRef.current = null;
      interruptionInProgressRef.current = false;
    },
    [closeRumikSocket],
  );

  const ensureRumikSocket = useCallback(
    async (seedText: string): Promise<WebSocket> => {
      const existing = rumikRef.current;
      if (existing?.readyState === WebSocket.OPEN) {
        logVoiceDebug('rumik:socket:reuse-open');
        return existing;
      }
      if (rumikReadyRef.current) {
        logVoiceDebug('rumik:socket:reuse-pending');
        return rumikReadyRef.current;
      }

      logVoiceDebug('rumik:session:request', { textChars: seedText.length });

      const readyPromise = fetch('/api/voice/rumik-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: seedText }),
      })
        .then(async (response) => {
          const data = (await response.json()) as Partial<RumikSessionData> & { error?: string };
          if (!response.ok || !data.ws_url || !data.token) {
            throw new Error(data?.error || 'Could not start Rumik voice');
          }
          const wsUrl = data.ws_url;
          const token = data.token;
          logVoiceDebug('rumik:session:response', { ok: true, wsUrl });

          return new Promise<WebSocket>((resolve, reject) => {
            logVoiceDebug('rumik:socket:connect', { wsUrl });
            const socket = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`);
            socket.binaryType = 'arraybuffer';
            rumikRef.current = socket;

            socket.onopen = () => {
              logVoiceDebug('rumik:socket:open');
              resolve(socket);
            };
            socket.onmessage = (event) => {
              if (typeof event.data === 'string') {
                let message: { type?: string };
                try {
                  message = JSON.parse(event.data) as { type?: string };
                } catch (parseError) {
                  logVoiceDebug('rumik:message:text:parse-error', {
                    message: parseError instanceof Error ? parseError.message : String(parseError),
                    raw: event.data,
                  });
                  return;
                }
                rumikTextPacketCountRef.current += 1;
                logVoiceDebug('rumik:message:text', {
                  packet: rumikTextPacketCountRef.current,
                  ...message,
                });
                if (message.type === 'done') {
                  const completedRequest = pendingRumikRequestQueueRef.current.shift();
                  if (completedRequest) clearPendingRumikTtsRequest(completedRequest);
                  pendingRumikRequestsRef.current = Math.max(0, pendingRumikRequestsRef.current - 1);
                  rumikStreamDoneRef.current = pendingRumikRequestsRef.current === 0;
                  logVoiceDebug('rumik:message:text:done-waiting-playback', {
                    pendingRequests: pendingRumikRequestsRef.current,
                    pendingSources: pendingRumikSourcesRef.current,
                  });
                  finishRumikPlaybackTurn();
                }
                return;
              }

              const context = audioContextRef.current;
              if (!context) {
                logVoiceDebug('rumik:message:binary:dropped', { reason: 'missing-audio-context' });
                return;
              }
              const chunk = event.data as ArrayBuffer;
              rumikBinaryPacketCountRef.current += 1;
              pendingRumikRequestQueueRef.current.forEach((request) => {
                request.receivedAudio = true;
                clearPendingRumikTtsRequest(request);
              });
              const rms = getPcm16Rms(chunk);
              const activeTimingTurn = activeVoiceTimingTurnRef.current;
              if (activeTimingTurn?.firstAnswerTextSentLogged && !activeTimingTurn.firstAnswerAudioLogged) {
                activeTimingTurn.firstAnswerAudioLogged = true;
                postVoiceTiming({
                  callId: callIdRef.current,
                  turn: activeTimingTurn,
                  event: 'rumik_answer_first_audio_packet',
                  details: { bytes: chunk.byteLength },
                });
              }
              logVoiceDebug('rumik:message:binary', {
                packet: rumikBinaryPacketCountRef.current,
                bytes: chunk.byteLength,
                samples: chunk.byteLength / 2,
                rms: Number(rms.toFixed(5)),
                trimmingLeadIn: rumikLeadingSilenceRef.current.trimming,
              });
              if (
                rumikLeadingSilenceRef.current.trimming &&
                rms < RUMIK_LEADING_SILENCE_RMS_THRESHOLD &&
                rumikLeadingSilenceRef.current.dropped < RUMIK_MAX_LEADING_SILENCE_DROPS
              ) {
                rumikLeadingSilenceRef.current.dropped += 1;
                logVoiceDebug('rumik:message:binary:silent-leading-drop', {
                  packet: rumikBinaryPacketCountRef.current,
                  dropped: rumikLeadingSilenceRef.current.dropped,
                  rms: Number(rms.toFixed(5)),
                  threshold: RUMIK_LEADING_SILENCE_RMS_THRESHOLD,
                });
                return;
              }

              rumikLeadingSilenceRef.current.trimming = false;
              const buffer = pcm16ToAudioBuffer(context, chunk);
              logVoiceDebug('rumik:message:binary:buffer', {
                packet: rumikBinaryPacketCountRef.current,
                durationMs: Math.round(buffer.duration * 1000),
              });
              const source = context.createBufferSource();
              source.buffer = buffer;
              source.connect(context.destination);
              const startAt = Math.max(scheduledAtRef.current, context.currentTime);
              const delayMs = Math.round((startAt - context.currentTime) * 1000);
              const queueMs = Math.round(Math.max(0, scheduledAtRef.current - context.currentTime) * 1000);
              if (activeTimingTurn?.firstAnswerTextSentLogged && !activeTimingTurn.firstAnswerAudioScheduledLogged) {
                activeTimingTurn.firstAnswerAudioScheduledLogged = true;
                postVoiceTiming({
                  callId: callIdRef.current,
                  turn: activeTimingTurn,
                  event: 'rumik_answer_first_audio_scheduled',
                  details: { delayMs, queueMs, bytes: chunk.byteLength },
                });
              }
              source.start(startAt);
              pendingRumikSourcesRef.current += 1;
              logVoiceDebug('rumik:message:binary:scheduled', {
                packet: rumikBinaryPacketCountRef.current,
                currentTime: Number(context.currentTime.toFixed(3)),
                startAt: Number(startAt.toFixed(3)),
                delayMs,
                queueMs,
                pendingSources: pendingRumikSourcesRef.current,
              });
              scheduledAtRef.current = startAt + buffer.duration;
              sourcesRef.current.push(source);
              source.onended = () => {
                sourcesRef.current = sourcesRef.current.filter((item) => item !== source);
                pendingRumikSourcesRef.current = Math.max(0, pendingRumikSourcesRef.current - 1);
                logVoiceDebug('rumik:playback:source-ended', {
                  pendingSources: pendingRumikSourcesRef.current,
                });
                finishRumikPlaybackTurn();
              };
            };
            socket.onerror = (socketError) => {
              logVoiceDebug('rumik:socket:error', {
                type: socketError.type,
                readyState: socket.readyState,
              });
              reject(new Error('Rumik voice stream had an issue'));
              if (callStateRef.current !== 'idle' && callStateRef.current !== 'error') {
                callStateRef.current = 'connected';
                setCallState('connected');
              }
              appendTranscript('system', 'Rumik voice stream had an issue; text answer is still available.');
            };
            socket.onclose = () => {
              logVoiceDebug('rumik:socket:close');
              if (rumikRef.current === socket) rumikRef.current = null;
              rumikReadyRef.current = null;
              rumikSpeakingRef.current = false;
              pendingRumikRequestQueueRef.current.forEach(clearPendingRumikTtsRequest);
              pendingRumikRequestQueueRef.current = [];
              pendingRumikRequestsRef.current = 0;
              pendingRumikSourcesRef.current = 0;
              rumikStreamDoneRef.current = true;
              rumikDoneRef.current?.();
              rumikDoneRef.current = null;
            };
          });
        })
        .catch((socketError) => {
          rumikReadyRef.current = null;
          throw socketError;
        });

      rumikReadyRef.current = readyPromise;
      return readyPromise;
    },
    [appendTranscript, clearPendingRumikTtsRequest, finishRumikPlaybackTurn],
  );

  const warmRumikSocket = useCallback((seedText = '[neutral] Ji, main details check kar rahi hoon.') => {
    void ensureRumikSocket(seedText).catch(() => {
      // The foreground playback path will surface any user-visible error.
    });
  }, [ensureRumikSocket]);

  const waitForRumikPlaybackTurn = useCallback(async () => {
    if (
      rumikStreamDoneRef.current &&
      pendingRumikRequestsRef.current === 0 &&
      pendingRumikSourcesRef.current === 0
    ) {
      return;
    }

    await new Promise<void>((resolve) => {
      rumikDoneRef.current = resolve;
    });
  }, []);

  const playRumikText = useCallback(
    async (
      text: string,
      options: {
        resetPlayback?: boolean;
        waitForCompletion?: boolean;
        trimLeadingSilence?: boolean;
        timingLabel?: 'answer';
      } = {},
    ) => {
      const resetPlayback = options.resetPlayback ?? true;
      const waitForCompletion = options.waitForCompletion ?? true;
      const trimLeadingSilence = options.trimLeadingSilence ?? true;
      if (resetPlayback) stopRumikAudio();
      const playbackId = rumikPlaybackIdRef.current;

      if (!audioContextRef.current) audioContextRef.current = new AudioContext({ sampleRate: 24000 });
      await audioContextRef.current.resume();
      scheduledAtRef.current = Math.max(scheduledAtRef.current, audioContextRef.current.currentTime);

      setIsListening(false);
      callStateRef.current = 'speaking';
      setCallState('speaking');
      rumikSpeakingRef.current = true;
      if (resetPlayback) {
        rumikLeadingSilenceRef.current = { trimming: trimLeadingSilence, dropped: 0 };
      }
      const socket = await ensureRumikSocket(text);
      if (playbackId !== rumikPlaybackIdRef.current) return;

      const normalizedText = normalizeRumikText(text, resetPlayback ? 'neutral' : rumikToneRef.current);
      logVoiceDebug('rumik:normalize:text', {
        rawChars: text.length,
        normalizedChars: normalizedText.length,
        changed: normalizedText !== text,
        rawText: text,
        normalizedText,
      });
      rumikToneRef.current = extractRumikStartingTone(normalizedText) ?? rumikToneRef.current;
      const packet = { text: normalizedText.slice(0, 2000), speaker_id: 0 };
      const request: PendingRumikTtsRequest = {
        id: rumikTtsRequestIdRef.current + 1,
        packet,
        playbackId,
        retryCount: 0,
        receivedAudio: false,
        timer: null,
      };
      rumikTtsRequestIdRef.current = request.id;
      const scheduleFirstAudioWatchdog = () => {
        clearPendingRumikTtsRequest(request);
        request.timer = window.setTimeout(() => {
          const stillPending = pendingRumikRequestQueueRef.current.includes(request);
          if (!stillPending || request.receivedAudio || playbackId !== rumikPlaybackIdRef.current) return;

          if (request.retryCount < RUMIK_TTS_MAX_SEND_RETRIES) {
            request.retryCount += 1;
            logVoiceDebug('rumik:send:first-audio-timeout:retry', {
              requestId: request.id,
              retryCount: request.retryCount,
              pendingRequests: pendingRumikRequestsRef.current,
              textChars: request.packet.text.length,
            });
            const activeSocket = rumikRef.current;
            if (activeSocket?.readyState === WebSocket.OPEN) {
              try {
                activeSocket.send(JSON.stringify(request.packet));
                scheduleFirstAudioWatchdog();
                return;
              } catch (retryError) {
                logVoiceDebug('rumik:send:first-audio-timeout:retry-error', {
                  requestId: request.id,
                  message: retryError instanceof Error ? retryError.message : String(retryError),
                });
              }
            } else {
              logVoiceDebug('rumik:send:first-audio-timeout:retry-skipped', {
                requestId: request.id,
                readyState: activeSocket?.readyState ?? null,
              });
            }
          }

          pendingRumikRequestQueueRef.current = pendingRumikRequestQueueRef.current.filter((item) => item !== request);
          pendingRumikRequestsRef.current = Math.max(0, pendingRumikRequestsRef.current - 1);
          rumikStreamDoneRef.current = pendingRumikRequestsRef.current === 0;
          logVoiceDebug('rumik:send:first-audio-timeout:give-up', {
            requestId: request.id,
            pendingRequests: pendingRumikRequestsRef.current,
            pendingSources: pendingRumikSourcesRef.current,
            textChars: request.packet.text.length,
          });
          finishRumikPlaybackTurn();
        }, RUMIK_TTS_FIRST_AUDIO_TIMEOUT_MS);
      };
      pendingRumikRequestsRef.current += 1;
      pendingRumikRequestQueueRef.current.push(request);
      rumikStreamDoneRef.current = false;
      if (options.timingLabel === 'answer') {
        const activeTimingTurn = activeVoiceTimingTurnRef.current;
        if (activeTimingTurn && !activeTimingTurn.firstAnswerTextSentLogged) {
          activeTimingTurn.firstAnswerTextSentLogged = true;
          postVoiceTiming({
            callId: callIdRef.current,
            turn: activeTimingTurn,
            event: 'rumik_answer_text_sent',
            details: { textChars: packet.text.length },
          });
        }
      }
      logVoiceDebug('rumik:send:text', {
        textChars: packet.text.length,
        speaker_id: packet.speaker_id,
        pendingRequests: pendingRumikRequestsRef.current,
        text: packet.text,
      });

      try {
        socket.send(JSON.stringify(packet));
        scheduleFirstAudioWatchdog();
      } catch (sendError) {
        clearPendingRumikTtsRequest(request);
        pendingRumikRequestQueueRef.current = pendingRumikRequestQueueRef.current.filter((item) => item !== request);
        pendingRumikRequestsRef.current = Math.max(0, pendingRumikRequestsRef.current - 1);
        rumikStreamDoneRef.current = pendingRumikRequestsRef.current === 0;
        logVoiceDebug('rumik:send:error', {
          message: sendError instanceof Error ? sendError.message : String(sendError),
          pendingRequests: pendingRumikRequestsRef.current,
        });
        throw sendError;
      }

      if (waitForCompletion) await waitForRumikPlaybackTurn();
    },
    [clearPendingRumikTtsRequest, ensureRumikSocket, finishRumikPlaybackTurn, stopRumikAudio, waitForRumikPlaybackTurn],
  );

  const playRateLimitFallbackAudio = useCallback(async () => {
    if (typeof Audio === 'undefined' || isInactiveCallState(callStateRef.current)) return false;

    stopRumikAudio();
    const playbackId = rumikPlaybackIdRef.current;
    const audio = new Audio(STATIC_RUMIK_RATE_LIMIT_FALLBACK_SRC);
    audio.preload = 'auto';
    audio.setAttribute('playsInline', '');

    setIsListening(false);
    callStateRef.current = 'speaking';
    setCallState('speaking');
    rumikSpeakingRef.current = true;

    logVoiceDebug('agent:rate-limit-fallback:play', { src: STATIC_RUMIK_RATE_LIMIT_FALLBACK_SRC });

    const played = await new Promise<boolean>((resolve) => {
      const cleanup = (ok: boolean) => {
        rumikSpeakingRef.current = false;
        if (playbackId === rumikPlaybackIdRef.current && !isInactiveCallState(callStateRef.current)) {
          const nextState = respondingRef.current ? 'thinking' : 'connected';
          callStateRef.current = nextState;
          setCallState(nextState);
        }
        resolve(ok);
      };

      audio.onended = () => cleanup(true);
      audio.onerror = () => cleanup(false);
      audio.play().catch((playError) => {
        logVoiceDebug('agent:rate-limit-fallback:play-failed', {
          src: STATIC_RUMIK_RATE_LIMIT_FALLBACK_SRC,
          message: playError instanceof Error ? playError.message : 'unknown',
        });
        cleanup(false);
      });
    });

    if (!played) logVoiceDebug('agent:rate-limit-fallback:error', { src: STATIC_RUMIK_RATE_LIMIT_FALLBACK_SRC });
    return played;
  }, [stopRumikAudio]);

  const playStaticOpeningAudio = useCallback(async (): Promise<boolean> => {
    if (typeof Audio === 'undefined' || isInactiveCallState(callStateRef.current)) return false;

    stopRumikAudio();
    const playbackId = rumikPlaybackIdRef.current;
    const audio = new Audio(STATIC_RUMIK_OPENING_SRC);
    staticOpeningAudioRef.current = audio;
    audio.preload = 'auto';
    audio.setAttribute('playsInline', '');

    setIsListening(false);
    callStateRef.current = 'speaking';
    setCallState('speaking');
    rumikSpeakingRef.current = true;

    const finished = new Promise<boolean>((resolve) => {
      let localSpeechFrameCount = 0;
      const stopStaticOpeningBargeInMonitor = () => {
        if (!staticOpeningBargeInTimerRef.current) return;
        window.clearInterval(staticOpeningBargeInTimerRef.current);
        staticOpeningBargeInTimerRef.current = null;
      };
      const cleanup = (played: boolean) => {
        if (staticOpeningAudioRef.current === audio) staticOpeningAudioRef.current = null;
        if (staticOpeningFinishRef.current === finishInterruptedPlayback) staticOpeningFinishRef.current = null;
        staticOpeningStartedAtRef.current = 0;
        staticOpeningEchoFloorRef.current = 0;
        stopStaticOpeningBargeInMonitor();
        rumikSpeakingRef.current = false;
        if (playbackId === rumikPlaybackIdRef.current && !isInactiveCallState(callStateRef.current)) {
          callStateRef.current = 'connected';
          setCallState('connected');
        }
        resolve(played);
      };
      const finishInterruptedPlayback = () => cleanup(true);

      audio.onended = () => cleanup(true);
      audio.onerror = () => cleanup(false);
      staticOpeningFinishRef.current = finishInterruptedPlayback;

      staticOpeningBargeInTimerRef.current = window.setInterval(() => {
        if (staticOpeningAudioRef.current !== audio || playbackId !== rumikPlaybackIdRef.current) {
          stopStaticOpeningBargeInMonitor();
          return;
        }

        const analyser = analyserRef.current;
        const data = analyserDataRef.current;
        if (staticOpeningStartedAtRef.current <= 0) return;
        if (!analyser || !data || mutedRef.current) return;

        analyser.getFloatTimeDomainData(data);
        const rms = getFloatTimeDomainRms(data);
        latestMicRmsRef.current = rms;
        const openingAgeMs = performance.now() - staticOpeningStartedAtRef.current;

        if (openingAgeMs < STATIC_OPENING_ECHO_CALIBRATION_MS) {
          const previousFloor = staticOpeningEchoFloorRef.current;
          staticOpeningEchoFloorRef.current = previousFloor <= 0 ? rms : previousFloor * 0.85 + rms * 0.15;
          localSpeechFrameCount = 0;
          return;
        }

        const echoFloor = staticOpeningEchoFloorRef.current;
        const threshold = getStaticOpeningBargeInThreshold(echoFloor);
        localSpeechFrameCount = rms >= threshold ? localSpeechFrameCount + 1 : 0;

        if (
          shouldStopStaticOpeningForMicRms({
            rms,
            echoFloor,
            openingAgeMs,
            speechFrameCount: localSpeechFrameCount,
          })
        ) {
          logVoiceDebug('rumik:opening-static:local-barge-in', {
            rms: Number(rms.toFixed(5)),
            echoFloor: Number(echoFloor.toFixed(5)),
            threshold: Number(threshold.toFixed(5)),
            speechFrameCount: localSpeechFrameCount,
          });
          performRealtimeBargeIn('static-opening-local-vad');
        }
      }, STATIC_OPENING_BARGE_IN_SAMPLE_MS);
    });

    try {
      await audio.play();
      staticOpeningStartedAtRef.current = performance.now();
    } catch (playError) {
      if (staticOpeningAudioRef.current === audio) staticOpeningAudioRef.current = null;
      if (staticOpeningFinishRef.current) staticOpeningFinishRef.current = null;
      staticOpeningStartedAtRef.current = 0;
      staticOpeningEchoFloorRef.current = 0;
      if (staticOpeningBargeInTimerRef.current) {
        window.clearInterval(staticOpeningBargeInTimerRef.current);
        staticOpeningBargeInTimerRef.current = null;
      }
      rumikSpeakingRef.current = false;
      logVoiceDebug('rumik:opening-static:play-failed', {
        src: STATIC_RUMIK_OPENING_SRC,
        message: playError instanceof Error ? playError.message : 'unknown',
      });
      return false;
    }

    const played = await finished;
    if (!played) logVoiceDebug('rumik:opening-static:error', { src: STATIC_RUMIK_OPENING_SRC });
    return played;
  }, [performRealtimeBargeIn, stopRumikAudio]);

  const playOpeningAudio = useCallback(async () => {
    if (isInactiveCallState(callStateRef.current)) return;
    if (await playStaticOpeningAudio()) return;
    if (isInactiveCallState(callStateRef.current)) return;
    await playRumikText(STABLE_DEFAULT_OPENING, { trimLeadingSilence: false });
  }, [playRumikText, playStaticOpeningAudio]);

  const endCall = useCallback(() => {
    logVoiceDebug('call:end');
    callAbortRef.current?.abort();
    callAbortRef.current = null;
    setPlayOutboundTone(false);
    setUserVoiceVisual(false);
    if (realtimeReconnectTimerRef.current) {
      window.clearTimeout(realtimeReconnectTimerRef.current);
      realtimeReconnectTimerRef.current = null;
    }
    realtimeDataChannelRef.current?.close();
    realtimeDataChannelRef.current = null;
    realtimePeerRef.current?.close();
    realtimePeerRef.current = null;
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    if (vadTimerRef.current) {
      window.clearInterval(vadTimerRef.current);
      vadTimerRef.current = null;
    }
    analyserRef.current = null;
    analyserDataRef.current = null;
    setVoiceAnalyser(null);
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
    chunkPartsRef.current = [];
    isCapturingUtteranceRef.current = false;
    flushAfterRecorderStopRef.current = false;
    utteranceInFlightRef.current = false;
    callStartInFlightRef.current = false;
    recentSubmittedUtteranceRef.current = null;
    pendingSubmittedUtteranceRef.current = null;
    setIsListening(false);
    closeRumikSocket();
    callVerifiedRef.current = false;
    rumikAnswerStreamActiveRef.current = false;
    callIdRef.current = '';
    pendingInterruptRef.current = '';
    callStateRef.current = 'idle';
    setCallState('idle');
    setDuration(0);
    setInterimText('');
    setVerificationStatus('none');
  }, [closeRumikSocket]);

  const askAgent = useCallback(
    async (utteranceText: string) => {
      if (!session) return;
      const text = utteranceText.trim();
      if (!text) return;
      const now = Date.now();
      const duplicateSubmission = shouldSkipDuplicateSubmittedUtterance({
        utterance: text,
        recent: recentSubmittedUtteranceRef.current,
        now,
      });
      if (duplicateSubmission.skip) {
        logVoiceDebug('agent:request:skip-duplicate', {
          reason: duplicateSubmission.reason,
          textChars: text.length,
        });
        return;
      }
      if (respondingRef.current) {
        const duplicatePending = shouldSkipDuplicateSubmittedUtterance({
          utterance: text,
          recent: pendingSubmittedUtteranceRef.current,
          now,
        });
        if (duplicatePending.skip) {
          logVoiceDebug('agent:interrupt:skip-duplicate', {
            reason: duplicatePending.reason,
            textChars: text.length,
          });
          return;
        }
        pendingSubmittedUtteranceRef.current = duplicatePending.marker;
        pendingInterruptRef.current = text;
        stopRumikAudio();
        logVoiceDebug('agent:interrupt:queued', { textChars: text.length });
        return;
      }
      recentSubmittedUtteranceRef.current = duplicateSubmission.marker;
      respondingRef.current = true;
      setCallState('thinking');
      setInterimText('');
      appendTranscript('user', text);
      logVoiceDebug('agent:request', { text });
      const timingTurn: VoiceTimingTurn = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        startedAt: performance.now(),
        firstDeltaLogged: false,
        firstSpeakableLogged: false,
        firstAnswerTextSentLogged: false,
        firstAnswerAudioLogged: false,
        firstAnswerAudioScheduledLogged: false,
      };
      activeVoiceTimingTurnRef.current = timingTurn;
      postVoiceTiming({
        callId: callIdRef.current,
        turn: timingTurn,
        event: 'transcript_ready',
        details: { transcriptChars: text.length },
      });
      const controller = new AbortController();
      agentAbortControllerRef.current = controller;
      postVoiceTiming({
        callId: callIdRef.current,
        turn: timingTurn,
        event: 'agent_fetch_start',
      });
      const streamResponsePromise = fetch('/api/agent/respond-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          session_id: session.session_id,
          call_id: callIdRef.current,
          transcript: text,
          history: historyRef.current,
        }),
      });
      warmRumikSocket();
      let hasQueuedStreamAudio = false;
      rumikAnswerStreamActiveRef.current = true;

      try {
        const streamResponse = await streamResponsePromise;
        if (!streamResponse.ok || !streamResponse.body) {
          const data = await streamResponse.json().catch(() => ({}));
          throw new AgentResponseError(
            typeof data?.error === 'string' ? data.error : 'Could not get streamed agent response',
            streamResponse.status,
          );
        }

        const chunkBuffer = createRumikChunkBuffer();
        let playbackQueue = Promise.resolve();
        let queuedChunks = 0;
        let streamedText = '';

        const queueRumikChunk = (chunk: string) => {
          const isFirstStreamChunk = queuedChunks === 0;
          queuedChunks += 1;
          hasQueuedStreamAudio = true;
          logVoiceDebug(isFirstStreamChunk ? 'agent:stream:first-speakable-chunk' : 'agent:stream:speakable-chunk', {
            chunkChars: chunk.length,
            queuedChunks,
          });
          logVoiceDebug('agent:stream:chunk-before-rumik-normalize', {
            chunkChars: chunk.length,
            queuedChunks,
            rawChunk: chunk,
          });
          if (isFirstStreamChunk && !timingTurn.firstSpeakableLogged) {
            timingTurn.firstSpeakableLogged = true;
            postVoiceTiming({
              callId: callIdRef.current,
              turn: timingTurn,
              event: 'agent_first_speakable_chunk',
              details: { chunkChars: chunk.length },
            });
          }
          playbackQueue = playbackQueue.then(async () => {
            if (!isFirstStreamChunk) {
              await playRumikText(chunk, { resetPlayback: false, waitForCompletion: false, timingLabel: 'answer' });
              return;
            }
            await playRumikText(chunk, { resetPlayback: false, waitForCompletion: false, timingLabel: 'answer' });
          });
        };

        const data = await readAgentResponseStream(
          streamResponse,
          (delta) => {
            streamedText += delta;
            logVoiceDebug('agent:stream:delta', { deltaChars: delta.length, totalChars: streamedText.length });
            if (!timingTurn.firstDeltaLogged) {
              timingTurn.firstDeltaLogged = true;
              postVoiceTiming({
                callId: callIdRef.current,
                turn: timingTurn,
                event: 'agent_first_delta',
                details: { deltaChars: delta.length },
              });
            }
            pushRumikTextDelta(chunkBuffer, delta).forEach(queueRumikChunk);
          },
          (policy) => {
            void policy;
          },
          (timing) => {
            postVoiceTiming({
              callId: callIdRef.current,
              turn: timingTurn,
              event: `server_${timing.event}`,
              details: {
                ...(timing.details ?? {}),
                serverElapsedMs: timing.elapsedMs ?? null,
              },
            });
          },
          (event) => {
            logVoiceDebug('agent:stream:event', event);
          },
          (toolEvent) => {
            logVoiceDebug('agent:stream:tool', toolEvent);
            const toolName = typeof toolEvent.tool === 'string' ? toolEvent.tool : '';
            const phase = typeof toolEvent.phase === 'string' ? toolEvent.phase : '';
            if (toolName === 'verify_read_access') {
              if (phase === 'call') {
                setVerificationStatus('checking');
              } else if (phase === 'result') {
                const ok = toolEvent.ok === true;
                const verified = toolEvent.verified === true;
                const mobileStepVerified = toolEvent.mobile_step_verified === true;
                if (verified) {
                  setVerificationStatus('verified');
                } else if (ok && mobileStepVerified) {
                  setVerificationStatus('mobile_matched');
                } else if (!ok && mobileStepVerified) {
                  setVerificationStatus('dob_failed');
                } else if (!ok) {
                  setVerificationStatus('mobile_failed');
                }
              }
            }
          },
        );

        const tail = flushRumikChunkBuffer(chunkBuffer);
        if (tail) queueRumikChunk(tail);

        const answer = String(data.text || streamedText).trim();
        if (data.verified) callVerifiedRef.current = true;
        if (data.verified) setVerificationStatus('verified');
        if (!hasQueuedStreamAudio && answer) {
          logVoiceDebug('agent:stream:done-answer-speakable', {
            answerChars: answer.length,
            toolCalls: data.toolCalls ?? [],
          });
          queueRumikChunk(answer);
        }
        logVoiceDebug('agent:response', {
          status: streamResponse.status,
          text: answer,
          toolCalls: data.toolCalls ?? [],
          streamed: true,
        });
        const nextHistory: HistoryMessage[] = [
          ...historyRef.current,
          { role: 'user', text },
          { role: 'model', text: answer },
        ];
        historyRef.current = nextHistory.slice(-AGENT_CLIENT_HISTORY_LIMIT);
        appendTranscript('agent', answer);
        await playbackQueue;
        rumikAnswerStreamActiveRef.current = false;
        finishRumikPlaybackTurn();
        await waitForRumikPlaybackTurn();
        if (data.endCallAfterResponse && !isInactiveCallState(callStateRef.current)) {
          endCall();
        }
        agentAbortControllerRef.current = null;
      } catch (agentError) {
        rumikAnswerStreamActiveRef.current = false;
        if (agentError instanceof Error && agentError.name === 'AbortError') {
          logVoiceDebug('agent:request:aborted', { message: agentError.message });
          agentAbortControllerRef.current = null;
          return;
        }
        const message = agentError instanceof Error ? agentError.message : 'Agent response failed';
        logVoiceDebug('agent:error', { message });
        let rateLimitFallbackPlayed = false;
        if (!hasQueuedStreamAudio) {
          if (agentError instanceof AgentResponseError && agentError.status === 429) {
            rateLimitFallbackPlayed = await playRateLimitFallbackAudio();
          }
          try {
            logVoiceDebug('agent:fallback:request');
            const response = await fetch('/api/agent/respond', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                session_id: session.session_id,
                call_id: callIdRef.current,
                transcript: text,
                history: historyRef.current,
              }),
            });
            const data = await response.json();
            if (!response.ok) {
              throw new AgentResponseError(
                typeof data?.error === 'string' ? data.error : 'Could not get agent response',
                response.status,
              );
            }
            const answer = String(data.text || '').trim();
            if (data.verified) callVerifiedRef.current = true;
            if (data.verified) setVerificationStatus('verified');
            logVoiceDebug('agent:fallback:response', { status: response.status, text: answer, toolCalls: data.toolCalls ?? [] });
            const fallbackHistory: HistoryMessage[] = [
              ...historyRef.current,
              { role: 'user', text },
              { role: 'model', text: answer },
            ];
            historyRef.current = fallbackHistory.slice(-AGENT_CLIENT_HISTORY_LIMIT);
            appendTranscript('agent', answer);
            const answerPlayback = playRumikText(answer, { resetPlayback: false, waitForCompletion: false, timingLabel: 'answer' });
            await answerPlayback;
            await waitForRumikPlaybackTurn();
            return;
          } catch (fallbackError) {
            logVoiceDebug('agent:fallback:error', {
              message: fallbackError instanceof Error ? fallbackError.message : 'Fallback agent response failed',
            });
            if (
              fallbackError instanceof AgentResponseError &&
              fallbackError.status === 429 &&
              !(agentError instanceof AgentResponseError && agentError.status === 429)
            ) {
              rateLimitFallbackPlayed = await playRateLimitFallbackAudio();
            }
          }
        }
        if (rateLimitFallbackPlayed) {
          setError('');
          setInterimText('');
          callStateRef.current = 'connected';
          setCallState('connected');
          return;
        }
        setError(message);
        setCallState('error');
        appendTranscript('system', message);
      } finally {
        respondingRef.current = false;
        const pendingInterrupt = pendingInterruptRef.current;
        pendingInterruptRef.current = '';
        pendingSubmittedUtteranceRef.current = null;
        if (pendingInterrupt && !isInactiveCallState(callStateRef.current)) {
          void askAgent(pendingInterrupt);
        }
      }
    },
    [
      appendTranscript,
      endCall,
      playRumikText,
      playRateLimitFallbackAudio,
      session,
      stopRumikAudio,
      waitForRumikPlaybackTurn,
      warmRumikSocket,
    ],
  );

  useEffect(() => () => endCall(), [endCall]);

  const declineIncoming = useCallback(() => {
    logVoiceDebug('call:decline-incoming');
    setDuration(0);
    setCallState('idle');
  }, []);

  const connectOpenAIRealtimeTranscription = useCallback(
    async (stream: MediaStream) => {
      logVoiceDebug('realtime:token:request', { sessionId });
      const tokenResponse = await fetch('/api/voice/openai-realtime-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const tokenData = (await tokenResponse.json()) as OpenAIRealtimeTokenData;
      if (!tokenResponse.ok || !tokenData.client_secret) {
        throw new Error(tokenData.error || 'Could not start realtime transcription');
      }

      const peer = new RTCPeerConnection();
      realtimePeerRef.current = peer;
      stream.getAudioTracks().forEach((track) => {
        track.enabled = false;
        peer.addTrack(track, stream);
      });

      const dataChannel = peer.createDataChannel('oai-events');
      realtimeDataChannelRef.current = dataChannel;
      const scheduleRealtimeReconnect = (reason: string) => {
        if (realtimeReconnectTimerRef.current) return;
        if (micStreamRef.current !== stream || isInactiveCallState(callStateRef.current)) return;
        logVoiceDebug('realtime:reconnect:scheduled', { reason });
        realtimeReconnectTimerRef.current = window.setTimeout(() => {
          realtimeReconnectTimerRef.current = null;
          if (micStreamRef.current !== stream || isInactiveCallState(callStateRef.current)) return;

          const staleDataChannel = realtimeDataChannelRef.current;
          const stalePeer = realtimePeerRef.current;
          realtimeDataChannelRef.current = null;
          realtimePeerRef.current = null;
          staleDataChannel?.close();
          stalePeer?.close();
          void connectOpenAIRealtimeTranscription(stream).catch((reconnectError) => {
            logVoiceDebug('realtime:reconnect:error', {
              reason,
              message: reconnectError instanceof Error ? reconnectError.message : 'Realtime reconnect failed',
            });
          });
        }, 500);
      };

      dataChannel.addEventListener('open', () => {
        logVoiceDebug('realtime:data-channel:open', { expires_at: tokenData.expires_at });
      });
      dataChannel.addEventListener('close', () => {
        if (realtimeDataChannelRef.current !== dataChannel) return;
        logVoiceDebug('realtime:data-channel:close', { readyState: dataChannel.readyState });
        scheduleRealtimeReconnect('data-channel-close');
      });
      dataChannel.addEventListener('error', () => {
        if (realtimeDataChannelRef.current !== dataChannel) return;
        logVoiceDebug('realtime:data-channel:error', { readyState: dataChannel.readyState });
        scheduleRealtimeReconnect('data-channel-error');
      });
      dataChannel.addEventListener('message', (event) => {
        try {
          const realtimeEvent = JSON.parse(String(event.data)) as OpenAIRealtimeTranscriptEvent;
          if (realtimeEvent.type === 'input_audio_buffer.speech_started') {
            setUserVoiceVisual(true);
            const shouldBargeIn = shouldBargeInOnRealtimeSpeechStart({
              responding: respondingRef.current,
              callState: callStateRef.current,
              staticOpeningPlaying: staticOpeningAudioRef.current !== null,
            });
            if (shouldBargeIn) {
              performRealtimeBargeIn('server-vad-speech-start');
            } else {
              logVoiceDebug('realtime:speech-started:skip-barge-in', {
                callState: callStateRef.current,
                responding: respondingRef.current,
              });
            }
            return;
          }
          if (realtimeEvent.type === 'input_audio_buffer.speech_stopped') {
            setUserVoiceVisual(false);
            return;
          }
          if (realtimeEvent.type === 'conversation.item.input_audio_transcription.delta') {
            const delta = typeof realtimeEvent.delta === 'string' ? realtimeEvent.delta : '';
            if (delta) {
              setUserVoiceVisual(true);
              setInterimText((current) => `${current}${delta}`.slice(-180));
            }
            return;
          }

          const utterance = getRealtimeTranscript(realtimeEvent);
          if (!utterance) return;

          logVoiceDebug('realtime:transcript:completed', {
            transcriptChars: utterance.length,
            transcript: utterance,
          });
          setUserVoiceVisual(false);
          setInterimText('');
          if (utterance.length >= 2) {
            if (
              !shouldAcceptRealtimeTranscript({
                utterance,
                responding: respondingRef.current,
                callState: callStateRef.current,
              })
            ) {
              return;
            }
            if (staticOpeningAudioRef.current && isLikelyStaticOpeningEcho(utterance)) {
              logVoiceDebug('realtime:transcript:static-opening-echo', {
                transcriptChars: utterance.length,
              });
              return;
            }
            if (
              respondingRef.current ||
              callStateRef.current === 'thinking' ||
              callStateRef.current === 'speaking'
            ) {
              performRealtimeBargeIn('realtime-transcript-completed');
            }
            void askAgent(utterance);
          }
        } catch (realtimeError) {
          logVoiceDebug('realtime:event:error', {
            message: realtimeError instanceof Error ? realtimeError.message : 'Could not parse realtime event',
          });
        }
      });

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      if (!offer.sdp) throw new Error('Could not create realtime transcription offer');

      const sdpResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${tokenData.client_secret}`,
          'Content-Type': 'application/sdp',
        },
      });
      const sdpResponseText = await sdpResponse.text();
      if (!sdpResponse.ok) {
        logVoiceDebug('realtime:sdp:error', {
          status: sdpResponse.status,
          detailsPreview: sdpResponseText.slice(0, 1000),
        });
        throw new Error(`Could not connect realtime transcription: ${sdpResponseText.slice(0, 300) || sdpResponse.status}`);
      }

      await peer.setRemoteDescription({
        type: 'answer',
        sdp: sdpResponseText,
      });
      peer.addEventListener('connectionstatechange', () => {
        if (realtimePeerRef.current !== peer) return;
        logVoiceDebug('realtime:peer:connection-state', { connectionState: peer.connectionState });
        if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
          scheduleRealtimeReconnect(`peer-${peer.connectionState}`);
        }
      });
      peer.addEventListener('iceconnectionstatechange', () => {
        if (realtimePeerRef.current !== peer) return;
        logVoiceDebug('realtime:peer:ice-connection-state', { iceConnectionState: peer.iceConnectionState });
        if (peer.iceConnectionState === 'failed' || peer.iceConnectionState === 'disconnected') {
          scheduleRealtimeReconnect(`ice-${peer.iceConnectionState}`);
        }
      });
      logVoiceDebug('realtime:peer:connected');
    },
    [askAgent, performRealtimeBargeIn, sessionId],
  );

  const startCall = useCallback(async () => {
    const currentCallState = callStateRef.current;
    if (!session || callStartInFlightRef.current || !['idle', 'incoming', 'error'].includes(currentCallState)) return;
    callStartInFlightRef.current = true;
    const outboundRing = currentCallState === 'idle' || currentCallState === 'error';
    logVoiceDebug('call:start', { sessionId, persona: session.persona.name, outboundRing });
    if (outboundRing) {
      setPlayOutboundTone(true);
      setCallState('calling');
      callStateRef.current = 'calling';
    } else {
      setPlayOutboundTone(false);
      setCallState('connecting');
      callStateRef.current = 'connecting';
    }
    setError('');
    setDuration(0);
    setTranscript([]);
    setVerificationStatus('none');
    historyRef.current = [];
    callVerifiedRef.current = false;
    rumikAnswerStreamActiveRef.current = false;
    callIdRef.current =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `call-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    pendingInterruptRef.current = '';
    recentSubmittedUtteranceRef.current = null;
    pendingSubmittedUtteranceRef.current = null;
    chunkPartsRef.current = [];
    isCapturingUtteranceRef.current = false;
    flushAfterRecorderStopRef.current = false;
    openingPlayedRef.current = true;
    micPacketCountRef.current = 0;
    rumikTextPacketCountRef.current = 0;
    rumikBinaryPacketCountRef.current = 0;
    transcriptionAttemptRef.current = 0;

    try {
      const abort = new AbortController();
      callAbortRef.current = abort;
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          signal: abort.signal,
        } as MediaStreamConstraints & { signal: AbortSignal });
      } catch (mediaError) {
        if (mediaError instanceof DOMException && mediaError.name === 'AbortError') {
          logVoiceDebug('call:start:aborted');
          setPlayOutboundTone(false);
          callStateRef.current = 'idle';
          setCallState('idle');
          return;
        }
        throw mediaError;
      }
      logVoiceDebug('mic:permission:granted', {
        tracks: stream.getAudioTracks().map((track) => ({
          id: track.id,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
          label: track.label,
        })),
      });
      micStreamRef.current = stream;
      callStateRef.current = 'connecting';
      setCallState('connecting');
      if (USE_OPENAI_REALTIME_TRANSCRIPTION) {
        await connectOpenAIRealtimeTranscription(stream);
      }
      const monitorContext = new AudioContext();
      const source = monitorContext.createMediaStreamSource(stream);
      const analyser = monitorContext.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      analyserRef.current = analyser;
      analyserDataRef.current = new Float32Array(analyser.fftSize) as Float32Array<ArrayBuffer>;
      setVoiceAnalyser(analyser);
      await monitorContext.resume();
      logVoiceDebug('mic:monitor:resume', { audioContextState: monitorContext.state });
      const createUtteranceRecorder = () => {
        const nextRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        mediaRecorderRef.current = nextRecorder;
        logVoiceDebug('mic:recorder:created', {
          mimeType: nextRecorder.mimeType,
          state: nextRecorder.state,
          audioContextState: monitorContext.state,
        });

        nextRecorder.ondataavailable = (event) => {
          micPacketCountRef.current += 1;
          if (event.data.size <= 0) {
            logVoiceDebug('mic:chunk:dropped', {
              packet: micPacketCountRef.current,
              reason: 'empty-data',
              bytes: event.data.size,
            });
            return;
          }

          if (!isCapturingUtteranceRef.current && !flushAfterRecorderStopRef.current) {
            logVoiceDebug('mic:chunk:dropped', {
              packet: micPacketCountRef.current,
              reason: 'not-capturing',
              bytes: event.data.size,
            });
            return;
          }

          chunkPartsRef.current.push(event.data);
          logVoiceDebug('mic:chunk:captured', {
            packet: micPacketCountRef.current,
            utteranceChunks: chunkPartsRef.current.length,
          });
        };

        nextRecorder.onstop = () => {
          logVoiceDebug('mic:recorder:stop');
          if (flushAfterRecorderStopRef.current) {
            flushAfterRecorderStopRef.current = false;
            void flushUtterance();
          }
        };
        nextRecorder.onpause = () => {
          logVoiceDebug('mic:recorder:pause');
        };
        nextRecorder.onresume = () => {
          logVoiceDebug('mic:recorder:resume');
        };

        return nextRecorder;
      };
      let speechFrameCount = 0;
      const { silenceCutoffMs, minSpeechMs, rmsThreshold, requiredSpeechFrames } = VOICE_TURN_DETECTION;

      const flushUtterance = async () => {
        if (utteranceInFlightRef.current) return;
        const parts = chunkPartsRef.current;
        chunkPartsRef.current = [];
        if (!parts.length) return;

        const mimeType = mediaRecorderRef.current?.mimeType || 'audio/webm';
        const blob = new Blob(parts, { type: mimeType });
        logVoiceDebug('utterance:flush', { chunks: parts.length, bytes: blob.size });
        if (blob.size < 12000) {
          logVoiceDebug('utterance:skip-small', { bytes: blob.size });
          setIsListening(false);
          setInterimText('');
          return;
        }

        utteranceInFlightRef.current = true;
        setCallState('thinking');
        setUserVoiceVisual(false);
        setInterimText('Transcribing...');
        transcriptionAttemptRef.current += 1;
        try {
          const body = new FormData();
          body.append('audio', blob, `utterance-${Date.now()}.webm`);
          logVoiceDebug('transcribe:request', {
            attempt: transcriptionAttemptRef.current,
            bytes: blob.size,
            mimeType: blob.type,
          });
          const response = await fetch('/api/voice/openai-transcribe', { method: 'POST', body });
          const data = await response.json();
          if (!response.ok) throw new Error(data?.error || 'Could not transcribe audio');
          const utterance = String(data?.transcript || '').trim();
          logVoiceDebug('transcribe:response', {
            attempt: transcriptionAttemptRef.current,
            status: response.status,
            transcriptChars: utterance.length,
            transcript: utterance,
          });
          setInterimText('');
          if (utterance.length >= 2) {
            await askAgent(utterance);
          } else if (callStateRef.current !== 'error') {
            setCallState('connected');
          }
        } catch (transcriptionError) {
          const message = transcriptionError instanceof Error ? transcriptionError.message : 'Transcription failed';
          logVoiceDebug('transcribe:error', { message });
          appendTranscript('system', message);
          setCallState('connected');
          setInterimText('');
        } finally {
          utteranceInFlightRef.current = false;
          setIsListening(false);
        }
      };

      vadTimerRef.current = window.setInterval(() => {
        if (USE_OPENAI_REALTIME_TRANSCRIPTION) return;
        const currentAnalyser = analyserRef.current;
        const data = analyserDataRef.current;
        if (!currentAnalyser || !data || mutedRef.current || utteranceInFlightRef.current) return;
        if (callStateRef.current !== 'connected') {
          speechFrameCount = 0;
          return;
        }

        currentAnalyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (let index = 0; index < data.length; index += 1) {
          sum += data[index] * data[index];
        }
        const rms = Math.sqrt(sum / data.length);
        latestMicRmsRef.current = rms;
        const now = Date.now();

        if (rms > rmsThreshold) {
          lastSpeechAtRef.current = now;
          speechFrameCount += 1;
          logVoiceDebug('vad:voice-frame', {
            rms: Number(rms.toFixed(5)),
            threshold: rmsThreshold,
            speechFrameCount,
            requiredSpeechFrames,
          });
          if (
            !isCapturingUtteranceRef.current &&
            speechFrameCount >= requiredSpeechFrames &&
            shouldSendMicrophoneAudio({ muted: mutedRef.current, callState: callStateRef.current, dataSize: 1 })
          ) {
            speechStartedAtRef.current = now;
            chunkPartsRef.current = [];
            isCapturingUtteranceRef.current = true;
            flushAfterRecorderStopRef.current = false;
            const utteranceRecorder = createUtteranceRecorder();
            utteranceRecorder.start(240);
            logVoiceDebug('mic:recorder:start', { timesliceMs: 240, state: utteranceRecorder.state });
            setIsListening(true);
            setInterimText('Listening...');
            logVoiceDebug('vad:speech-start', { rms });
          }
          return;
        }

        speechFrameCount = 0;
        if (!isCapturingUtteranceRef.current) return;
        const silentFor = now - lastSpeechAtRef.current;
        const spokenFor = now - speechStartedAtRef.current;
        if (silentFor >= silenceCutoffMs && spokenFor >= minSpeechMs) {
          isCapturingUtteranceRef.current = false;
          logVoiceDebug('vad:speech-end', { silentFor, spokenFor, chunks: chunkPartsRef.current.length });
          flushAfterRecorderStopRef.current = true;
          const currentRecorder = mediaRecorderRef.current;
          if (currentRecorder?.state === 'recording') {
            currentRecorder.stop();
            return;
          }
          void flushUtterance();
        }
      }, 100);

      if (!['idle', 'error', 'incoming'].includes(callStateRef.current)) {
        setPlayOutboundTone(false);
        callAbortRef.current = null;
        callStateRef.current = 'connected';
        setCallState('connected');
      }
      syncRealtimeMicrophoneTrack(mutedRef.current, callStateRef.current);
      let openingPlaybackError: unknown = null;
      const openingPlayback = playOpeningAudio().catch((playbackError) => {
        openingPlaybackError = playbackError;
      });
      await openingPlayback;
      if (openingPlaybackError) throw openingPlaybackError;
    } catch (startError) {
      stopRumikAudio();
      setPlayOutboundTone(false);
      callAbortRef.current = null;
      setError(startError instanceof Error ? startError.message : 'Could not start call');
      callStateRef.current = 'error';
      setCallState('error');
    } finally {
      callStartInFlightRef.current = false;
    }
  }, [
    appendTranscript,
    askAgent,
    connectOpenAIRealtimeTranscription,
    playOpeningAudio,
    session,
    sessionId,
    stopRumikAudio,
    syncMicrophoneRecorder,
    syncRealtimeMicrophoneTrack,
  ]);

  const enterCall = useCallback(async () => {
    setHasEnteredCall(true);
    await startCall();
  }, [startCall]);

  const handleBack = useCallback(() => {
    if (hasEnteredCall) {
      endCall();
      setHasEnteredCall(false);
      return;
    }

    if (typeof window !== 'undefined') {
      if (window.history.length > 1) {
        window.history.back();
        return;
      }
    }

    router.push('/onboarding');
  }, [endCall, hasEnteredCall, router]);

  const visualizerSpeaker = useMemo<AgentVisualizerSpeaker>(() => {
    if (callState === 'speaking') return 'agent';
    if (callState === 'connected' && (isListening || userVoiceVisual)) return 'user';
    return 'neutral';
  }, [callState, isListening, userVoiceVisual]);

  if (sessionError) {
    return (
      <main className="agent-page">
        <div className="agent-error-panel">{sessionError}</div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="agent-page">
        <div className="agent-loader-container" role="status" aria-live="polite">
          <div className="agent-spinner" />
          <p className="agent-loader-caption">Loading session…</p>
        </div>
      </main>
    );
  }

  if (!hasEnteredCall) {
    return (
      <main className="agent-page agent-page--precall">
        <section className="agent-precall" aria-label="Stable Money Support introduction">
          <header className="agent-precall__header">
            <button type="button" className="agent-icon-btn" onClick={handleBack} aria-label="Go back">
              <BackIcon />
            </button>
            <p className="agent-precall__eyebrow" style={{ margin: 0 }}>Stable Money Support</p>
          </header>

          <div className="agent-precall__hero">
            <div className="agent-precall__intro">
              <p className="agent-precall__kicker">Account support assistant</p>
              <h2>Talk through fixed deposits, payments, KYC, and account.</h2>
              <p>
                Review the active demo customer below, then start a focused support call with the same voice flow and
                verification behavior.
              </p>
              <button type="button" className="agent-precall__call" onClick={() => void enterCall()}>
                Call Stable Money Support
              </button>
            </div>

            <div className="agent-precall__capabilities" aria-label="Support capabilities">
              <article>
                <span>FD</span>
                <h3>Fixed deposits</h3>
                <p>Status, bookings, maturity, interest, and next steps.</p>
              </article>
              <article>
                <span>PAY</span>
                <h3>Payments</h3>
                <p>Payment status, refunds, failed transfers, and timelines.</p>
              </article>
              <article>
                <span>KYC</span>
                <h3>Verification</h3>
                <p>Mobile and DOB verification before sensitive account help.</p>
              </article>
              <article>
                <span>ACC</span>
                <h3>Account profile</h3>
                <p>Nominee, customer profile, and support context.</p>
              </article>
            </div>
          </div>

          <section className="agent-precall__details" aria-label="Demo customer details">
            <div className="agent-precall__details-heading">
              <p className="agent-precall__eyebrow">Calling as</p>
              <h2>{session.brief.name}</h2>
              <p>{session.brief.customerId}</p>
            </div>
            <div className="agent-precall__detail-grid">
              {buildPersonaDetailSections(session.persona).map((section) => (
                <section key={section.id} className="agent-precall-detail">
                  <h3>{section.title}</h3>
                  <div className="agent-precall-detail__table-wrap">
                    <table className="agent-precall-detail__table">
                      <thead>
                        <tr>
                          {section.columns.map((column) => (
                            <th key={column} scope="col">
                              {column}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {section.rows.map((row) => (
                          <tr key={row.id}>
                            {row.cells.map((cell, index) => (
                              <td key={`${row.id}-${section.columns[index]}`}>{cell}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
            </div>
          </section>
        </section>
      </main>
    );
  }

  return (
    <main className="agent-page agent-page--call">
      <section className="voice-stage" aria-label="Voice call">
        <header className="voice-stage__header">
          <button type="button" className="agent-icon-btn" onClick={handleBack} aria-label="Go back">
            <BackIcon />
          </button>
        </header>

        <div className="voice-call-stack">
          <div className={`voice-orb voice-orb--${callState}`} aria-label="Stable Money Support call">
            <div className="voice-orb__inner">
              <span className="voice-orb__caller">Stable Money Support</span>
            </div>
          </div>

          <div className="voice-call-title">
            <p className="voice-call-title__status" aria-live="polite">
              {formatDuration(duration)}
            </p>
          </div>

          <div className="voice-call-visual-panel">
            <AgentAudioVisualizerBar
              size="lg"
              speaker={visualizerSpeaker}
              analyser={
                callState === 'connected' || callState === 'thinking' || callState === 'speaking' ? voiceAnalyser : null
              }
            />
          </div>

          <div className="voice-call-actions">
            {callState === 'idle' || callState === 'error' ? (
              <button type="button" className="call-primary voice-call-actions__primary" onClick={() => void startCall()}>
                Call StableMoney Support
              </button>
            ) : callState === 'incoming' ? (
              <>
                <button
                  type="button"
                  className="voice-call-round-btn voice-call-round-btn--answer"
                  onClick={() => void startCall()}
                  aria-label="Answer call"
                >
                  <PhoneHandsetIcon />
                </button>
                <button
                  type="button"
                  className="voice-call-round-btn voice-call-round-btn--cut"
                  onClick={declineIncoming}
                  aria-label="Decline call"
                >
                  <PhoneOffIcon />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={
                    muted ? 'voice-call-round-btn voice-call-round-btn--mic-muted' : 'voice-call-round-btn voice-call-round-btn--mic'
                  }
                  onClick={() => setMuted((value) => !value)}
                  aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
                >
                  {muted ? <MicOffIcon /> : <MicIcon />}
                </button>
                <button type="button" className="voice-call-round-btn voice-call-round-btn--cut" onClick={endCall} aria-label="End call">
                  <PhoneOffIcon />
                </button>
              </>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
