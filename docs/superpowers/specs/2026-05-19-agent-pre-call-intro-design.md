# Agent Pre-Call Intro Design

## Goal

Users who enter the agent page after email login should not be dropped directly into an active call-style screen. Every visit to `/agent` should first show a polished Stable Money Support intro, explain what the assistant can help with, show the active demo customer details, and offer one clear button to start the call.

After the user presses the call button, the existing voice call flow should run as it does today. The call screen should be focused on the call only and should remove the current right-side persona/details panel.

## User Experience

### Pre-call intro

When a valid session is loaded, the initial screen shows:

- A full-page Stable Money Support introduction.
- A concise explanation that the assistant can help with account and fixed-deposit support.
- Capability rows for:
  - Fixed deposit status and booking help.
  - Payments, refunds, and maturity questions.
  - KYC and account verification support.
  - Nominee, interest, and customer profile queries.
- A primary `Call Stable Money Support` action.
- Demo customer details below the call action, using the same persona detail data currently shown in the side panel.

The intro appears every time the user lands on the agent page. It is not persisted or dismissed across visits.

### Call screen

After the user presses the call button:

- The existing `startCall()` behavior begins.
- Microphone permission, realtime transcription setup, opening audio playback, Rumik audio playback, interruption handling, mute, and end-call behavior remain unchanged.
- The visible UI is only the focused voice call stage: back button, orb, timer, visualizer, and call controls.
- The right-side persona panel, mobile panel handle, panel tabs, persona switching UI, suggestion buttons, and transcript strip are not shown in this first version.

## Component Design

The implementation should stay inside `components/agent/AgentCallClient.tsx` and `styles/agent-call.css` unless a small local component extraction clearly improves readability.

`AgentCallClient` should add a client-only UI state such as `hasEnteredCall` or `showCallStage`. The state starts false after the session loads. The pre-call button should set this state true and invoke the existing `startCall()` flow.

The existing session loading and session error states remain unchanged.

The persona detail data should continue to come from `buildPersonaDetailSections(session.persona)` so the intro uses the same source of truth as the current panel.

## Layout And Styling

The pre-call intro should use the current Stable Money visual language:

- Dark background and existing typography.
- Gold primary action treatment.
- Calm support-focused hierarchy, with the support identity prominent in the first viewport.
- Compact, readable customer details below the primary action.
- Responsive layout that stacks cleanly on mobile.

The call screen should no longer reserve space for a sidebar. Once the call stage is active, the page should use a single-column/full-width layout.

## Removed From This Version

This change intentionally removes the current side panel from the active call UI:

- Persona tab.
- Ask/suggestion tab.
- Change persona tab.
- Resizable sidebar.
- Mobile side-panel handle and backdrop.
- Transcript strip and verification badge display.

The underlying transcript and verification state may remain in code if needed by call behavior, but those details should not be rendered in the call UI for this iteration.

## Error Handling

Existing session and call errors should continue to work:

- If the session cannot load, keep the current session error panel behavior.
- If call start fails, preserve the existing call error state and allow the user to retry from the call UI.
- Do not change API contracts, voice routes, Rumik socket behavior, or agent streaming behavior.

## Testing

Update the existing source-inspection tests in `tests/agent-call-client-flow.test.ts` or add focused tests that verify:

- The pre-call support intro exists in `AgentCallClient`.
- The call button invokes the existing `startCall()` path.
- Customer details on the intro are rendered from `buildPersonaDetailSections(session.persona)`.
- The main rendered UI no longer includes the `persona-panel`, mobile panel handle, panel tabs, suggestion list, or persona change UI.
- Existing call flow ordering tests still pass.

Manual verification should include desktop and mobile viewport checks for:

- Initial pre-call screen.
- Call screen after pressing the button.
- Error/retry state.

## Out Of Scope

- New routing for the intro.
- Persisting intro dismissal.
- Reworking the agent voice/audio stack.
- Adding new customer data.
- Reintroducing transcript, suggestions, or persona switching elsewhere.
