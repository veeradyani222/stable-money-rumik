'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

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
import { normalizeRumikText } from '@/lib/voice/rumik-text';

type CallState = VoiceCallState;
type PanelTab = 'persona' | 'questions';
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
  suppressFiller?: boolean;
  endCallAfterResponse?: boolean;
}

interface AgentStreamMessage {
  event: string;
  data: Record<string, unknown>;
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

interface AgentTurnPolicy {
  suppressFiller?: boolean;
  endCallAfterResponse?: boolean;
}

type OpeningAudioCacheStatus = 'idle' | 'loading' | 'ready' | 'error';

interface OpeningAudioCache {
  status: OpeningAudioCacheStatus;
  chunks: ArrayBuffer[];
  promise: Promise<void> | null;
  error: string;
  waiters: Array<() => void>;
}

const RUMIK_LEADING_SILENCE_RMS_THRESHOLD = 0.004;
const RUMIK_MAX_LEADING_SILENCE_DROPS = 20;
const OPENING_AUDIO_CACHE_TIMEOUT_MS = 12000;
const USE_OPENAI_REALTIME_TRANSCRIPTION = true;
const STABLE_THINKING_FILLERS = [
  '[neutral] Ek minute dijiye, main system mein iski details nikalti hoon aur aapko batati hoon. Wait karne ke liye thank you',
  '[neutral] Okay, main abhi check kar leti hoon aur aapko batati hoon. Thank you for your understanding.',
] as const;
const AGENT_CLIENT_HISTORY_LIMIT = 16;
/** Ringtones: MP3 only, from `public/assets/` → `/assets/…` */
const INCOMING_RINGTONE_SRC = '/assets/ringtone.mp3';
const OUTGOING_RINGTONE_SRC = '/assets/dragon-ringing.mp3';

const openingAudioCache: OpeningAudioCache = {
  status: 'idle',
  chunks: [],
  promise: null,
  error: '',
  waiters: [],
};

const thinkingFillerAudioCaches: OpeningAudioCache[] = STABLE_THINKING_FILLERS.map(() => ({
  status: 'idle',
  chunks: [],
  promise: null,
  error: '',
  waiters: [],
}));

function notifyOpeningAudioCacheWaiters() {
  const waiters = openingAudioCache.waiters.splice(0);
  waiters.forEach((resolve) => resolve());
}

function notifyAudioCacheWaiters(cache: OpeningAudioCache) {
  const waiters = cache.waiters.splice(0);
  waiters.forEach((resolve) => resolve());
}

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

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M15 18 9 12l6-6" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M9 18l6-6-6-6" />
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
  void event;
  void details;
}

function postVoiceTiming(input: {
  callId: string;
  turn: VoiceTimingTurn;
  event: string;
  details?: Record<string, unknown>;
}) {
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

function isInterruptibleTranscript(utterance: string): boolean {
  const digits = utterance.replace(/\D/g, '');
  if (/^\d{4}$/.test(digits)) return true;
  const words = utterance.trim().split(/\s+/).filter(Boolean);
  return words.length >= 3;
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
          suppressFiller: typeof message.data.suppressFiller === 'boolean' ? message.data.suppressFiller : undefined,
          endCallAfterResponse:
            typeof message.data.endCallAfterResponse === 'boolean' ? message.data.endCallAfterResponse : undefined,
        };
        result = { ...result, ...policy };
        onPolicy?.(policy);
      }
      if (message.event === 'done') {
        result = {
          text: typeof message.data.text === 'string' ? message.data.text : result.text,
          toolCalls: Array.isArray(message.data.toolCalls) ? message.data.toolCalls.map(String) : [],
          verified: typeof message.data.verified === 'boolean' ? message.data.verified : result.verified,
          suppressFiller: result.suppressFiller,
          endCallAfterResponse: result.endCallAfterResponse,
        };
      }
      if (message.event === 'error') {
        throw new Error(typeof message.data.error === 'string' ? message.data.error : 'Agent stream failed');
      }
    }

    if (done) break;
  }

  return result;
}

