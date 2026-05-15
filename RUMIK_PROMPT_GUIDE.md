# Prompting Guide For Silk-Muga

# Prompting guide — Hinglish emotion-TTS

This guide tells you how to write prompts that the model can actually speak well. Two control surfaces are baked into training:

1. **`[tag]`** — **global tone** (the emotion the entire utterance is delivered in)
2. **`<tag>`** — **event** (a discrete sound the model produces inline: laugh, chuckle, sigh)

Get these wrong and the output is monotone, ignores the tag, or laughs in the middle of a sad line. Get them right and you get a believable performance.

---

## 1. Global tone — `[tag]`

### What it does

The square-bracket tag at the **start** of the prompt sets the speaker’s emotional state for the entire utterance. The model conditions every codec frame on this. Think of it as the director’s note: “Deliver this whole line as ___.”

### The 6 supported tones

| Tag | When to use | Voice quality |
| --- | --- | --- |
| `[happy]` | Light, positive, casual chat — friendly check-ins, jokes, banter | bright, smiling, mid-energy |
| `[excited]` | High-energy reactions — wins, surprises, gossip, hype | loud, fast, pitch-up |
| `[sad]` | Loss, disappointment, grief, breakups | slow, breathy, low pitch |
| `[angry]` | Frustration, confrontation, blame | tight, clipped, sharp |
| `[neutral]` | Information delivery — instructions, factual, calm | flat, even, no affect |
| `[whisper]` | Secrets, late-night, scared, intimate | quiet, breathy, no voiced energy |

### Rules

- **Always one tag, always at the start, always before any text.**
- One global tone per utterance. Don’t try `[happy] foo [sad] bar` — the model wasn’t trained on tone-switching mid-line.
- Put exactly one space after the closing bracket: `[happy] Arre yaar`.
- The tag is **mandatory**. Untagged prompts will fall back to whatever the semantic of the text leaks.

### Good vs bad — global tone

**Good** ✓

```
[happy] Arre yaar tu aa gaya, kab se wait kar rahi thi main!
[sad] Pata nahi kya ho gaya yaar, sab kuch bikhar gaya.
[angry] Tumne phir wahi galti ki. Maine kitni baar bola tha.
[whisper] Shh, dheere bol. Maa abhi soyi hai.
[excited] Oh my god jeet gaye sacchi mein, check kar check kar!
[neutral] Train number 12345 platform number 4 par aa rahi hai.
```

**Bad** ✗

```
Arre yaar tu aa gaya kab se wait kar rahi thi          # no tag → flat output
[happy][sad] mixed signal                              # two tags
[Happy] Arre yaar                                    # capitalisation: must be lowercase
[happy]Arre yaar                                       # missing space after ]
happy: Arre yaar                                       # wrong syntax — must be square brackets
[joy] Arre yaar                                        # not a trained tag
[happy] Arre yaar [sad] kya hua                        # mid-line tone switch — undefined
```

---

## 2. Event tags — `<tag>`

### What they are

Inline, discrete acoustic events the model emits at the position you place them. Three are supported:

| Tag | What it produces | Approx. duration |
| --- | --- | --- |
| `<laugh>` | Loud, voiced laughter (“haha”, “hehe”) | 0.5–1.5s |
| `<chuckle>` | Soft, amused laugh, almost a breath | 0.3–0.7s |
| `<sigh>` | Audible exhale, breathy | 0.4–0.8s |

### Rules

- **Wrap in angle brackets, lowercase, no spaces inside:** `<laugh>`, not `<Laugh>` or `< laugh >`.
- **Place exactly where you want the sound.** The model is position-sensitive: `<laugh> kya baat hai` (laugh first, then speech) sounds different from `kya baat hai <laugh>` (speech first, then laugh).
- **Put a space on either side of the tag** when it’s between words.
- You can stack two for emphasis: `<laugh> <laugh>` → longer, harder laugh. Don’t go past two.
- **Don’t put events in places that are physiologically impossible** — e.g. mid-word.

### Crucial: events must match the global tone

This is the part most people get wrong. Laughing in a sad line, sighing in an excited line — the model was almost never trained on those combinations because we think it is not natural to laugh in global sad tone.

**The tone-event compatibility matrix** (based on what’s actually in the 60k training set):

| event ↓  tone → | happy | excited | sad | angry | neutral | whisper |
| --- | --- | --- | --- | --- | --- | --- |
| `<laugh>` | ✓✓ best | ✓✓ best | ✗ avoid | ✗ avoid | ✓ ok | ✗ avoid |
| `<chuckle>` | ✓✓ best | ✓ ok | ✗ avoid | ~ rare | ✗ avoid | ✓ ok |
| `<sigh>` | ✗ avoid | ✗ avoid | ✓✓ best | ✓ ok | ✓ ok | ✓ ok (tired/sad) |

> **Why this matrix matters:** these mappings reflect how humans actually express emotion. Laughter belongs to positive, high-energy states ([happy], [excited]). Sighs belong to low-energy, reflective states ([sad], [whisper]). Mixing them — a laugh in a sad line, a sigh in an excited shout — sounds unnatural to a listener regardless of the model's quality, so we don't generate those combinations in the first place.
> 

### Good vs bad — event tags

**Good — events match the tone** ✓

