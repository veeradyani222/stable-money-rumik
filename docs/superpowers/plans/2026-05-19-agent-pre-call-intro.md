# Agent Pre-Call Intro Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a polished pre-call Stable Money Support intro before every agent call, move customer details into that intro, and remove the active-call side panel.

**Architecture:** Keep the feature inside the existing `AgentCallClient` and `agent-call.css` surface. Add a small client UI state that selects between the pre-call intro and the focused call stage while preserving the existing `startCall()` implementation and voice/audio flow.

**Tech Stack:** Next.js App Router, React client component state, TypeScript, CSS modules-by-convention via global `agent-call.css`, Node `node:test` source-inspection tests.

---

## File Structure

- Modify `components/agent/AgentCallClient.tsx`: add the pre-call intro renderer, call-entry state, customer detail rendering on the intro, and remove the rendered side panel from the active call UI.
- Modify `styles/agent-call.css`: make `.agent-page` single-column, add intro layout classes, and keep the active call stage full-screen.
- Modify `tests/agent-call-client-flow.test.ts`: replace side-panel expectations with pre-call intro expectations while preserving existing voice-flow tests.
- No commits are part of this plan because the user explicitly asked not to commit this work.

---

### Task 1: Add Source-Inspection Coverage For The New UI Contract

**Files:**
- Modify: `tests/agent-call-client-flow.test.ts`

- [ ] **Step 1: Replace the old mobile side-panel test expectations**

Find the existing test that asserts mobile panel behavior. It includes these patterns:

```ts
assert.match(clientSource, /className="mobile-panel-handle"/);
assert.match(clientSource, /className="mobile-panel-backdrop"/);
assert.match(clientSource, /setIsPersonaPanelOpen\(true\)/);
assert.match(clientSource, /setIsPersonaPanelOpen\(false\)/);
assert.doesNotMatch(clientSource, /className="mobile-panel-toggle"/);
assert.doesNotMatch(clientSource, /className="mobile-panel-close"/);
```

Replace that test with:

```ts
test('agent call client renders a pre-call intro instead of the side panel shell', () => {
  assert.match(clientSource, /const \[hasEnteredCall, setHasEnteredCall\] = useState\(false\);/);
  assert.match(clientSource, /className="agent-precall"/);
  assert.match(clientSource, /Stable Money Support/);
  assert.match(clientSource, /Call Stable Money Support/);
  assert.match(clientSource, /onClick=\{\(\) => void enterCall\(\)\}/);
  assert.match(clientSource, /buildPersonaDetailSections\(session\.persona\)\.map/);
  assert.doesNotMatch(clientSource, /className="mobile-panel-handle"/);
  assert.doesNotMatch(clientSource, /className="mobile-panel-backdrop"/);
  assert.doesNotMatch(clientSource, /className="persona-panel"/);
  assert.doesNotMatch(clientSource, /className="panel-tabs"/);
});
```

- [ ] **Step 2: Replace persona switching side-panel test**

Find the test named:

```ts
test('agent call client offers persona switching from the side panel and reloads the active call', () => {
```

Replace it with:

```ts
test('agent call client does not render persona switching in the call UI', () => {
  assert.match(clientSource, /import \{ PersonaDetailModal \} from '@\/components\/onboarding\/PersonaDetailModal';/);
  assert.match(clientSource, /const \[detailPersona, setDetailPersona\] = useState<PersonaSeed \| null>\(null\);/);
  assert.doesNotMatch(clientSource, /activeTab === 'changePersona'/);
  assert.doesNotMatch(clientSource, /Change persona/);
  assert.doesNotMatch(clientSource, /PERSONAS\.map\(\(persona\) =>/);
  assert.doesNotMatch(clientSource, /className=\{`persona-card persona-change-card/);
  assert.doesNotMatch(clientSource, /persona-change-card-status/);
});
```

- [ ] **Step 3: Add a focused call-entry test**

Add this test near the new pre-call intro test:

```ts
test('agent call client enters the existing startCall flow from the pre-call button', () => {
  const enterCallIndex = clientSource.indexOf('const enterCall = useCallback');
  const setEnteredIndex = clientSource.indexOf('setHasEnteredCall(true);', enterCallIndex);
  const startIndex = clientSource.indexOf('await startCall();', setEnteredIndex);
  const startCallIndex = clientSource.indexOf('const startCall = useCallback');

  assert.notEqual(enterCallIndex, -1);
  assert.notEqual(setEnteredIndex, -1);
  assert.notEqual(startIndex, -1);
  assert.notEqual(startCallIndex, -1);
  assert.ok(startCallIndex < enterCallIndex);
  assert.ok(enterCallIndex < setEnteredIndex);
  assert.ok(setEnteredIndex < startIndex);
});
```

- [ ] **Step 4: Run the focused tests and verify failure**

Run:

```bash
npm test -- tests/agent-call-client-flow.test.ts
```

Expected: fails because `hasEnteredCall`, `agent-precall`, `enterCall`, and removed panel expectations do not match the current implementation yet.

---

### Task 2: Add The Pre-Call Intro And Focused Call Render Path

**Files:**
- Modify: `components/agent/AgentCallClient.tsx`

- [ ] **Step 1: Remove unused side-panel-only state**

In `AgentCallClient`, remove these state declarations if no remaining logic uses them after the render change:

```ts
const [activeTab, setActiveTab] = useState<PanelTab>('persona');
const [agentSidebarWidthPx, setAgentSidebarWidthPx] = useState(AGENT_SIDEBAR_WIDTH_DEFAULT);
const [isPersonaPanelOpen, setIsPersonaPanelOpen] = useState(false);
const [personaChangeError, setPersonaChangeError] = useState('');
const [personaChangeSubmittingId, setPersonaChangeSubmittingId] = useState<string | null>(null);
```

Also remove side-panel resize handlers and persona-changing helpers only when TypeScript reports they are unused. Keep `detailPersona` and `PersonaDetailModal` if the intro customer details include a details action.

- [ ] **Step 2: Add call-entry state and handler after `startCall`**

Add this state near the other UI state:

```ts
const [hasEnteredCall, setHasEnteredCall] = useState(false);
```

After `startCall`, add:

```ts
const enterCall = useCallback(async () => {
  setHasEnteredCall(true);
  await startCall();
}, [startCall]);
```

- [ ] **Step 3: Add a pre-call branch after session loading**

After the `if (!session)` return and before the final call-stage return, add:

```tsx
if (!hasEnteredCall) {
  return (
    <main className="agent-page agent-page--precall">
      <section className="agent-precall" aria-label="Stable Money Support introduction">
        <header className="agent-precall__header">
          <button type="button" className="agent-icon-btn" onClick={() => history.back()} aria-label="Go back">
            <BackIcon />
          </button>
          <div>
            <p className="agent-precall__eyebrow">Stable Money Support</p>
            <h1>Support that is ready before the call starts.</h1>
          </div>
        </header>

        <div className="agent-precall__hero">
          <div className="agent-precall__intro">
            <p className="agent-precall__kicker">Account support assistant</p>
            <h2>Talk through fixed deposits, payments, KYC, and account questions.</h2>
            <p>
              Review the active demo customer below, then start a focused support call with the same voice flow and
              verification behavior.
            </p>
            <button type="button" className="call-primary agent-precall__call" onClick={() => void enterCall()}>
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
      <PersonaDetailModal
        persona={detailPersona}
        onClose={() => setDetailPersona(null)}
        onChoose={async (id) => {
          setDetailPersona(null);
          await changePersona(id);
        }}
      />
    </main>
  );
}
```

- [ ] **Step 4: Simplify the active call return**

Change the final return opening from:

```tsx
<main
  className={isPersonaPanelOpen ? 'agent-page agent-page--panel-open' : 'agent-page'}
  style={{ ['--agent-sidebar-width' as string]: `${agentSidebarWidthPx}px` } as React.CSSProperties}