function prefetchOpeningAudio(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (openingAudioCache.status === 'ready') return Promise.resolve();
  if (openingAudioCache.promise) return openingAudioCache.promise;

  openingAudioCache.status = 'loading';
  openingAudioCache.chunks = [];
  openingAudioCache.error = '';
  notifyOpeningAudioCacheWaiters();

  const startedAt = Date.now();
  logVoiceDebug('rumik:opening-cache:request', { textChars: STABLE_DEFAULT_OPENING.length });

  const cachePromise = fetch('/api/voice/rumik-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: STABLE_DEFAULT_OPENING }),
  })
    .then(async (response) => {
      const data = (await response.json()) as Partial<RumikSessionData> & { error?: string };
      if (!response.ok || !data.ws_url || !data.token) {
        throw new Error(data?.error || 'Could not prepare opening audio');
      }
      const wsUrl = data.ws_url;
      const token = data.token;

      return new Promise<void>((resolve) => {
        let settled = false;
        let textPackets = 0;
        let binaryPackets = 0;
        let timeoutId: number | null = null;
        let socket: WebSocket | null = null;
        let lastProgressAt = startedAt;

        const finish = (status: 'ready' | 'error', message = '') => {
          if (settled) return;
          settled = true;
          if (timeoutId) window.clearTimeout(timeoutId);
          if (status === 'error' && socket && socket.readyState < WebSocket.CLOSING) {
            socket.close();
          }
          openingAudioCache.status = status;
          openingAudioCache.error = message;
          openingAudioCache.promise = null;
          notifyOpeningAudioCacheWaiters();
          logVoiceDebug(status === 'ready' ? 'rumik:opening-cache:ready' : 'rumik:opening-cache:error', {
            chunks: openingAudioCache.chunks.length,
            elapsedMs: Date.now() - startedAt,
            ...(message ? { message } : {}),
          });
          resolve();
        };

        const refreshOpeningCacheTimeout = () => {
          lastProgressAt = Date.now();
          if (timeoutId) window.clearTimeout(timeoutId);
          timeoutId = window.setTimeout(() => {
            const now = Date.now();
            logVoiceDebug('rumik:opening-cache:timeout', {
              chunks: openingAudioCache.chunks.length,
              textPackets,
              binaryPackets,
              elapsedMs: now - startedAt,
              lastPacketAgeMs: now - lastProgressAt,
            });
            finish('error', 'Opening audio cache timed out waiting for more audio');
          }, OPENING_AUDIO_CACHE_TIMEOUT_MS);
        };

        refreshOpeningCacheTimeout();
        socket = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`);
        socket.binaryType = 'arraybuffer';

        socket.onopen = () => {
          const packet = { text: normalizeRumikText(STABLE_DEFAULT_OPENING).slice(0, 2000), speaker_id: 0 };
          logVoiceDebug('rumik:opening-cache:send-text', {
            textChars: packet.text.length,
            speaker_id: packet.speaker_id,
          });
          socket?.send(JSON.stringify(packet));
        };

        socket.onmessage = (event) => {
          if (settled) return;
          if (typeof event.data === 'string') {
            const message = JSON.parse(event.data) as { type?: string };
            textPackets += 1;
            refreshOpeningCacheTimeout();
            logVoiceDebug('rumik:opening-cache:message:text', {
              packet: textPackets,
              ...message,
            });
            if (message.type === 'done') {
              if (openingAudioCache.chunks.length > 0) {
                socket?.close();
                finish('ready');
              } else {
                finish('error', 'Opening audio cache produced no audio');
              }
            }
            return;
          }

          const chunk = event.data as ArrayBuffer;
          binaryPackets += 1;
          refreshOpeningCacheTimeout();
          openingAudioCache.chunks.push(chunk.slice(0));
          notifyOpeningAudioCacheWaiters();
          if (binaryPackets === 1) {
            logVoiceDebug('rumik:opening-cache:first-binary', {
              bytes: chunk.byteLength,
              elapsedMs: Date.now() - startedAt,
            });
          }
        };

        socket.onerror = () => {
          finish('error', 'Opening audio cache stream had an issue');
        };

        socket.onclose = () => {
          if (!settled) {
            finish('error', 'Opening audio cache closed before completion');
          }
        };
      });
    })
    .catch((cacheError) => {
      openingAudioCache.status = 'error';
      openingAudioCache.promise = null;
      openingAudioCache.error = cacheError instanceof Error ? cacheError.message : 'Opening audio cache failed';
      notifyOpeningAudioCacheWaiters();
      logVoiceDebug('rumik:opening-cache:error', {
        message: openingAudioCache.error,
        elapsedMs: Date.now() - startedAt,
      });
    });

  openingAudioCache.promise = cachePromise;
  return cachePromise;
}

function prefetchAudioCache(input: { cache: OpeningAudioCache; text: string; label: string }): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (input.cache.status === 'ready') return Promise.resolve();
  if (input.cache.promise) return input.cache.promise;

  input.cache.status = 'loading';
  input.cache.chunks = [];
  input.cache.error = '';
  notifyAudioCacheWaiters(input.cache);

  const startedAt = Date.now();
  logVoiceDebug(`rumik:${input.label}-cache:request`, { textChars: input.text.length });

  const cachePromise = fetch('/api/voice/rumik-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: input.text }),
  })
    .then(async (response) => {
      const data = (await response.json()) as Partial<RumikSessionData> & { error?: string };
      if (!response.ok || !data.ws_url || !data.token) {
        throw new Error(data?.error || `Could not prepare ${input.label} audio`);
      }

      return new Promise<void>((resolve) => {
        let settled = false;
        let timeoutId: number | null = null;
        let socket: WebSocket | null = null;

        const finish = (status: 'ready' | 'error', message = '') => {
          if (settled) return;
          settled = true;
          if (timeoutId) window.clearTimeout(timeoutId);
          if (status === 'error' && socket && socket.readyState < WebSocket.CLOSING) {
            socket.close();
          }
          input.cache.status = status;
          input.cache.error = message;
          input.cache.promise = null;
          notifyAudioCacheWaiters(input.cache);
          logVoiceDebug(`rumik:${input.label}-cache:${status}`, {
            chunks: input.cache.chunks.length,
            elapsedMs: Date.now() - startedAt,
            ...(message ? { message } : {}),
          });
          resolve();
        };

        const refreshTimeout = () => {
          if (timeoutId) window.clearTimeout(timeoutId);
          timeoutId = window.setTimeout(() => {
            finish('error', `${input.label} audio cache timed out waiting for more audio`);
          }, OPENING_AUDIO_CACHE_TIMEOUT_MS);
        };

        refreshTimeout();
        socket = new WebSocket(
          `${String(data.ws_url)}?token=${encodeURIComponent(String(data.token ?? ''))}`,
        );
        socket.binaryType = 'arraybuffer';

        socket.onopen = () => {
          socket?.send(JSON.stringify({ text: normalizeRumikText(input.text).slice(0, 2000), speaker_id: 0 }));
        };

        socket.onmessage = (event) => {
          if (settled) return;
          refreshTimeout();
          if (typeof event.data === 'string') {
            const message = JSON.parse(event.data) as { type?: string };
            if (message.type === 'done') {
              if (input.cache.chunks.length > 0) {
                socket?.close();
                finish('ready');
              } else {
                finish('error', `${input.label} audio cache produced no audio`);
              }
            }
            return;
          }

          input.cache.chunks.push((event.data as ArrayBuffer).slice(0));
          notifyAudioCacheWaiters(input.cache);
        };

        socket.onerror = () => {
          finish('error', `${input.label} audio cache stream had an issue`);
        };

        socket.onclose = () => {
          if (!settled) finish('error', `${input.label} audio cache closed before completion`);
        };
      });
    })
    .catch((cacheError) => {
      input.cache.status = 'error';
      input.cache.promise = null;
      input.cache.error = cacheError instanceof Error ? cacheError.message : `${input.label} audio cache failed`;
      notifyAudioCacheWaiters(input.cache);
      logVoiceDebug(`rumik:${input.label}-cache:error`, {
        message: input.cache.error,
        elapsedMs: Date.now() - startedAt,
      });
    });

  input.cache.promise = cachePromise;
  return cachePromise;
}

function prefetchThinkingFillerAudio(): Promise<void> {
  return STABLE_THINKING_FILLERS.reduce(
    (chain, text, index) =>
      chain.then(() =>
        prefetchAudioCache({
          cache: thinkingFillerAudioCaches[index],
          text,
          label: 'thinking-filler',
        }),
      ),
    Promise.resolve(),
  );
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

function stripTranscriptToneTag(value: string): string {
  return value.replace(/^\[[^\]]+\]\s*/, '').trim();
}

const AGENT_SIDEBAR_WIDTH_STORAGE_KEY = 'stable-agent-sidebar-width-px';
const AGENT_SIDEBAR_WIDTH_MIN = 280;
const AGENT_SIDEBAR_WIDTH_MAX = 560;
const AGENT_SIDEBAR_WIDTH_DEFAULT = 380;

function clampAgentSidebarWidthPx(value: number): number {
  return Math.min(AGENT_SIDEBAR_WIDTH_MAX, Math.max(AGENT_SIDEBAR_WIDTH_MIN, Math.round(value)));
}

function readStoredAgentSidebarWidthPx(): number {
  if (typeof window === 'undefined') return AGENT_SIDEBAR_WIDTH_DEFAULT;
  try {
    const raw = window.localStorage.getItem(AGENT_SIDEBAR_WIDTH_STORAGE_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    if (!Number.isFinite(parsed)) return AGENT_SIDEBAR_WIDTH_DEFAULT;
    return clampAgentSidebarWidthPx(parsed);
  } catch {
    return AGENT_SIDEBAR_WIDTH_DEFAULT;
  }
}

export function AgentCallClient() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id') ?? '';

  const [session, setSession] = useState<AgentSessionPayload | null>(null);
  const [sessionError, setSessionError] = useState('');
  const [activeTab, setActiveTab] = useState<PanelTab>('persona');
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
  const [agentSidebarWidthPx, setAgentSidebarWidthPx] = useState(AGENT_SIDEBAR_WIDTH_DEFAULT);
  const [isPersonaPanelOpen, setIsPersonaPanelOpen] = useState(false);
  const agentSidebarResizeRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);

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
  const rumikRef = useRef<WebSocket | null>(null);
  const rumikReadyRef = useRef<Promise<WebSocket> | null>(null);
  const rumikDoneRef = useRef<(() => void) | null>(null);
  const pendingRumikRequestsRef = useRef(0);
  const pendingRumikSourcesRef = useRef(0);
  const rumikStreamDoneRef = useRef(false);
  const realtimePeerRef = useRef<RTCPeerConnection | null>(null);
  const realtimeDataChannelRef = useRef<RTCDataChannel | null>(null);
  const rumikSpeakingRef = useRef(false);
  const rumikPlaybackIdRef = useRef(0);
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
  const transcriptionAttemptRef = useRef(0);
  const rumikLeadingSilenceRef = useRef({ trimming: true, dropped: 0 });
  const latestMicRmsRef = useRef(0);
  const activeVoiceTimingTurnRef = useRef<VoiceTimingTurn | null>(null);
  const callAbortRef = useRef<AbortController | null>(null);

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
    void prefetchOpeningAudio();
    void prefetchThinkingFillerAudio();
  }, []);

  useEffect(() => {
    setAgentSidebarWidthPx(readStoredAgentSidebarWidthPx());
  }, []);

  const persistAgentSidebarWidthPx = useCallback((width: number) => {
    try {
      window.localStorage.setItem(AGENT_SIDEBAR_WIDTH_STORAGE_KEY, String(width));
    } catch {
      // ignore quota / private mode
    }
  }, []);

  const onAgentSidebarResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      agentSidebarResizeRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: agentSidebarWidthPx,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [agentSidebarWidthPx],
  );

  const onAgentSidebarResizePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = agentSidebarResizeRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = drag.startX - event.clientX;
    setAgentSidebarWidthPx(clampAgentSidebarWidthPx(drag.startWidth + delta));
  }, []);

  const endAgentSidebarResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = agentSidebarResizeRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      agentSidebarResizeRef.current = null;
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // already released
      }
      setAgentSidebarWidthPx((width) => {
        persistAgentSidebarWidthPx(width);
        return width;
      });
    },
    [persistAgentSidebarWidthPx],
  );

  const onAgentSidebarResizeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setAgentSidebarWidthPx((w) => {
          const next = clampAgentSidebarWidthPx(w + 12);
          persistAgentSidebarWidthPx(next);
          return next;
        });
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setAgentSidebarWidthPx((w) => {
          const next = clampAgentSidebarWidthPx(w - 12);
          persistAgentSidebarWidthPx(next);
          return next;
        });
      } else if (event.key === 'Home') {
        event.preventDefault();
        setAgentSidebarWidthPx(() => {
          persistAgentSidebarWidthPx(AGENT_SIDEBAR_WIDTH_MAX);
          return AGENT_SIDEBAR_WIDTH_MAX;
        });
      } else if (event.key === 'End') {
        event.preventDefault();
        setAgentSidebarWidthPx(() => {
          persistAgentSidebarWidthPx(AGENT_SIDEBAR_WIDTH_MIN);
          return AGENT_SIDEBAR_WIDTH_MIN;
        });
      }
    },
    [persistAgentSidebarWidthPx],
  );

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
          setCallState('incoming');
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
    setTranscript((lines) => [...lines.slice(-8), { role, text: cleanText }]);
  }, []);

  const finishRumikPlaybackTurn = useCallback(() => {
    if (!rumikStreamDoneRef.current || pendingRumikRequestsRef.current > 0 || pendingRumikSourcesRef.current > 0) return;

    rumikSpeakingRef.current = false;
    rumikDoneRef.current?.();
    rumikDoneRef.current = null;
    if (['speaking', 'thinking'].includes(callStateRef.current)) {
      callStateRef.current = 'connected';
      setCallState('connected');
    }
  }, []);

  const stopRumikAudio = useCallback(() => {
    logVoiceDebug('rumik:playback:stop', { activeSources: sourcesRef.current.length });
    rumikPlaybackIdRef.current += 1;
    rumikSpeakingRef.current = false;
    pendingRumikRequestsRef.current = 0;
    pendingRumikSourcesRef.current = 0;
    rumikStreamDoneRef.current = true;
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
  }, []);

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
      socket.close();
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
              const startAt = Math.max(scheduledAtRef.current, context.currentTime + 0.02);
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
    [appendTranscript, finishRumikPlaybackTurn],
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

  const playCachedOpeningAudio = useCallback(async (): Promise<boolean> => {
    if (openingAudioCache.chunks.length < 1) return false;

    stopRumikAudio();
    const playbackId = rumikPlaybackIdRef.current;

    if (!audioContextRef.current) audioContextRef.current = new AudioContext({ sampleRate: 24000 });
    await audioContextRef.current.resume();
    if (playbackId !== rumikPlaybackIdRef.current) return true;

    const context = audioContextRef.current;
    scheduledAtRef.current = Math.max(scheduledAtRef.current, context.currentTime + 0.02);
    setIsListening(false);
    callStateRef.current = 'speaking';
    setCallState('speaking');
    rumikSpeakingRef.current = true;

    logVoiceDebug('rumik:opening-cache:play', {
      chunks: openingAudioCache.chunks.length,
      status: openingAudioCache.status,
    });

    await new Promise<void>((resolve) => {
      let pendingSources = 0;
      let resolved = false;
      let nextChunkIndex = 0;
      let allChunksScheduled = false;

      const finish = () => {
        if (resolved) return;
        resolved = true;
        rumikSpeakingRef.current = false;
        rumikDoneRef.current = null;
        if (callStateRef.current !== 'idle' && callStateRef.current !== 'error') {
          callStateRef.current = 'connected';
          setCallState('connected');
        }
        resolve();
      };

      const maybeFinish = () => {
        if (allChunksScheduled && pendingSources === 0) finish();
      };

      const waitForOpeningCacheChange = () =>
        new Promise<void>((cacheResolve) => {
          openingAudioCache.waiters.push(cacheResolve);
        });

      const pumpChunks = async () => {
        while (!resolved && playbackId === rumikPlaybackIdRef.current) {
          if (nextChunkIndex >= openingAudioCache.chunks.length) {
            if (openingAudioCache.status === 'loading') {
              await waitForOpeningCacheChange();
              continue;
            }
            allChunksScheduled = true;
            maybeFinish();
            return;
          }

          const index = nextChunkIndex;
          const chunk = openingAudioCache.chunks[index];
          nextChunkIndex += 1;

          const buffer = pcm16ToAudioBuffer(context, chunk);
          const source = context.createBufferSource();
          source.buffer = buffer;
          source.connect(context.destination);
          const startAt = Math.max(scheduledAtRef.current, context.currentTime + 0.02);
          source.start(startAt);
          scheduledAtRef.current = startAt + buffer.duration;
          pendingSources += 1;
          sourcesRef.current.push(source);
          logVoiceDebug('rumik:opening-cache:scheduled', {
            packet: index + 1,
            durationMs: Math.round(buffer.duration * 1000),
            delayMs: Math.round((startAt - context.currentTime) * 1000),
            queueMs: Math.round(Math.max(0, scheduledAtRef.current - context.currentTime) * 1000),
          });
          source.onended = () => {
            sourcesRef.current = sourcesRef.current.filter((item) => item !== source);
            pendingSources -= 1;
            maybeFinish();
          };
        }

        allChunksScheduled = true;
        maybeFinish();
      };

      rumikDoneRef.current = finish;

      void pumpChunks();
    });

    return true;
  }, [stopRumikAudio]);

  const playCachedAudioChunks = useCallback(
    async (cache: OpeningAudioCache, label: string): Promise<boolean> => {
      if (cache.chunks.length < 1) return false;

      stopRumikAudio();
      const playbackId = rumikPlaybackIdRef.current;

      if (!audioContextRef.current) audioContextRef.current = new AudioContext({ sampleRate: 24000 });
      await audioContextRef.current.resume();
      if (playbackId !== rumikPlaybackIdRef.current) return true;

      const context = audioContextRef.current;
      scheduledAtRef.current = Math.max(scheduledAtRef.current, context.currentTime + 0.02);
      setIsListening(false);
      callStateRef.current = 'speaking';
      setCallState('speaking');
      rumikSpeakingRef.current = true;

      logVoiceDebug(`rumik:${label}-cache:play`, {
        chunks: cache.chunks.length,
        status: cache.status,
      });

      await new Promise<void>((resolve) => {
        let pendingSources = 0;
        let resolved = false;
        let nextChunkIndex = 0;
        let allChunksScheduled = false;

        const finish = () => {
          if (resolved) return;
          resolved = true;
          rumikSpeakingRef.current = false;
          rumikDoneRef.current = null;
          if (callStateRef.current !== 'idle' && callStateRef.current !== 'error') {
            callStateRef.current = 'connected';
            setCallState('connected');
          }
          resolve();
        };

        const maybeFinish = () => {
          if (allChunksScheduled && pendingSources === 0) finish();
        };

        const waitForCacheChange = () =>
          new Promise<void>((cacheResolve) => {
            cache.waiters.push(cacheResolve);
          });

        const pumpChunks = async () => {
          while (!resolved && playbackId === rumikPlaybackIdRef.current) {
            if (nextChunkIndex >= cache.chunks.length) {
              if (cache.status === 'loading') {
                await waitForCacheChange();
                continue;
              }
              allChunksScheduled = true;
              maybeFinish();
              return;
            }

            const index = nextChunkIndex;
            const chunk = cache.chunks[index];
            nextChunkIndex += 1;

            const buffer = pcm16ToAudioBuffer(context, chunk);
            const source = context.createBufferSource();
            source.buffer = buffer;
            source.connect(context.destination);
            const startAt = Math.max(scheduledAtRef.current, context.currentTime + 0.02);
            source.start(startAt);
            scheduledAtRef.current = startAt + buffer.duration;
            pendingSources += 1;
            sourcesRef.current.push(source);
            logVoiceDebug(`rumik:${label}-cache:scheduled`, {
              packet: index + 1,
              durationMs: Math.round(buffer.duration * 1000),
              delayMs: Math.round((startAt - context.currentTime) * 1000),
              queueMs: Math.round(Math.max(0, scheduledAtRef.current - context.currentTime) * 1000),
            });
            source.onended = () => {
              sourcesRef.current = sourcesRef.current.filter((item) => item !== source);
              pendingSources -= 1;
              maybeFinish();
            };
          }

          allChunksScheduled = true;
          maybeFinish();
        };

        rumikDoneRef.current = finish;

        void pumpChunks();
      });

      return true;
    },
    [stopRumikAudio],
  );

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
      scheduledAtRef.current = Math.max(scheduledAtRef.current, audioContextRef.current.currentTime + 0.04);

      setIsListening(false);
      callStateRef.current = 'speaking';
      setCallState('speaking');
      rumikSpeakingRef.current = true;
      if (resetPlayback) {
        rumikLeadingSilenceRef.current = { trimming: trimLeadingSilence, dropped: 0 };
      }
      const socket = await ensureRumikSocket(text);
      if (playbackId !== rumikPlaybackIdRef.current) return;

      const packet = { text: normalizeRumikText(text).slice(0, 2000), speaker_id: 0 };
      pendingRumikRequestsRef.current += 1;
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
      } catch (sendError) {
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
    [ensureRumikSocket, stopRumikAudio, waitForRumikPlaybackTurn],
  );

  const playThinkingFillerAudio = useCallback(async () => {
    const timingTurn = activeVoiceTimingTurnRef.current;
    if (timingTurn) {
      postVoiceTiming({
        callId: callIdRef.current,
        turn: timingTurn,
        event: 'filler_playback_start',
      });
    }
    const readyIndexes = thinkingFillerAudioCaches
      .map((cache, index) => ({ cache, index }))
      .filter(({ cache }) => cache.chunks.length > 0);
    const selectedIndex =
      readyIndexes.length > 0
        ? readyIndexes[Math.floor(Math.random() * readyIndexes.length)].index
        : Math.floor(Math.random() * STABLE_THINKING_FILLERS.length);
    const cache = thinkingFillerAudioCaches[selectedIndex];
    const text = STABLE_THINKING_FILLERS[selectedIndex];
    const transcriptText = stripTranscriptToneTag(text);

    appendTranscript('agent', transcriptText);

    if (cache.status === 'idle' || cache.status === 'error') {
      void prefetchAudioCache({ cache, text, label: 'thinking-filler' });
    }

    try {
      if (await playCachedAudioChunks(cache, 'thinking-filler')) return;
      await playRumikText(text, { trimLeadingSilence: false });
    } finally {
      if (timingTurn) {
        postVoiceTiming({
          callId: callIdRef.current,
          turn: timingTurn,
          event: 'filler_playback_end',
        });
      }
    }
  }, [appendTranscript, playCachedAudioChunks, playRumikText]);

  const playOpeningAudio = useCallback(async () => {
    if (isInactiveCallState(callStateRef.current)) return;
    if (await playCachedOpeningAudio()) return;
    if (isInactiveCallState(callStateRef.current)) return;
    if (openingAudioCache.status === 'idle' || openingAudioCache.status === 'error') {
      void prefetchOpeningAudio();
    }
    await playRumikText(STABLE_DEFAULT_OPENING, { trimLeadingSilence: false });
  }, [playCachedOpeningAudio, playRumikText]);

  const endCall = useCallback(() => {
    logVoiceDebug('call:end');
    callAbortRef.current?.abort();
    callAbortRef.current = null;
    setPlayOutboundTone(false);
    setUserVoiceVisual(false);
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
    setIsListening(false);
    closeRumikSocket();
    callVerifiedRef.current = false;
    callIdRef.current = '';
    pendingInterruptRef.current = '';
    callStateRef.current = 'idle';
    setCallState('idle');
    setDuration(0);
    setInterimText('');
  }, [closeRumikSocket]);

  const askAgent = useCallback(
    async (text: string) => {
      if (!session) return;
      if (respondingRef.current) {
        pendingInterruptRef.current = text;
        stopRumikAudio();
        logVoiceDebug('agent:interrupt:queued', { textChars: text.length });
        return;
      }
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
      const thinkingFillerPlayback = playThinkingFillerAudio().catch((fillerError) => {
        logVoiceDebug('agent:thinking-filler:error', {
          message: fillerError instanceof Error ? fillerError.message : 'Thinking filler playback failed',
        });
      });
      warmRumikSocket();
      let hasQueuedStreamAudio = false;

      try {
        const streamResponse = await streamResponsePromise;
        if (!streamResponse.ok || !streamResponse.body) {
          const data = await streamResponse.json().catch(() => ({}));
          throw new Error(data?.error || 'Could not get streamed agent response');
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

        const data = await readAgentResponseStream(streamResponse, (delta) => {
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
        });

        const tail = flushRumikChunkBuffer(chunkBuffer);
        if (tail) queueRumikChunk(tail);

        const answer = String(data.text || streamedText).trim();
        if (data.verified) callVerifiedRef.current = true;
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
        await Promise.all([thinkingFillerPlayback, playbackQueue]);
        await waitForRumikPlaybackTurn();
        if (data.endCallAfterResponse && !isInactiveCallState(callStateRef.current)) {
          endCall();
        }
        agentAbortControllerRef.current = null;
      } catch (agentError) {
        if (agentError instanceof Error && agentError.name === 'AbortError') {
          logVoiceDebug('agent:request:aborted', { message: agentError.message });
          agentAbortControllerRef.current = null;
          return;
        }
        const message = agentError instanceof Error ? agentError.message : 'Agent response failed';
        logVoiceDebug('agent:error', { message });
        if (!hasQueuedStreamAudio) {
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
            if (!response.ok) throw new Error(data?.error || 'Could not get agent response');
            const answer = String(data.text || '').trim();
            if (data.verified) callVerifiedRef.current = true;
            logVoiceDebug('agent:fallback:response', { status: response.status, text: answer, toolCalls: data.toolCalls ?? [] });
            const fallbackHistory: HistoryMessage[] = [
              ...historyRef.current,
              { role: 'user', text },
              { role: 'model', text: answer },
            ];
            historyRef.current = fallbackHistory.slice(-AGENT_CLIENT_HISTORY_LIMIT);
            appendTranscript('agent', answer);
            const answerPlayback = playRumikText(answer, { resetPlayback: false, waitForCompletion: false, timingLabel: 'answer' });
            await Promise.all([thinkingFillerPlayback, answerPlayback]);
            await waitForRumikPlaybackTurn();
            return;
          } catch (fallbackError) {
            logVoiceDebug('agent:fallback:error', {
              message: fallbackError instanceof Error ? fallbackError.message : 'Fallback agent response failed',
            });
          }
        }
        setError(message);
        setCallState('error');
        appendTranscript('system', message);
      } finally {
        respondingRef.current = false;
        const pendingInterrupt = pendingInterruptRef.current;
        pendingInterruptRef.current = '';
        if (pendingInterrupt && !isInactiveCallState(callStateRef.current)) {
          void askAgent(pendingInterrupt);
        }
      }
    },
    [
      appendTranscript,
      endCall,
      playRumikText,
      playThinkingFillerAudio,
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
      dataChannel.addEventListener('open', () => {
        logVoiceDebug('realtime:data-channel:open', { expires_at: tokenData.expires_at });
      });
      dataChannel.addEventListener('message', (event) => {
        try {
          const realtimeEvent = JSON.parse(String(event.data)) as OpenAIRealtimeTranscriptEvent;
          if (realtimeEvent.type === 'input_audio_buffer.speech_started') {
            setUserVoiceVisual(true);
            const shouldBargeIn =
              respondingRef.current ||
              callStateRef.current === 'thinking' ||
              callStateRef.current === 'speaking';
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
            if (!isInterruptibleTranscript(utterance)) return;
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
      logVoiceDebug('realtime:peer:connected');
    },
    [askAgent, performRealtimeBargeIn, sessionId],
  );

  const startCall = useCallback(async () => {
    if (!session || (callState !== 'idle' && callState !== 'incoming' && callState !== 'error')) return;
    const outboundRing = callState === 'idle' || callState === 'error';
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
    historyRef.current = [];
    callVerifiedRef.current = false;
    callIdRef.current =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `call-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    pendingInterruptRef.current = '';
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
    }
  }, [
    appendTranscript,
    askAgent,
    callState,
    connectOpenAIRealtimeTranscription,
    playOpeningAudio,
    session,
    sessionId,
    stopRumikAudio,
    syncMicrophoneRecorder,
    syncRealtimeMicrophoneTrack,
  ]);

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

  return (
    <main
      className={isPersonaPanelOpen ? 'agent-page agent-page--panel-open' : 'agent-page'}
      style={{ ['--agent-sidebar-width' as string]: `${agentSidebarWidthPx}px` } as React.CSSProperties}
    >
      <section className="voice-stage" aria-label="Voice call">
        <header className="voice-stage__header">
          <button type="button" className="agent-icon-btn" onClick={() => history.back()} aria-label="Go back">
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

      <button
        type="button"
        className="mobile-panel-handle"
        aria-controls="agent-persona-panel"
        aria-expanded={isPersonaPanelOpen}
        aria-label="Show persona panel"
        onClick={() => setIsPersonaPanelOpen(true)}
      >
        <ChevronLeftIcon />
      </button>

      <button
        type="button"
        className="mobile-panel-backdrop"
        aria-label="Hide persona panel"
        onClick={() => setIsPersonaPanelOpen(false)}
      />

      <aside className="persona-panel" id="agent-persona-panel" aria-label="Persona context">
        <div
          className="persona-panel__resize-edge"
          role="separator"
          aria-orientation="vertical"
          aria-controls="agent-persona-panel"
          aria-valuenow={agentSidebarWidthPx}
          aria-valuemin={AGENT_SIDEBAR_WIDTH_MIN}
          aria-valuemax={AGENT_SIDEBAR_WIDTH_MAX}
          tabIndex={0}
          aria-label="Resize persona and transcript panel. Drag sideways or use arrow keys when focused."
          onPointerDown={onAgentSidebarResizePointerDown}
          onPointerMove={onAgentSidebarResizePointerMove}
          onPointerUp={endAgentSidebarResize}
          onPointerCancel={endAgentSidebarResize}
          onKeyDown={onAgentSidebarResizeKeyDown}
        />
        <div className="panel-tabs" role="tablist" aria-label="Agent panel">
          <button
            type="button"
            className={activeTab === 'persona' ? 'panel-tab panel-tab--active' : 'panel-tab'}
            onClick={() => setActiveTab('persona')}
          >
            Persona
          </button>
          <button
            type="button"
            className={activeTab === 'questions' ? 'panel-tab panel-tab--active' : 'panel-tab'}
            onClick={() => setActiveTab('questions')}
          >
            Questions
          </button>
        </div>

        {activeTab === 'persona' ? (
          <div className="panel-section">
            <div className="persona-header">
              <h2>{session.brief.name}</h2>
              <p className="persona-customer-id">{session.brief.customerId}</p>
            </div>
            <div className="persona-detail-sections">
              {buildPersonaDetailSections(session.persona).map((section) => (
                <section key={section.id} className="persona-detail-section">
                  <h3>{section.title}</h3>
                  <div className="persona-detail-table-wrap">
                    <table className="persona-detail-table">
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
          </div>
        ) : (
          <div className="panel-section">
            <h2>Try asking</h2>
            <p className="suggestion-panel-intro">
              Each example lists the backend tools Stable Assist is expected to call for that kind of request.
            </p>
            <div className="suggestion-list">
              {session.suggestions.map((suggestion) => (
                <button
                  key={suggestion.id}
                  type="button"
                  className="suggestion-btn"
                  onClick={() => askAgent(suggestion.prompt)}
                  disabled={callState === 'thinking' || callState === 'speaking'}
                  aria-label={`${suggestion.label}. ${suggestion.prompt} Tools: ${suggestion.tools.join(', ')}.`}
                >
                  <span>{suggestion.label}</span>
                  <small className="suggestion-prompt">{suggestion.prompt}</small>
                  <small className="suggestion-tools">
                    <span className="suggestion-tools-label">Tools</span>
                    <span className="suggestion-tool-names">
                      {suggestion.tools.length > 0 ? suggestion.tools.join(', ') : 'None'}
                    </span>
                  </small>
                  <small className="suggestion-intent">Intent route: {suggestion.intent}</small>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="transcript-strip">
          {transcript.map((line, index) => (
            <p key={`${line.role}-${index}`} className={`transcript-line transcript-line--${line.role}`}>
              <strong>{line.role === 'agent' ? 'Stable Assist' : line.role === 'user' ? 'You' : 'System'}:</strong> {line.text}
            </p>
          ))}
        </div>
      </aside>
    </main>
  );
}
