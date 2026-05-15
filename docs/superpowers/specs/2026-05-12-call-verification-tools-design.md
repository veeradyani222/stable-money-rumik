# Call Verification Tools Design

## Goal

Keep the demo persona picker, but make the voice agent verify the caller during the call before it uses account details.

## Demo Behavior

The onboarding persona picker remains visible because this is a test/demo flow. The tester chooses a demo customer so the side panel can show the mobile last four and date of birth. The selected persona is a demo aid only; it is not treated as verified identity.

After the opening line, the first user message triggers verification regardless of the question. The agent asks for the registered mobile number's last four digits, then asks for date of birth. After both factors pass, it answers the original question using the existing payment, FD, KYC, secure-link, and support-ticket tools.

## Tool Design

Add `find_customer_by_mobile_last_4` and `verify_customer_dob` to the agent tool declarations.

`find_customer_by_mobile_last_4` accepts `mobile_last_4`. It checks the selected demo persona and returns `ok: true` with `verification_step: dob_required` when the last four digits match. It returns `ok: false` when the digits do not match.

`verify_customer_dob` accepts `date_of_birth`. It checks the selected demo persona and returns `ok: true`, `verified: true`, and safe customer context when the date matches. It returns `ok: false`, `verified: false` when it does not match.

Existing account tools continue to read from the selected persona. The prompt is responsible for calling the verification tools before account tools. Direct deterministic shortcuts in the OpenAI wrapper must not bypass that flow.

## Prompt Rules

The prompt must state that every call starts unverified, even after persona selection. The agent should ask for last four digits after the first user message no matter what the user asks. It must call `find_customer_by_mobile_last_4`, then ask for DOB, then call `verify_customer_dob`.

The prompt must tell the agent to remember the original user question and answer it after verification. It must not mention that the tester picked a persona, and it must not reveal account details before DOB verification.

## Error Handling

If the last four digits do not match, the agent asks once more in concise Hinglish. If DOB does not match, it asks once more. If verification still fails, it can only provide general support guidance and should avoid account-specific details.

## Read access state (mobile vs DOB)

Implementation uses a single tool, `verify_read_access`, with optional `date_of_birth`. Tool results include:

- `mobile_step_verified`: true once the last four digits matched the selected persona for this call (including while DOB is still wrong or pending). False when the last four did not match.
- `verification_step`: `mobile_last_4_required`, `dob_required`, or `complete`.

**Server-held demo gate:** After `mobile_step_verified` is true, the API persists the matched last four for `(session_id, call_id)` in process memory. The next HTTP turn passes it as `toolContext.verifiedMobileLast4` so `verify_read_access` can complete DOB verification even when the model omits `mobile_last_4` in the tool call. The gate is cleared when the call becomes fully verified (`markDemoCallVerified`). This prevents loops where a wrong DOB retry causes the model to drop mobile arguments and the backend then asks for mobile again.

**Normalization:** The OpenAI wrapper prefers `verifiedMobileLast4` from the server, then history-based mobile extraction, and avoids using a four-digit birth year from a user message as fake “mobile last four” when the message looks like a DOB answer.

## Testing

Tests cover tool declaration order, matching and failed verification results, prompt instructions, and the OpenAI tool loop executing verification tools instead of bypassing them with local inferred status shortcuts.