>
```

to:

```tsx
<main className="agent-page agent-page--call">
```

Remove the rendered mobile panel buttons and the entire `<aside className="persona-panel" ...>...</aside>` block from the final return. Keep the existing `<section className="voice-stage" aria-label="Voice call">...</section>` and the trailing `PersonaDetailModal` only if `detailPersona` remains used.

- [ ] **Step 5: Run TypeScript or tests to catch unused code**

Run:

```bash
npm test -- tests/agent-call-client-flow.test.ts
```

Expected: remaining failures are only from unused imports/state or CSS expectations. Remove unused imports such as `PERSONAS`, `PanelTab`, and side-panel constants only after the test output or TypeScript makes them clear.

---

### Task 3: Style The Intro And Single-Column Call Shell

**Files:**
- Modify: `styles/agent-call.css`

- [ ] **Step 1: Make the default agent page single-column**

Replace the current `.agent-page` grid sidebar definition:

```css
grid-template-columns: minmax(0, 1fr) var(--agent-sidebar-width, 380px);
```

with:

```css
grid-template-columns: minmax(0, 1fr);
```

Add:

```css
.agent-page--precall {
  min-height: 100vh;
  height: auto;
  overflow-y: auto;
}

.agent-page--call {
  height: 100vh;
  overflow: hidden;
}
```

- [ ] **Step 2: Add intro layout styles**

Add these styles after `.mobile-panel-handle svg` or another nearby shell section:

```css
.agent-precall {
  width: min(1180px, calc(100% - 32px));
  min-height: 100vh;
  margin: 0 auto;
  padding: clamp(22px, 4vw, 48px) 0;
  display: grid;
  gap: clamp(28px, 4vw, 44px);
}

.agent-precall__header {
  display: flex;
  align-items: center;
  gap: 16px;
}

.agent-precall__header h1,
.agent-precall__hero h2,
.agent-precall__details-heading h2 {
  margin: 0;
  color: var(--text);
  font-family: 'Cinzel', serif;
  letter-spacing: 0;
}

.agent-precall__header h1 {
  font-size: clamp(1.35rem, 3vw, 2.35rem);
  line-height: 1.12;
}