```
[happy] <laugh> Yaar tumne phir wahi joke maara, kitni baar sunungi main?
[happy] Achcha sun na, kal kya hua tha pata hai? <chuckle> Pura office hil gaya.
[excited] <laugh> Bhai jeet gaye! Mujhe abhi tak vishwas nahi ho raha!
[sad] <sigh> Pata nahi yaar, ab kuch samajh nahi aata kya karun.
[sad] Bahut der ho gayi hai. <sigh> Shayad ab kuch bhi nahi badlega.
[whisper] <sigh> Itna lamba din tha aaj, bilkul thak gayi hoon.
```

**Bad — tone-event mismatch** ✗

```jsx
[sad] <laugh> sab kuch khatam ho gaya yaar              # laughing while sad → model fights itself
[neutral] <laugh> aaj ka mausam saaf rahega             # weather report doesn't laugh
[angry] <chuckle> tumne phir galti ki                   # angry people don't softly chuckle
[happy] <sigh> kya mast din tha aaj                     # happy lines don't sigh
[excited] <sigh> jeet gaye!                             # contradictory energy
[whisper] <laugh> sab so rahe hain                      # loud laugh contradicts whisper
```

**Bad — placement/syntax** ✗

```jsx
[happy] Arre <laugh>yaar kya bol rahe ho               # missing space before yaar
[happy] Arre yaar <Laugh> kya baat hai                 # capitalisation
[happy] Arre yaar < laugh > kya baat hai               # spaces inside brackets
[happy] Arre <laugh><laugh><laugh> yaar                # three+ stacked → unstable
[happy] Arre yaar kya<laugh>baat hai                   # mid-word
[happy] <cough> sun na bhai                            # unsupported event
```

---

## 3. Language register

The training data is **Hinglish** (Romanised Hindi with English code-mixing). The model speaks this best.

### Good register ✓

```
[happy] Yaar kal ka match toh epic tha! Last over mein twist hi twist.
[neutral] Aapka order tomorrow tak deliver ho jayega.
[sad] Maa, mujhe samajh nahi aa raha hoon kya karun.
```

### Avoid

- **Full Devanagari** (the model saw zero Hindi script): `मैं ठीक हूँ` → garbage.
- **Other Indian languages** (Tamil, Bengali, Marathi, Bhojpuri text): not trained.
- **Heavy slang / regional variants** (very Bambaiyya, very Punjabi-dialect): may be flat.

---

## 4. Length

The model is built around utterances in the **2–30 second** range — that's the operating envelope it's optimised for. It extrapolates reliably **up to about 40 seconds.** beyond that, output quality degrades (tone drift, pacing slips, repetitions, occasional cutoff).

- **Recommended** : utterances within ~2–30 seconds (typically one to three sentences).
- **Up to ~40 seconds** : still works well — safe headroom for longer monologues
- **Beyond ~40 seconds**: quality drops. Split the content across multiple prompts instead

---

## 5. Putting it together — production-ready prompts

### Customer service / IVR

```markdown
[neutral] Aapka order place ho gaya hai. Confirmation SMS aapke registered number par bhej diya gaya hai.
[neutral] Main aapki kya madad kar sakti hoon? Apna query batayein.
```

### Casual conversational AI

```markdown
[happy] Arre tu aa gaya! Sab theek? Aaj toh tu late ho gaya yaar.
[happy] <chuckle> Pata hai tumne kya kiya kal? Pure office mein hi viral ho gaya.
[excited] <laugh> Bhai sun, abhi abhi pata chala — wo job mil gayi mujhe!
```

### Empathy / mental-health style

```markdown
[sad] <sigh> Yaar, samajh sakti hoon. Itna kuch hua hai, time lagega.
[whisper] <sigh> Theek ho jayega sab. Bas thoda waqt do khud ko.
```

### Storytelling

```
[neutral] Wo raat bahut shaant thi. Bahar sirf hawa ki aawaz aa rahi thi.
[whisper] Phir achanak, kuch khatka hua. Maine darwaza dekha — koi nahi tha.
[excited] Aur tabhi! Light gayi, aur ek aawaz aayi peeche se!
```

### Confrontation

```
[angry] Tumne phir wahi kiya. Maine kitni baar bola tha aisa mat karo.
[angry] Bas, ab aur nahi. Mujhe akela chhod do.
```

---

## 6. Anti-patterns to reject at API layer

If you’re wrapping this in an API, **reject or auto-fix** prompts that:

1. Have no `[tag]` at the start - it might work . mostly it will work but still a low chance of failure.
2. Have more than one `[tag]`.
3. Use a `[tag]` not in the supported six.
4. Use `<cough>` or `<sneeze>` (unsupported).
5. Combine an event with an incompatible tone (see matrix in §2)
6. Are in Devanagari or a non-Hinglish language.

A simple regex sanity-check:

```
^\[(happy|excited|sad|angry|neutral|whisper)\] [^\[]+$
```

Then strip out any `<(?!laugh|chuckle|sigh)\w+>` events.

---

## 7. Quick reference card

```
[happy]    light positive       → can use <laugh> <chuckle>
[excited]  high energy          → can use <laugh>
[sad]      down, breathy        → can use <sigh>
[angry]    sharp, clipped       → events generally avoided
[neutral]  flat info            → no events
[whisper]  quiet, breathy       → can use <sigh>

events: <laugh> <chuckle> <sigh>     
length: 10–30 words ideal
script: Hinglish (Roman script)
```

---

## 8. Known model behaviours

These are real behaviours of the v3 fine-tune the API ships, not aspirations:

- **Temperature 0.7** is the most reliable inference setting.