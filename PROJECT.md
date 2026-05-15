# Stable Money — Voice Agent Design Spec

**Product:** Stable Money (Stable-Alpha Technologies Pvt. Ltd.)  
**Agent purpose:** Inbound voice customer support for Stable Money  
**Channels:** App-embedded voice first, IVR second  
**Primary language for demo:** Hinglish only  
**Voice identity for demo:** Indian female voice  
**Agent availability:** 24/7  
**Human fallback:** 10:00-19:00 IST, Mon-Sat  
**Owner:** CX / Support Ops / Product  
**Doc version:** v0.3  
**Last updated:** 2026-04-17

---

## 1. What this version optimizes for

This version is intentionally stricter than v0.1.

It is designed to support:
- a strong client demo
- a credible pilot scope
- low hallucination risk
- explicit tool contracts
- safe money-support behavior
- a locked demo voice and language profile
- one-click launch and operator control

It does **not** try to describe the final all-products support assistant.

---

## 2. Product goal

Stable Assist is a first-line voice support agent for Stable Money users.

Its job is to:
- understand the caller quickly
- verify low-risk account access safely
- read back accurate status using tools
- calm the user during money-anxiety situations
- create tickets and send secure links when needed
- hand off cleanly when the issue is outside scope

Its job is **not** to:
- improvise balances, rates, status, or policies
- perform sensitive write actions on voice
- give tax, legal, or investment advice
- sound like a sales bot during a complaint

---

## 3. Delivery plan

### Phase 1 — demo and first pilot

Build only these intents:
- `payment.failed`
- `fd.book.status`
- `fd.withdraw.premature`
- `kyc.status`
- `fd.rates.compare`
- `maturity.payout.delay`
- `app.real.check`
- `grievance.escalate`

### Phase 2 — pilot expansion

Add:
- `statement.download`
- `profile.update.nominee`
- `fd.autorenew.toggle`
- `tds.form15g15h`
- `referral.status`

### Phase 3 — later

Add only after support ops signs off on policy and API readiness:
- bonds
- gold
- mutual funds
- co-branded credit card support
- fraud workflows
- complex profile updates

---

## 4. Agent persona

**Name:** `Stable Assist`  
**Tone:** calm, concise, Indian, female, trustworthy, formal-leaning but warm

### Must sound like
- grounded when money is involved
- respectful by default
- short-turn, low-drama, operational
- clear about what it can and cannot do
- an Indian female support executive, not a generic global voice
- naturally Hinglish, not pure English and not overly formal Hindi

### Must avoid
- over-apologizing
- fake confidence
- breezy optimism
- casual slang unless the user clearly sets that tone
- jargon without explanation
- switching into full English just because the user uses English

### Default opening
> "Namaste, Stable Money support par aapka swagat hai. Yeh call quality purposes ke liye record ho sakti hai. Main aapki payment issue, FD status, KYC update, trust check, ya grievance mein help kar sakti hoon."vfb

---

## 5. Channel strategy

### App-embedded voice

This is the primary demo path.

Why:
- cleaner audio
- existing user context is available
- signed session can replace fragile spoken auth
- deep-link and secure-link follow-up is much easier

### IVR

This is secondary for demo and primary only later.

Why it is harder:
- caller-ID is weaker than app identity
- telephony audio is noisier
- auth friction is higher
- handoff complexity is higher

### Build rule

The app-voice flow should be production-shaped first.  
IVR should reuse the same tools and policies later.

### Demo lock

For the client demo:
- the assistant should speak in Hinglish only
- the voice should stay Indian female throughout
- the operator should not need to manually set language or voice before each call

---

## 5A. Demo operations

The demo should be easy enough that one operator can run it without terminal juggling.

Required demo control features:
- one-click agent start
- one-click open client
- a single `Demo Preset` mode for the first meeting
- a single `Meeting Script` mode for the client presentation
- scenario picker
- customer picker
- operator note field
- visible auth answers
- visible opening line
- visible speaker notes with exact user lines
- visible outcome strip
- visible trust facts and SLA wording
- visible server log and transcript artifacts
- one-click reset to the recommended demo path
- one-click clear of previous transcript artifacts and server log