.agent-precall__eyebrow,
.agent-precall__kicker {
  margin: 0 0 8px;
  color: var(--primary);
  font-size: 0.76rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.agent-precall__hero {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(300px, 0.9fr);
  gap: clamp(20px, 4vw, 40px);
  align-items: stretch;
}

.agent-precall__intro {
  display: flex;
  min-height: 420px;
  flex-direction: column;
  justify-content: center;
  padding: clamp(24px, 5vw, 56px);
  border: 1px solid color-mix(in srgb, var(--primary) 28%, transparent);
  background: color-mix(in srgb, var(--bg-mid) 82%, black 18%);
}

.agent-precall__intro h2 {
  max-width: 760px;
  font-size: clamp(2rem, 5vw, 4.35rem);
  line-height: 0.98;
}

.agent-precall__intro p:not(.agent-precall__kicker) {
  max-width: 640px;
  margin: 18px 0 0;
  color: var(--text-muted);
  font-size: clamp(1rem, 2vw, 1.15rem);
  line-height: 1.65;
}

.agent-precall__call {
  width: fit-content;
  margin-top: 30px;
}

.agent-precall__capabilities {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.agent-precall__capabilities article {
  min-height: 180px;
  padding: 18px;
  border: 1px solid var(--border);
  background: var(--surface);
}

.agent-precall__capabilities span {
  display: inline-flex;
  min-width: 42px;
  min-height: 30px;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
  border: 1px solid color-mix(in srgb, var(--primary) 36%, transparent);
  color: var(--primary);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.agent-precall__capabilities h3,
.agent-precall-detail h3 {
  margin: 0 0 8px;
  color: var(--text);
  font-family: 'Cinzel', serif;
  font-size: 1rem;
  text-transform: uppercase;
}

.agent-precall__capabilities p {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.92rem;
  line-height: 1.5;
}
```

- [ ] **Step 3: Add customer detail styles**

Add:

```css
.agent-precall__details {
  display: grid;
  gap: 18px;
  padding-bottom: 32px;
}

.agent-precall__details-heading {
  display: grid;
  gap: 2px;
}

.agent-precall__details-heading p:last-child {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.95rem;
}

.agent-precall__detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.agent-precall-detail {
  min-width: 0;
}

.agent-precall-detail__table-wrap {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}

.agent-precall-detail__table {
  width: 100%;
  min-width: 420px;
  border-collapse: collapse;
}

.agent-precall-detail__table th,
.agent-precall-detail__table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
  font-size: 0.8rem;
  line-height: 1.4;
}

.agent-precall-detail__table th {
  color: var(--text-muted);
  background: var(--surface-raised);
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  white-space: nowrap;
}

.agent-precall-detail__table td {
  color: var(--text);
}

.agent-precall-detail__table tr:last-child td {
  border-bottom: 0;
}
```

- [ ] **Step 4: Add responsive rules**

Inside the existing `@media (max-width: 900px)` block, add:

```css
.agent-page--precall {
  height: auto;
}

.agent-precall {
  width: min(100% - 24px, 720px);
  padding-top: max(20px, env(safe-area-inset-top));
}

.agent-precall__hero,
.agent-precall__detail-grid {
  grid-template-columns: 1fr;
}

.agent-precall__intro {
  min-height: 360px;
  padding: 24px;
}

.agent-precall__capabilities {
  grid-template-columns: 1fr;
}
```

Delete mobile CSS that only exists for the removed side panel:

```css
.persona-panel { ... }
.agent-page--panel-open .persona-panel { ... }
.persona-panel__resize-edge { ... }
.mobile-panel-handle { ... }
.agent-page--panel-open .mobile-panel-handle { ... }
.agent-page--panel-open .mobile-panel-backdrop { ... }
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- tests/agent-call-client-flow.test.ts
```

Expected: `agent-call-client-flow.test.ts` passes or reports only source-inspection patterns that need minor regex adjustment.

---

### Task 4: Final Verification

**Files:**
- Verify: `components/agent/AgentCallClient.tsx`
- Verify: `styles/agent-call.css`
- Verify: `tests/agent-call-client-flow.test.ts`

- [ ] **Step 1: Run the agent flow tests**

Run:

```bash
npm test -- tests/agent-call-client-flow.test.ts
```

Expected: all tests in that file pass.

- [ ] **Step 2: Run the broader relevant tests**

Run:

```bash
npm test -- tests/persona-panel.test.ts tests/persona-card-css.test.ts tests/agent-layout-css.test.ts tests/agent-visualizer-bar-layout.test.ts tests/agent-call-visualizer-bar.test.ts
```

Expected: all listed tests pass. If `persona-panel.test.ts` only covers library data helpers, keep it. If it asserts removed UI, update it to cover intro customer-detail rendering or remove the stale assertion.

- [ ] **Step 3: Run type checking**

Run:

```bash
npm run typecheck
```

Expected: no TypeScript errors. If the repo does not define `typecheck`, run:

```bash
npx tsc --noEmit
```

Expected: no TypeScript errors.

- [ ] **Step 4: Manual UI check**

Start the app:

```bash
npm run dev
```

Open an existing demo session URL for `/agent?session_id=...`.

Verify:

- The first screen is the pre-call intro every visit.
- The call button starts the existing call flow.
- The active call screen has no right-side panel.
- Mobile width shows intro content stacked and the call screen full-screen.
- Back, mute, end call, and error retry states still behave.

---

## Self-Review

- Spec coverage: the plan covers the every-visit intro, call button, moved customer details, focused call screen, side-panel removal, error preservation, and test updates.
- Placeholder scan: no TBD, TODO, or unspecified implementation steps remain.
- Type consistency: the plan consistently uses `hasEnteredCall`, `enterCall`, `startCall`, `buildPersonaDetailSections(session.persona)`, and existing CSS naming under `agent-precall`.
