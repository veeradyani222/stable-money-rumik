# Terminal Goodbye Audio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Suppress cached thinking filler on terminal goodbye turns, speak the generated goodbye, then end the call.

**Architecture:** The streamed agent endpoint emits turn policy metadata that tells the client whether filler is allowed and whether to hang up after playback. The client gates cached filler on that policy and calls the existing `endCall()` cleanup path only after response audio has finished.

**Tech Stack:** Next.js route handlers, React client component, Server-Sent Events, Node test runner.

---

### Task 1: Stream Turn Policy

**Files:**
- Modify: `app/api/agent/respond-stream/route.ts`
- Modify: `components/agent/AgentCallClient.tsx`
- Test: `tests/agent-call-client-flow.test.ts`

- [ ] **Step 1: Write source-level tests for policy events**

Add tests that assert the stream route emits a policy event and the client reads `suppressFiller` and `endCallAfterResponse` from stream messages.

- [ ] **Step 2: Run the flow tests and verify failure**

Run: `npm test -- tests/agent-call-client-flow.test.ts`
Expected: FAIL because the policy event and client fields are not implemented yet.

- [ ] **Step 3: Add policy fields to stream parsing**

Extend the client stream result type with `suppressFiller?: boolean` and `endCallAfterResponse?: boolean`. In `readAgentResponseStream`, read those booleans from an early `policy` event and preserve them in the final result.

- [ ] **Step 4: Emit a policy event from the server stream**

After the server computes the route/policy for the current transcript, enqueue an SSE event shaped like:

```ts
enqueue({ event: 'policy', data: { suppressFiller, endCallAfterResponse } });
```

The booleans should come from server-side agent/route logic rather than client-side transcript matching.

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/agent-call-client-flow.test.ts`
Expected: PASS for policy parsing and emission checks.

### Task 2: Gate Cached Filler

**Files:**
- Modify: `components/agent/AgentCallClient.tsx`
- Test: `tests/agent-call-client-flow.test.ts`

- [ ] **Step 1: Write source-level tests for filler gating**

Add tests that assert `askAgent()` does not call `playThinkingFillerAudio()` unconditionally before reading stream policy, and that terminal turns skip cached filler.

- [ ] **Step 2: Run the flow tests and verify failure**

Run: `npm test -- tests/agent-call-client-flow.test.ts`
Expected: FAIL because `askAgent()` currently starts filler immediately.

- [ ] **Step 3: Implement delayed filler startup**

Replace the immediate filler call with a small helper that starts filler only when the stream policy allows it. Keep normal turns fast by allowing filler after policy arrives.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/agent-call-client-flow.test.ts`
Expected: PASS for filler gating checks.

### Task 3: Hang Up After Goodbye Playback

**Files:**
- Modify: `components/agent/AgentCallClient.tsx`
- Test: `tests/agent-call-client-flow.test.ts`

- [ ] **Step 1: Write source-level tests for terminal hangup sequencing**

Add tests that assert `endCall()` is invoked after `await Promise.all([thinkingFillerPlayback, playbackQueue]);` and `await waitForRumikPlaybackTurn();` when `endCallAfterResponse` is true.

- [ ] **Step 2: Run the flow tests and verify failure**

Run: `npm test -- tests/agent-call-client-flow.test.ts`
Expected: FAIL because terminal turns do not currently hang up.

- [ ] **Step 3: Add post-playback hangup**

After response playback waits complete, check the stream result policy. If `endCallAfterResponse` is true and the call is still active, call `endCall()`.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/agent-call-client-flow.test.ts`
Expected: PASS.

### Task 4: Full Verification

**Files:**
- Test: `tests/agent-call-client-flow.test.ts`
- Test: `tests/intent-classifier.test.ts`

- [ ] **Step 1: Run focused tests**

Run: `npm test -- tests/agent-call-client-flow.test.ts tests/intent-classifier.test.ts`
Expected: PASS.

- [ ] **Step 2: Inspect git diff**

Run: `git diff -- components/agent/AgentCallClient.tsx app/api/agent/respond-stream/route.ts tests/agent-call-client-flow.test.ts`
Expected: Diff is limited to stream policy, filler gating, terminal hangup, and related tests.
