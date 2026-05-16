# Rumik Opening Audio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play a saved Rumik opening line immediately after Answer while keeping realtime VAD active.

**Architecture:** Add a static opener audio source in `public/assets/audio/` and make `AgentCallClient.tsx` prefer it before the existing in-memory/live Rumik opening fallback. Track the active local opener audio so the existing stop and barge-in paths can cancel it.

**Tech Stack:** Next.js client component, browser `HTMLAudioElement`, Node test runner source-level tests.

---

### Task 1: Source-Level Failing Tests

**Files:**
- Modify: `tests/agent-call-client-flow.test.ts`

- [ ] **Step 1: Write tests that require the static opening asset path**

```ts
test('agent call client prefers the static Rumik opening asset before generated opening audio', () => {
  const srcIndex = clientSource.indexOf("const STATIC_RUMIK_OPENING_SRC = '/assets/audio/rumik-opening.wav';");
  const playOpeningIndex = clientSource.indexOf('const playOpeningAudio = useCallback');
  const staticIndex = clientSource.indexOf('await playStaticOpeningAudio()', playOpeningIndex);
  const cachedIndex = clientSource.indexOf('await playCachedOpeningAudio()', playOpeningIndex);
  const generatedIndex = clientSource.indexOf('await playRumikText(STABLE_DEFAULT_OPENING', playOpeningIndex);

  assert.notEqual(srcIndex, -1);
  assert.notEqual(playOpeningIndex, -1);
  assert.notEqual(staticIndex, -1);
  assert.notEqual(cachedIndex, -1);
  assert.notEqual(generatedIndex, -1);
  assert.ok(staticIndex < cachedIndex);
  assert.ok(cachedIndex < generatedIndex);
});
```

- [ ] **Step 2: Write tests that require local opener stop support**

```ts
test('agent call client stops static opening audio during assistant stop paths', () => {
  const refIndex = clientSource.indexOf('const staticOpeningAudioRef = useRef<HTMLAudioElement | null>(null);');
  const stopIndex = clientSource.indexOf('const stopRumikAudio = useCallback');
  const pauseIndex = clientSource.indexOf('staticOpeningAudioRef.current?.pause();', stopIndex);
  const clearIndex = clientSource.indexOf('staticOpeningAudioRef.current = null;', pauseIndex);

  assert.notEqual(refIndex, -1);
  assert.notEqual(stopIndex, -1);
  assert.notEqual(pauseIndex, -1);
  assert.notEqual(clearIndex, -1);
  assert.ok(stopIndex < pauseIndex);
  assert.ok(pauseIndex < clearIndex);
});
```

- [ ] **Step 3: Run the focused test and confirm RED**

Run: `npm test -- tests/agent-call-client-flow.test.ts`

Expected: FAIL because `STATIC_RUMIK_OPENING_SRC`, `playStaticOpeningAudio`, and `staticOpeningAudioRef` do not exist yet.

### Task 2: Static Opening Runtime Path

**Files:**
- Modify: `components/agent/AgentCallClient.tsx`
- Create: `public/assets/audio/rumik-opening.wav`

- [ ] **Step 1: Add the static source and audio ref**

```tsx
const STATIC_RUMIK_OPENING_SRC = '/assets/audio/rumik-opening.wav';
const staticOpeningAudioRef = useRef<HTMLAudioElement | null>(null);
```

- [ ] **Step 2: Stop local opener audio from `stopRumikAudio`**

```tsx
staticOpeningAudioRef.current?.pause();
staticOpeningAudioRef.current = null;
```

- [ ] **Step 3: Add `playStaticOpeningAudio`**

```tsx
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
    const cleanup = (played: boolean) => {
      if (staticOpeningAudioRef.current === audio) staticOpeningAudioRef.current = null;
      rumikSpeakingRef.current = false;
      if (playbackId === rumikPlaybackIdRef.current && !isInactiveCallState(callStateRef.current)) {
        callStateRef.current = 'connected';
        setCallState('connected');
      }
      resolve(played);
    };
    audio.onended = () => cleanup(true);
    audio.onerror = () => cleanup(false);
  });

  try {
    await audio.play();
  } catch {
    if (staticOpeningAudioRef.current === audio) staticOpeningAudioRef.current = null;
    rumikSpeakingRef.current = false;
    return false;
  }

  return finished;
}, [stopRumikAudio]);
```

- [ ] **Step 4: Prefer static audio in `playOpeningAudio`**

```tsx
if (await playStaticOpeningAudio()) return;
if (await playCachedOpeningAudio()) return;
```

- [ ] **Step 5: Generate `public/assets/audio/rumik-opening.wav` from Rumik**

Use `RUMIK_API_KEY`, `RUMIK_BASE_URL`, and `RUMIK_TTS_MODEL` from local env if available. The WAV should contain the normalized `STABLE_DEFAULT_OPENING` speech as 24 kHz mono PCM16.

### Task 3: Verification

**Files:**
- Test: `tests/agent-call-client-flow.test.ts`

- [ ] **Step 1: Run focused tests**

Run: `npm test -- tests/agent-call-client-flow.test.ts`

Expected: PASS.

- [ ] **Step 2: Run all tests**

Run: `npm test`

Expected: PASS or report exact failures without claiming completion.