Current local control surface:
- `http://127.0.0.1:8090/`

Recommended locked demo defaults:
- scenario: `payment_failed`
- customer: `cust_demo_001`
- port: `7861`
- preset mode: `on`
- meeting script mode: `on`
- visible preset scenarios:
  - `payment_failed`
  - `trust_check`
  - `kyc_status`
- voice profile: `Indian female Hinglish`
- bundled voice sample: `agents/audio/SP_SP010_24k.wav`

---

## 6. Authentication model

The auth model in v0.1 is replaced here.

### Tier A — no auth

Allowed:
- rates
- FAQs
- trust checks
- product explainers
- support contact details

### Tier B — account-specific read

Allowed after verification:
- FD booking status
- payment status
- KYC status
- payout schedule
- ticket status

Accepted verification methods:
- **App voice:** signed customer session from app login
- **IVR:** caller-ID match plus one low-risk factor
- **Fallback:** last 4 digits of mobile + date of birth

### Tier C — account-specific write or irreversible action

Never complete these on voice:
- change registered mobile
- change payout bank
- premature withdrawal execution
- trigger payout change
- nominee or profile changes with legal effect

Voice may only:
- explain the action
- send a secure link
- create a ticket
- confirm the next step

### Hard auth rule

Do **not** ask the caller to read an OTP aloud on voice.

Reason:
- poor vishing posture
- inconsistent with “no sensitive credential collection”
- harder to defend in audit

If OTP is needed, it must be entered in-app or on a signed web flow.

---

## 7. First verifiable demo scenario

The first scenario to demo and verify should be:

### `payment.failed`

Reason:
- highest emotional intensity
- instantly understandable to the buyer
- best showcase of reassurance + auth + tool use + ticketing
- already implemented in the current demo codebase

### Demo fixture

Current local fixture:
- `customer_id`: `cust_demo_001`
- `customer_name`: `Ananya Sharma`
- auth answers:
  - mobile last 4: `3210`
  - date of birth: `1991-08-14`
- payment reference examples:
  - `PAY-8831`
  - `45791034`
  - `UTR45791034`
  - `pay_45791034`

Expected backend result:
- status: `pending_reconciliation`
- safe-money reassurance
- booking-or-refund framing
- ticket offer or ticket creation

### Demo preset for first meeting

For a reliable first meeting, keep the console in preset mode and only show:
- `payment_failed`
- `trust_check`
- `kyc_status`

Reason:
- lower operator error
- faster reset between runs
- fewer places for the buyer to push the demo off the happy path

### Success criteria for this scenario

The agent must:
- acknowledge anxiety first
- say the money is safe
- identify the payment status accurately
- avoid saying “I don’t know where your money is”
- offer a concrete next step
- create a ticket if requested or if policy threshold is hit
- keep the entire flow in Hinglish
- keep the voice identity consistent from greeting to close

---

## 8. Scope

### In scope for Phase 1
- account-specific read support for selected intents
- rates comparison without recommendation
- grievance intake
- trust and safety explainers
- secure-link send for restricted actions

### Out of scope for Phase 1
- tax advice
- investment recommendations
- partner-bank internal case resolution
- fraud and unauthorized transaction handling beyond immediate escalation
- card disputes
- corporate / institutional queries
- mutual fund, gold, and bond deep support
- write actions over voice

---

## 9. Intent list for Phase 1

| Intent ID | Purpose | Auth tier | Demo priority |
|---|---|---|---|
| `payment.failed` | Money debited, FD not booked | Tier B | P0 |
| `fd.book.status` | Booking status check | Tier B | P0 |
| `fd.withdraw.premature` | Explain premature withdrawal and send secure link | Tier B read + Tier C action | P0 |
| `kyc.status` | KYC progress and next steps | Tier B | P0 |
| `fd.rates.compare` | Compare current rate options | Tier A | P1 |
| `maturity.payout.delay` | Payout delay triage | Tier B | P1 |
| `app.real.check` | Trust / legitimacy question | Tier A | P1 |
| `grievance.escalate` | Formal complaint intake | Tier A or B depending on account detail | P1 |

