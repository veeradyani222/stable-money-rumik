# Call Verification Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add call-time verification tools so the demo persona picker remains visible while the agent verifies last four mobile digits and DOB before account answers.

**Architecture:** Extend the existing Stable tool layer with two verification tools and prompt rules. Remove local inferred account-tool shortcuts from the OpenAI streaming and fallback paths so the model-driven verification flow cannot be bypassed.

**Tech Stack:** Next.js app routes, TypeScript, Node `test`, OpenAI Responses API wrapper.

---

## File Structure

- Modify `lib/agent/stable-tools.ts` to declare and execute the two verification tools.
- Modify `lib/agent/openai-agent.ts` to update prompt rules and prevent local account-tool inference from skipping verification.
- Modify `lib/agent/gemini-agent.ts` to keep the fallback prompt aligned.
- Modify `tests/stable-tools.test.ts` for verification tool contracts.
- Modify `tests/openai-agent.test.ts` for prompt and OpenAI tool loop behavior.
- Modify `tests/gemini-agent.test.ts` for prompt alignment.

### Task 1: Verification Tool Contracts

**Files:**
- Modify: `tests/stable-tools.test.ts`
- Modify: `lib/agent/stable-tools.ts`

- [ ] **Step 1: Write failing tests**

Add tests that expect `stableToolDeclarations` to include `find_customer_by_mobile_last_4` and `verify_customer_dob`, and expect `executeStableTool` to return successful and failed verification results.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/stable-tools.test.ts`

Expected: FAIL because the new tool names and results do not exist.

- [ ] **Step 3: Implement tool declarations and execution**

Add both tool declarations before account-specific tools. Implement last-four normalization and DOB comparison against the selected demo persona.

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- tests/stable-tools.test.ts`

Expected: PASS for stable tool tests.

### Task 2: Prompt Rules And OpenAI Flow

**Files:**
- Modify: `tests/openai-agent.test.ts`
- Modify: `lib/agent/openai-agent.ts`

- [ ] **Step 1: Write failing tests**

Update prompt assertions to require every call to start unverified, ask last four after the first user message, call both verification tools, remember the original question, and avoid account details before DOB verification. Add a streaming test proving a payment query goes to OpenAI instead of directly calling `check_payment_status`.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/openai-agent.test.ts`

Expected: FAIL because the current prompt still allows signed app access and streaming locally infers account tools.

- [ ] **Step 3: Implement prompt and shortcut changes**

Change `buildStableSystemPrompt` to describe the demo verification flow. Remove or disable local `inferStatusToolFromTranscript` use before OpenAI in both `streamStableAgentText` and `runStableAgent`; keep support-ticket inference only if it remains behind the model path, otherwise let OpenAI call tools.

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- tests/openai-agent.test.ts`

Expected: PASS for OpenAI agent tests.

### Task 3: Gemini Prompt Alignment

**Files:**
- Modify: `tests/gemini-agent.test.ts`
- Modify: `lib/agent/gemini-agent.ts`

- [ ] **Step 1: Write failing tests**

Update Gemini prompt assertions to match the verification flow and tool declarations.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/gemini-agent.test.ts`

Expected: FAIL because the Gemini prompt still describes signed app access.

- [ ] **Step 3: Implement Gemini prompt update**

Mirror the OpenAI prompt verification rules in `buildStableSystemPrompt`.

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- tests/gemini-agent.test.ts`

Expected: PASS for Gemini tests.

### Task 4: Full Verification

**Files:**
- All changed files

- [ ] **Step 1: Run focused tests**

Run: `npm test -- tests/stable-tools.test.ts tests/openai-agent.test.ts tests/gemini-agent.test.ts`

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run: `npm test`

Expected: PASS or report any unrelated existing failures with exact output.

## Self-Review

The plan covers the approved separate verification tool approach. It keeps persona selection for demo side-panel visibility, adds tool contracts, updates prompts, removes shortcut bypasses, and verifies with focused plus full tests. There are no placeholders or undefined task-owned functions.