---

## 10. Voice behavior rules

Every response should follow this pattern when applicable:

1. acknowledge
2. tell the user what you will check
3. call the tool
4. summarize the result in plain language
5. give one next step

### Money-anxiety rule

For `payment.failed` and `maturity.payout.delay`, open with reassurance before policy.

Good:
> "I understand why that is worrying. Let me check the exact status for you."

Bad:
> "According to policy, reconciliation can take five working days."

### Rate question rule

Never say “best FD”.

Say:
> "I can help compare rates, but I can't recommend one specific FD."

### Tool failure rule

If a lookup fails:
> "I don't want to guess here. I couldn't fetch the latest detail right now. I can create a ticket or give you the support contact."

### Demo language rule

For the demo:
- stay in Hinglish even if the customer speaks English
- use Indian support phrasing
- do not ask "which language do you prefer"
- do not drift into a Western support tone

---

## 11. Canonical SLA table

The agent must quote timelines only from this table.

| Situation | Canonical user-safe wording |
|---|---|
| FD booking processing | "usually within 24 to 48 working hours" |
| Payment reconciliation | "booking may complete, otherwise refund usually reflects within 5 working days" |
| Maturity payout | "usually within 1 to 3 working days" |
| Grievance response | "within 48 hours" |
| KYC pending review | "usually within 24 working hours" |

If the backend returns a more precise ETA, the agent may use it.  
If not, it must stick to this table.

---

## 12. Core flows

### 12.1 Payment debited but FD not booked — `payment.failed`

Required data:
- payment reference
- source bank
- amount
- status
- ETA

Required phrasing:
- "your money is safe"
- "worst case is a refund, not a loss"

Escalate automatically when:
- status remains unresolved beyond policy threshold
- user requests escalation
- lookup result is inconsistent

### 12.2 FD booking status — `fd.book.status`

Required data:
- booking date
- bank
- amount
- tenure
- status
- expected confirmation window

Escalate automatically when:
- `failed`
- `processing` beyond 48 working hours

### 12.3 Premature withdrawal — `fd.withdraw.premature`

Required steps:
1. identify the FD
2. read current estimated value and penalty
3. explain payout window
4. send secure link
5. do not execute on voice

### 12.4 KYC status — `kyc.status`

Allowed states:
- `not_started`
- `in_progress`
- `pending_review`
- `rejected`
- `approved`

For `rejected`, the backend must return a specific reason.  
The agent must not invent one.

### 12.5 Maturity payout delay — `maturity.payout.delay`

Before T+3:
- reassure
- share expected date
- do not escalate unless user insists

T+3 to T+5:
- create follow-up ticket

Beyond T+5:
- priority escalation

### 12.6 FD rates compare — `fd.rates.compare`

Allowed:
- current rate table
- compare by tenure
- mention senior-citizen differential

Not allowed:
- recommending the “best” choice
- promising a rate without current tool data

### 12.7 Trust check — `app.real.check`

Answer must stay short and fact-based:
- company identity
- partner bank model
- DICGC explainer
- support contact
- no hype

Demo console scenario label:
- `trust_check`

### 12.8 Grievance escalate — `grievance.escalate`

Must capture:
- issue summary
- customer identifier if available
- priority
- ticket ID before ending

Escalation ladder:
1. ticket now
2. grievance officer after SLA breach
3. regulator path only with approved wording

---

## 13. Tool contract

The voice agent should use these tool names exactly:

| Tool | Purpose | Required auth |
|---|---|---|
| `verify_read_access` | Verify Tier B read access | Tier B |
| `lookup_customer_profile` | Basic customer profile | Tier B |
| `get_trust_facts` | Approved public trust facts and support identity | Tier A |
| `get_canonical_slas` | Canonical approved SLA wording | Tier A |
| `get_disclosure_copy` | Exact approved disclosure copy | Tier A |
| `get_fd_booking_status` | FD or booking status | Tier B |
| `get_payment_reconciliation_status` | Payment / reconciliation lookup | Tier B |
| `get_kyc_status` | KYC state and ETA | Tier B |
| `get_premature_withdrawal_quote` | Estimate + penalty | Tier B |
| `get_fd_rates` | General rate comparison | Tier A |
| `create_support_ticket` | Complaint or escalation | Tier A/B |
| `send_secure_link` | Tier C follow-up | Tier B/Tier C |
| `get_support_contact` | Contact and grievance details | Tier A |

### Tool design rules

- Tools must return structured states, not raw backend prose
- Missing records should return `not_found`, not unhandled 404s
- Ticket creation must return a ticket ID every time
- Payment references must support alias matching where practical
- FD references must support alias or normalized matching where practical, such as `FD8110` to `FD-8110`
- The demo console should never surface a raw backend 404 to the operator during a standard scenario

---

## 14. Fallback, repair, and escalation behavior

### Didn’t catch that
> "Sorry, the audio was not clear. Could you please repeat that once?"

Max retries:
- 2 retries
- then offer human callback or ticket

### User angry or distressed
- acknowledge first
- do not argue
- do not read policy before the status check
- if user asks for a human twice, stop resisting and escalate

### Silence
- 5 seconds: "Are you still there?"
- 10 seconds: "If this is not a good time, I can end the call and you can call again later."

### Out of scope
> "That specific request is outside what I can complete on voice. I can either create a ticket or guide you to the right team."

### After-hours

Do not pretend warm transfer is available.

Say:
> "Our human support team is available from 10 AM to 7 PM IST, Monday to Saturday. I can create a ticket for follow-up."

---

## 15. Compliance and mandatory wording

### Recording
At call start:
> "This call may be recorded for quality purposes."

### FD disclaimer
> "Stable Money is a distributor. FDs are held directly with the RBI-regulated partner bank and are insured up to 5 lakh rupees per depositor per bank under DICGC. FDs are not regulated by SEBI and are outside the SCORES and Exchange Arbitration framework."

### Mutual fund disclaimer
Only needed if MF support is in scope:
> "Mutual fund investments are subject to market risks. Please read all scheme related documents carefully. Stable Finserv Private Limited is an AMFI-registered mutual fund distributor. Past performance does not guarantee future returns."

### Tax disclaimer
> "I can share general information, but this is not personalized tax advice. Please consult a chartered accountant for your specific situation."

### Data handling rules
- never ask for full Aadhaar
- never ask for CVV or PIN
- never ask for bank password
- never read back a full mobile number
- read only masked or last-4 identifiers

---

## 16. Knowledge and data requirements

### Real-time sources needed
- customer profile
- FD portfolio
- payment and refund status
- KYC state
- partner bank metadata
- ticketing
- support contact and grievance copy

### Static KB
- disclaimer library
- partner bank policy table
- rate card
- grievance matrix
- trust and safety facts

### Data freshness rules
- rates: hourly
- policy tables: daily
- support contact: versioned, manual approval
- grievance wording: legal-approved only

---

## 17. Observability

Must log:
- intent + confidence
- tool call name + success/failure
- transcript per turn
- language per turn
- auth tier reached
- escalation reason
- call outcome
- ticket ID if created

Should also log:
- tool latency
- number of repair turns
- number of “not found” states
- deep-link send success

---

## 18. Demo harness and local ops

Inspired by the `gradient-bang` pattern, this repo should keep:
- explicit environment files
- one-command lookup helpers
- one-command smoke tests
- one-command scenario payload generation

### Current local commands

```bash
cd /Users/vatsalbharti/Downloads/silk-main
uv sync --locked
uv run python scripts/run_stable_money_demo_console.py --port 8090
uv run python scripts/stable_money_harness.py smoke
uv run python scripts/stable_money_harness.py list
uv run python scripts/stable_money_harness.py verify-first
uv run python scripts/stable_money_harness.py customer cust_demo_001
uv run python scripts/stable_money_harness.py trust
uv run python scripts/stable_money_harness.py slas
uv run python scripts/stable_money_harness.py disclosure fd
uv run python scripts/stable_money_harness.py session-body payment_failed
uv run python agents/stable_money_agent.py -t webrtc --port 7861
```

### Local demo URL

`http://localhost:7861/client`

### Recommended operator flow

1. open `http://127.0.0.1:8090/`
2. keep `Demo Preset` mode on
3. keep `Meeting Script` mode on
4. click `Start Client Meeting` if you want the fully guided path
5. otherwise click `Reset Recommended Demo`, then `Clear Previous Run`, then `Start And Open`
6. use the opening line shown in the call sheet and follow the speaker notes
7. run the 3-step sequence in order:
   `payment_failed` -> `trust_check` -> `kyc_status`
8. use `Previous Script Step` and `Next Script Step` to control the flow without touching raw scenario controls

### Demo console expectations

The one-click console should show all of these before the call starts:
- current meeting-script step and progress
- clickable script cards for each prepared client scene
- selected scenario
- exact opening line
- exact verification answers
- speaker notes
- outcome strip
- trust facts
- canonical SLA wording
- latest log state
- latest transcript artifacts

### Required harness behavior

- `smoke` must validate the mock backend and core scenario path
- `verify-first` must show the single recommended scenario to demo first
- `customer` must show the safe fixture summary for a verifiable customer
- `session-body` must print the launch payload for a given scenario

---

## 19. Demo script for client meeting

### Demo 1 — payment failed
- user says money was debited but FD not booked
- agent reassures
- agent verifies read access
- agent checks payment status
- agent explains pending reconciliation
- agent offers or creates ticket

### Demo 2 — trust check
- user asks if Stable Money is real
- agent answers crisply with approved trust facts

### Demo 3 — KYC status
- user asks what stage the KYC is in
- agent verifies read access
- agent explains the pending check and ETA
- agent offers ticketing if delay continues

### Demo 4 — premature withdrawal
- user asks to break FD
- agent explains estimate and penalty
- agent refuses to execute on voice
- agent sends secure link

Order matters:
1. `payment.failed`
2. `trust_check`
3. `kyc_status`

---

## 20. Success metrics

| Metric | Target |
|---|---|
| Tier-1 self-serve rate | >= 60% |
| Intent routing accuracy | >= 90% |
| Self-served handle time | <= 150 sec |
| Escalation landing rate | >= 95% |
| Disclaimer compliance | 100% |
| Hallucinated balances or rates | 0 |
| Tool-call success rate | >= 99% in demo harness |
| Auth success rate for verifiable demo users | >= 95% |

---

## 21. Open blockers

| Topic | Current state | Blocks |
|---|---|---|
| Real Stable Money customer data integration | not connected | pilot |
| Signed app session for auth | not connected | production-quality app voice |
| IVR caller-ID auth model | undecided | IVR launch |
| Deep-link SMS from live session | mocked | pilot |
| Legal-approved consent wording | pending | production |
| Partner bank live metadata feed | mocked | production rates/policy |

---

## 22. Implementation notes for this repo

Current implementation already matches this narrower Phase 1 shape:
- voice runtime in `agents/stable_money_agent.py`
- tool surface in `agents/stable_money/tools.py`
- policy prompt in `agents/stable_money/prompts.py`
- mock backend in `agents/stable_money/mock_backend.py`
- harness in `scripts/stable_money_harness.py`
- one-click control console in `agents/stable_money/demo_console.py`

Next engineering step:
- replace the mock backend one intent at a time
- start with `payment.failed`
- keep the same tool names and response shape
- do not broaden scope before the first real scenario is stable

---

## 23. Source references

- stablemoney.in/contact-us
- stablemoney.in/about-us
- stablemoney.in/investments/faqs
- pipecat-ai/gradient-bang README for local-stack and harness patterns

---

*End of document.*
