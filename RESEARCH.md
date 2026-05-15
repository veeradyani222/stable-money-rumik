Near-Real-Time Voice Agent Pipeline (STT→LLM→TTS)
Executive Summary
This report analyzes how to build a near-real-time voice pipeline using OpenAI’s speech-to-text (STT) and language models, together with Rime (Rumik) text-to-speech (TTS). Key goals are sub-second turn latency (ideally ~200–500 ms) and smooth streaming of audio/text. OpenAI STT (the gpt-realtime-whisper endpoint) supports streaming audio with tunable latency vs. accuracy
. You send small PCM audio chunks (e.g. 20–100 ms) and receive incremental transcript “delta” events, followed by final transcripts. Lower delay settings (e.g. ~0.4 s) yield faster partial text, while higher delays improve accuracy
. OpenAI LLM models (e.g. GPT-3.5/4 via the Responses API) can stream token-by-token output (stream=true)
. Latency depends on model choice: smaller models (GPT-3.5 Turbo) run faster (tens of ms/token) than GPT-4 (hundreds of ms/token)
. Strategies like shorter prompts, fewer example tokens, or even fine-tuning can cut LLM latency
. Rime (Rumik) TTS (Mist series) provides a streaming API: you send text and receive audio chunks (SSE events or HTTP streaming). Rime reports time-to-first-byte (TTFB) ~150–200 ms (enterprise ~<100 ms)
, meaning synthesized speech starts almost immediately. Crucially, the pipeline must stream and overlap every stage: as soon as STT emits text, it feeds the LLM; as LLM emits text, it feeds the TTS; as TTS emits audio, it plays out. This pipelined, multi-threaded approach (often with punctuation-chunking of text
) can achieve sub-second turn times comparable to human conversation (gaps ~200 ms)
.

Key optimization areas include: tuning STT delay vs. chunk size; selecting an LLM model and optimizing prompts to minimize tokens; streaming output to the TTS as soon as possible; using high-performance TTS (Rime Mist) with minimal preprocessing; choosing low-latency transport (WebRTC for audio, WebSocket/SSE for data) with jitter buffers; and client buffering (small play-ahead) and VAD/echo cancellation. Server-side techniques include keeping connections warm (avoid TCP handshakes
), self-hosting TTS for lower p99 latency
, GPU inference, and instrumenting detailed metrics (ASR word error, LLM TTFB, TTS TTFB, p95/p99 latency). We summarize each component’s targets and trade-offs below, provide an architecture diagram, and lay out a step-by-step implementation roadmap with milestones.

OpenAI STT (Streaming)
OpenAI’s realtime transcription API (using model=gpt-realtime-whisper) operates over a live session
. You stream audio chunks (e.g. 10–50 ms of 24 kHz PCM) via WebRTC or WebSocket to /v1/realtime (Voice-agent session) or a transcription session
. The API emits two event types: incremental delta transcripts and final transcripts (per committed turn)
. For example, a delta event might contain “Hello,” and later a completed event returns the full phrase. You must track item_id to align transcripts
. Optionally, OpenAI can run Voice Activity Detection (VAD) on the audio to auto-commit when the speaker pauses
.

Latency tuning: OpenAI recommends testing delay targets on real audio
. For ultra-fast response (e.g. live captioning), target ~0.4 s delay to get very early partial words
. Balanced live voice agents might use 0.8–1.2 s delays, while accuracy-focused transcription can tolerate 1.5–3.0 s
. In practice, lower delay means STT emits text sooner but with more corrections later; higher delay improves WER. Use short keywords (domain terms) or system prompts as hints to improve correctness, but test these under your conditions
.

Chunking: Split audio into small, consistent frames (e.g. 20–50 ms) and send sequentially
. If not relying on auto-VAD, you should “commit” after each user turn. Keep audio format at 24 kHz mono PCM to match OpenAI’s expectation
. Each chunk send induces minimal latency (network round-trip <50 ms typical on good links). Tune chunk size: smaller chunks yield finer-grained streaming but add per-packet overhead; 20–30 ms is common for real-time audio.

Partial transcripts: As deltas arrive, immediately feed them into the next stage (LLM). Real-time pipelines benefit from partial text: e.g. if a user says “How can I reset my…”, as soon as “How can I reset my” arrives, begin LLM processing. Decide UI behavior: do you append partial text to a display, or just pass silently? Many systems simply stream transcripts in behind the scenes to speed the agent response.

Expected latency: Testing suggests OpenAI realtime transcripts often deliver final captions on the order of a few hundred ms after speech (depending on delay setting)
. Measured partials can appear ~150–250 ms after speech onset
. Choose a delay target (e.g. 0.4 s) and measure actual latency (audio-in to first transcript token).

Optimization summary: Use gpt-realtime-whisper via a persistent connection; send small PCM audio frames continuously; enable or tune server VAD; commit turns promptly; and aim for 200–500 ms transcription latency. Track metrics like STT latency, errors, truncated or missing text to refine settings
.

OpenAI LLM (ChatGPT) Streaming
After STT yields text, the system calls an LLM (e.g. ChatGPT). Use the Streaming Completions API (stream=true in the Responses endpoint
) to get tokens incrementally. This overlaps generation with network transport and TTS. For example:

python
Copy
response = client.responses.create(
    model="gpt-3.5-turbo",
    input=[{"role":"user","content": user_text_chunk}],
    stream=True
)
for event in response:
    # each event has an output delta (text fragment)
    process_output(event.choices[0].delta.content)
Model selection and parameters: Smaller models run faster. GPT-3.5 Turbo (16k context) typically generates tokens tens of milliseconds each
, whereas GPT-4 (32k) may take >100 ms/token. GPT-4 Turbo (128k context) sits in between. Lower temperature yields slightly more deterministic but not necessarily faster output. The main levers are model and output length. To meet latency, choose the fastest model that meets your quality needs. For simple dialogue, GPT-3.5-Turbo-16k or GPT-4-Turbo are often good trade-offs. Larger context windows (e.g. 128k) have more overhead if fully used, but in practice only a few tokens matter per turn. Use max_tokens to cap response length and avoid runaway generations.

Prompt engineering: Trim system prompts and examples. Long system messages (hundreds of tokens) add to input tokens and slightly slow TTFB
. Shortening a prompt from 2000 to 500 tokens, for instance, may shave ~100–200 ms off the LLM’s first-token latency
. Use concise instructions or even fine-tune the model so that system prompts can be minimal. Fewer few-shot examples also reduce both input and output tokens.

Tokenization: The model’s tokenizer processes input quickly; its overhead is small compared to generation. However, complex Unicode or lots of short words may modestly increase token count. For best speed, avoid unnecessary verbosity or dense data in prompts.

Streaming strategy: As with STT, stream partial outputs immediately. For example, send each text chunk from STT as it arrives to the LLM (you can accumulate or rewrite the conversation state). Process each completion token as it comes, passing it onward to TTS. This way, the user hears the response word-by-word rather than waiting for the whole reply. OpenAI’s latency guide notes that “streaming is the single most effective approach” to reduce perceived wait time
. Combine with “chunking”: if the final text must be post-processed (e.g. filtered or translated), do so on each chunk rather than waiting for the whole response
.

Parallelism: In multi-step tasks, you can parallelize independent LLM calls. For example, compute a tool call in parallel while the main response generates
. Or speculate on the answer path. However, keep in mind real-time constraints: avoid too many serial LLM calls. Aim for a single streaming prompt per turn if possible.

Expected latency: Time-to-first-token (TTFT) for LLMs can be in the range ~100–500 ms depending on model. Once tokens start, throughput is model-dependent (GPT-3.5 might do ~20 tokens/sec on a big GPU, GPT-4 ~5 tokens/sec
). Thus a 10-word reply may take 0.5–1.5 seconds to complete. To meet overall turn goals (<800 ms for many systems
), you must overlap with STT (user is still talking while LLM processes) and TTS (playback begins before the reply finishes).

Optimization summary: Use the fastest adequate model (GPT-3.5-Turbo or GPT-4-Turbo), set stream=true, and craft a concise prompt. Let generation run in one thread and emit tokens to TTS in another thread. Measure LLM TTFB and tokens/sec to pinpoint bottlenecks. Key tactics: shorter prompts, parallel tool calls or retrieval, and having a fallback for hard-coded responses if an LLM is overkill
.

Rime (Rumik) TTS Streaming
For speech output, we use Rime’s (Rumik’s) Mist TTS API, which is designed for low-latency streaming. The streaming endpoint (POST /v1/rime-tts) returns a continuous audio stream (e.g. PCM or μ-law) or server-sent events of audio chunks
. You send a JSON payload with "text", "speaker", "modelId":"mistv2" (or v3), and headers like Accept: audio/pcm or audio/mulaw
. The response yields audio data progressively: in HTTP streaming mode you get raw bytes, or in SSE mode events of base64 chunks (the example shows an “event: chunk” with data bytes)
.

Latency: Rime reports best-in-class low latency. Typical time-to-first-byte (TTFB) is around 150–200 ms for the cloud API, and under 150 ms in self-hosted deployments
. Enterprise users may see <100 ms
. In practice, once text is sent, audio begins almost immediately. Rime benchmarks show ~175 ms TTFB on average
, far faster than many competitors (~500 ms). The pipeline goal should be to get audio into the speaker ideally well under 200–300 ms after sending text.

Chunking and continuity: Because we stream audio, we can play it as soon as it arrives, with minimal internal buffering. Ensure the client decodes continuous audio streams without gaps. Use one continuous Rime session per “turn” (response) so that voice characteristics stay consistent. For long responses, maintain the SSE/WebSocket connection open. The Rime docs note a saveOovs and noTextNormalization flag: disabling text normalization (noTextNormalization:true) can shave latency by skipping preprocessing
 (at the cost of pronouncing raw digits). If your text is already normalized, enable this to speed up the start of synthesis.

Voice continuity: When streaming from partial LLM output, you need to ensure audio doesn’t sound choppy or have inconsistent timbre. To do this, feed complete sentences or clauses to TTS, or at least insert natural pauses. Rime supports custom punctuation-controlled pauses (e.g. <200> for 200 ms) in the text
. When LLM generates partial phrases, consider buffering up to a punctuation mark before sending to TTS for more fluid speech. Many implementations segment on sentence or phrase boundaries (as in
) to keep TTS chunks natural.

Format: Use a high-enough sampling rate. Rime defaults to 22050 or 24000 Hz; for telephony you might downsample to 16 kHz μ-law. On the client, if mixing with other media (e.g. phone call), perform any transcoding in your media stack. The Rime SSE interface can output audio/pcm (16-bit little endian) or μ-law streams
.

Expected performance: With pipelining, Rime’s TTS stage adds ~150 ms to start and then streams audio at real time. For example, in one test pipeline
, TTS added ~0.28 s on average. Once audio starts, playback rate is fixed (e.g. 22050 Hz output). You should target overall TTS latency (TTFB) of <200 ms to stay under perceptible thresholds
.

Optimization summary: Use Rime’s streaming TTS (Mist v3) with a stable speaker voice. Disable unnecessary text processing (noTextNormalization) to cut ~10–50 ms
. Stream text in sentences or clauses, and feed them continuously as LLM output arrives. Measure TTS TTFB and ensure buffer underflow does not occur. For fastest results, a self-hosted TTS instance (Docker) can be used to shave tens of ms
.

End-to-End Pipeline Architecture
The full pipeline stitches these stages into one voice agent (STT→LLM→TTS) that operates continuously. A streaming architecture is essential: do not wait for one stage to finish before starting the next. As soon as the speaker starts talking, STT begins emitting text deltas; feed those to the LLM immediately. As the LLM streams tokens, feed them to the TTS engine in real time (possibly via a buffer/queue). Meanwhile, the TTS outputs audio chunks which are sent to the user’s speaker. This overlapping (“pipelining”) dramatically cuts turn time
.

A typical flow (illustrated below) is:

Client (microphone) captures audio and sends it over a low-latency channel (WebRTC/UDP) to the server.
STT service (OpenAI Real-time) receives audio frames and emits transcript segments.
LLM service (OpenAI Chat) receives text and begins generating a response stream.
TTS service (Rime Mist) receives text fragments and streams back audio.
Client (speaker) receives audio packets, buffers minimally, and plays sound.
Because each stage adds latency, we aim to minimize serialization. For example, while the user is still speaking, partial transcripts can start feeding the LLM (“floor overlap”). When the user stops (voice activity ends), the final STT output seamlessly continues the prompt to the LLM. The LLM does not wait for a full sentence; as soon as, say, a clause is ready, it goes to TTS. Likewise, TTS begins speaking before the LLM is completely done, pausing only if the LLM stalls for punctuation.

Mermaid diagram of this architecture:

mermaid
Copy
flowchart LR
  subgraph Client
    MIC[User Microphone]
    SPKR[User Speaker]
  end
  subgraph Network
    VAD[Client VAD]
    NetRTC[WebRTC/UDP Pipeline]
    NetWS[WebSocket/SSE]
  end
  subgraph Server
    STT[OpenAI Realtime STT]
    LLM[OpenAI LLM (Chat)]
    TTS[Rime/Rumik TTS]
    JBUF[Jitter Buffer / Audio Queue]
  end

  MIC -- audio--> VAD
  VAD -- audio--> NetRTC
  NetRTC -- audio--> STT
  STT -- text--> LLM
  LLM -- text--> TTS
  TTS -- audio--> NetWS
  NetWS -- audio--> JBUF
  JBUF --> SPKR
This diagram shows audio flowing from the user to STT (via WebRTC or RTP), text flowing internally to the LLM, then to TTS, and synthesized audio streaming back to the user (possibly via the same WebRTC or a separate media channel). Key points: streaming pipelines, parallelism (STT/LLM/TTS threads), and minimal buffering.

Streaming vs. Batching: Unlike batch processing, we avoid collecting an entire utterance or entire text block. Instead, operate incrementally. Batch processing (sending a 5 s audio file to STT, then waiting for full text) would incur multi-second delays and is not acceptable for real-time calls. Similarly, do not wait for the LLM to finish before TTS: stream tokens to TTS in real time
.

Incremental synthesis: We recommend segmenting LLM output by sentence or semicolon. For instance, one approach
 uses a “buffer streamer” that detects punctuation and pushes complete sentences to the TTS thread. The TTS thread runs concurrently, so while the LLM is writing “...world?” the TTS is already speaking “Hello, how are you”. Synchronize them with a small queue (e.g. 50 ms timeout
) to smooth flow.

Pipelining and Parallelism: Where possible, parallelize independent tasks. For example, you might simultaneously fetch customer data (database/API) while the LLM generates text, then merge results. Use speculative execution for tool calls (start likely queries and cancel if not needed)
. The pipeline’s modularity also lets you audit each stage: logs of transcripts, LLM output, and TTS input help debug misrecognitions or hallucinations.

Trade-offs: A fully streaming pipeline is more complex than a simple request-response. It requires managing state across asynchronous streams. However, it allows near-instantaneous interaction. By comparison, single “speech-to-speech” models yield a turnkey solution but lose transparency and fine control
. The pipeline approach wins on observability and optimization.

Network and Transport
Audio transport: For the lowest latency, use WebRTC/UDP for microphone audio. WebRTC provides sub-100 ms mouth-to-ear latency in good conditions
, adaptive jitter buffers, and echo cancellation. It also handles NAT traversal, which is important for mobile/desktop apps. If the client is a browser/mobile app, the simplest path is to use WebRTC for live audio capture and playback
.

For server-to-server or non-browser clients, WebSockets or HTTP/2+SSE are alternatives. WebSocket allows you to send raw audio via a TCP stream. Latency can be very low (<50 ms) if connections are persistent, but without jitter control. Jitter buffers can be implemented in the server if needed. SSE (server-sent events) is similar to WebSocket for text/audio chunks but only one-way. Rime’s SSE TTS uses HTTP/2 streaming of audio events
. Over TCP, a handshake adds overhead (50–150 ms) unless you reuse keep-alive connections
. Ensure you set TCP_NODELAY on sockets to avoid Nagle’s delay.

Jitter and buffering: Because packet delivery is variable, use a small jitter buffer on the client for incoming audio (e.g. 100–200 ms). This smooths out network jitter at the cost of a fixed delay. Similarly, for outgoing STT audio, fill only small frames (20–30 ms) into the network to keep latency low. Use redundant encoding (like Opus with FEC or 2x20 ms frames) if packet loss is a concern.

Packetization: For telephony integration (SIP trunks), you may send μ-law (G.711) 8kHz audio. Rime supports μ-law output
. For VoIP or WebRTC, use OPUS or PCM16 at 16 kHz–24 kHz. In all cases, keep payloads small (20–30 ms audio each) to reduce jitter.

Transport protocols: Table below compares options (with rough latency impact):

Option	Category	Pros	Cons	Latency (ms)
WebRTC	Audio transport	P2P low-latency (~60–120 ms locally
), NAT traversal, built-in echo cancel/VAD	Complex setup (ICE/STUN), harder server integration	~60–150 (end-to-end)**
WebSocket	Bidirectional transport	Simple, works server-server, reuse HTTP/2	Over TCP (no inherent audio codec), needs jitter handling	~50–100 + jitter
HTTP/2+SSE	One-way streaming	Easy incremental data (LLM/TTS) over persistent conn.	Unidirectional per conn, TCP overhead if not kept alive	~100–150 (first packet)
TCP keep-alive	Connection	Avoid 50–150 ms handshake
 when reusing conn	Must manage timeouts, infrequent probes needed	saves ~100 ms if warm
Jitter buffer	Buffering	Smooth playback under jitter	Adds fixed delay (trade-off)	50–200 (configurable)
G.711 μ-law	Codec	Low complexity for telephony	Lower audio quality, 8 kHz only	negligible overhead

(**) “End-to-end” includes encoding, transport, jitter buffer; local WebRTC can be ~60–120 ms [33].

In short, use WebRTC for live mic-to-server audio when possible, and WebSocket/SSE for textual data (transcripts, tokens, TTS audio bytes). For telephony, use SIP trunks (Twilio/Telnyx) which often convert PCM automatically
.

Client-Side UX and Playback
On the client side (mobile app, browser, softphone, etc.), the user experience must feel instant. Key points:

VAD (Voice Activity Detection): Use client-side VAD to know when the user stops speaking. This lets you commit the STT buffer and begin the agent’s reply. Some systems send silence to OpenAI and let server VAD decide, but client VAD (e.g. WebRTC VAD) can give you control. A good VAD threshold ensures you don’t cut off the user prematurely or wait too long after they finish. Mark the end-of-turn so the LLM is triggered right away.

Playback Buffering: Once audio arrives from TTS, buffer a small amount (e.g. 50–100 ms) before playing to absorb jitter. But keep buffer low to avoid lip-sync issues. If using WebRTC, the browser’s WebAudio or RTP jitter buffer handles this; otherwise, implement a ring buffer with target delay ~100 ms.

Echo Cancellation: If the user both speaks and hears on the same device (e.g. hands-free), echo cancellation is essential. WebRTC has built-in AEC; if using raw WebSockets, you’ll need platform-specific AEC (e.g. WebAudio’s echo cancellation) to prevent feedback.

Partial transcripts UI: If you display what the user is saying (like live captions), plan how to revise it when corrections come (e.g. overwriting partial text). The API will send updated text if deltas correct previous words
. A simple UI just replaces the sentence as new deltas arrive.

Streaming indicators: Show loading spinners or partial response text as the agent generates speech. Users perceive the system as faster if they see text appearing or hear words immediately
.

Error handling: If STT misses input (very noisy line) or LLM times out, have a fallback prompt (like “I’m sorry, could you repeat that?”). Keep these designs in the front-end.

Server-Side Components
On the server/cloud side, you have services for STT, LLM, and TTS, plus any surrounding logic. Optimization strategies include:

Connection pooling: Keep persistent connections to OpenAI (and Rime) to avoid new handshakes. OpenAI recommends reusing the same API client or WebSocket for multiple messages
. This saves ~50–150 ms per call
.

Model warm-up: To avoid cold-start latency, run a dummy request on each model after deployment (or periodically). For TTS, the team in [38] did a “dummy warm-up” so the voice model was loaded
. For LLMs on cloud, not usually needed (OpenAI infrastructure is warm).

Compute resources: Use GPUs for LLM inference and TTS if possible. Audio processing (encoding/decoding) can run on CPUs. Ensure your instances have enough GPU VRAM for the chosen models. For OpenAI API, this is managed by OpenAI; for self-hosted TTS (Rime Docker), assign a GPU.

Scaling & concurrency: Plan for concurrent calls. Rime notes each 200 additional concurrent calls may require another replica
. OpenAI pricing is per-token, but also has rate limits (check OpenAI docs). Use autoscaling for LLM/TTS services based on concurrency.

Logging and caching: Log transcripts and responses (if privacy allows) to debug issues. Caching at each stage is rarely useful because queries are rarely repeated verbatim. However, you might cache expensive tool call results or knowledge base retrievals used in LLM prompts.

Service placement: To reduce network time, co-locate services. For example, if using private VoIP trunks and VMs, keep STT/LLM/TTS in the same region as the call gateway. If self-hosting TTS and doing local STT (or using local Whisper), that cuts API round-trips. Rime advocates self-hosting to remove external API jitter
.

Transcoding: If the telephony system provides μ-law 8 kHz audio, convert to PCM16 or Opus 24 kHz for best STT quality. Perform any transcoding in a low-latency path (e.g. RTP endpoint). Don’t use high-latency codecs like Opus at 10 ms frames without jitter protection.

Monitoring: Use APM tools to measure each leg’s latency. Capture STT latency (speech-in to text-out), LLM time (text-in to first-token and full generation), and TTS latency (text-in to audio-out). Also track p95/p99 values. Instrument system-wide turn time (from user-speech end to agent-audio start) and MOS (Mean Opinion Score) from periodic user tests. The pipeline in [38] reported ASR speed (words/s), LLM tokens/s, TTFT (time to first token), and TTFA (time to first audio)
, which is a good model for detailed metrics.

Optimization Techniques and Trade-Offs
Below are key optimization techniques, their trade-offs, and expected targets:

Streaming Everywhere: Ensure every component streams. Don’t wait for full utterances. Use SSE/WebSocket streaming modes on APIs
. Trade-off: More complex code, but turns feel instant.

Prompt & Input Engineering: Shorter, simpler prompts speed up LLM. Fewer examples mean less processing. Trade-off: May reduce LLM accuracy, so test fidelity. Example: trimming 1500 tokens from prompts saved ~100–200 ms
.

Model Selection: Use the smallest model that does the job. GPT-3.5-Turbo is much faster per token than GPT-4, but slightly less nuanced. OpenAI’s Turbo variants are optimized for throughput. Trade-off: Lower quality/creativity with smaller model, but large models (GPT-4, GPT-5) can be so slow (seconds) as to break real-time requirements. For reference, community tests show GPT-5 (2× GPT-4 size) can take tens of seconds
, which is unusable.

Temperature/Determinism: Lower temperature doesn’t significantly change speed (it just affects token distribution). Use 0–0.3 for likely consistent responses and maybe slightly shorter outputs.

Temperature of TTS: Rime’s streaming TTS has limited parameters (speedAlpha, etc). You can slightly slow down speech (speedAlpha < 1.0) for clarity, but faster speech (speedAlpha > 1.0) means less real-time budget. Typically keep speed around 1.0. Use inlineSpeedAlpha for emphasis control, but complex SSML or markup could slow processing.

Context Window: Only send recent conversation relevant context to LLM to reduce token count
. Prune long histories, or use RAG with retrieval (but retrieval adds delay). Trade-off: Less context may reduce response quality vs. the cost of processing large prompts.

Audio chunk size: Smaller chunks (10–20 ms) reduce modeling delay but increase packet overhead. 20–30 ms is a common balance for voice.

Turn-Detection: Properly detect end-of-user-turn. You can use server VAD (OpenAI’s) or client VAD. Trade-off: If you cut early, the agent may respond to incomplete input; if too late, extra latency. Tweak VAD threshold and silence padding (OpenAI lets you set prefix_padding_ms)
.

Parallel Tool Calls: If the agent needs external data (databases, APIs), do them speculatively or in parallel with generation. For instance, start fetching user info as soon as you see a phone number. Rime notes that tool calls often add 0.5–2 s
, so pre-fetch can hide that time. Trade-off: More complexity in code, risk of wasted calls.

Self-Hosting vs. API: For TTS (and possibly LLM), self-hosting can save 50–100 ms of network overhead
. But it adds ops overhead. Best choice depends on scale: if you have thousands of calls, self-host TTS (Rime Docker) is cost-effective
 and faster.

Connection Reuse: Always keep HTTP/TCP and WebSocket connections alive to avoid handshakes. Trade-off: Minor - must handle keep-alives.

Batch vs. Streaming: Don’t batch for latency; batch only if throughput is more important than delay (e.g. offline tasks). Real-time pipelines should never batch user requests together.

Cache / Prefix Prompts: If many calls share context (e.g. same prompt preamble), use caching or prefix compression. OpenAI uses KV cache internally; grouping dynamic parts at end makes cache hits
.

Audio Quality vs. Latency: Increasing sample rate or voice quality (more mel-spectrogram steps) slows TTS. Use 22050 Hz wideband (Rime default) for balance. Note that 16 kHz wideband can sound better than 8 k (narrowband)
, but may expose artifacts if TTS model isn’t good.

Playback Buffer vs. Responsiveness: Larger playback buffer smooths audio but adds startup delay. Aim for ~100 ms buffer: almost unnoticeable in conversation
.

Security/Privacy: While not latency, include notes: streaming data (audio, text) may contain PII. Use secure connections and consider on-prem processing for privacy (especially STT and LLM).

Recommended Architecture (Mermaid)
mermaid
Copy
flowchart LR
  subgraph Client
    MIC[User Microphone] --> VAD[Client VAD & Encoder]
    SPKR[User Speaker] <-- Playback[Jitter Buffer & Decoder]
  end
  subgraph Network
    RTC[WebRTC/UDP] 
    WS[WebSocket/SSE]
  end
  subgraph Server
    STT["OpenAI Realtime STT"]
    LLM["OpenAI LLM (Chat)"]
    TTS["Rime TTS (Mist)"]
  end

  MIC --audio--> VAD --> RTC
  RTC --audio--> STT
  STT --text--> LLM
  LLM --text--> TTS
  TTS --audio--> WS
  WS --audio--> Playback
This diagram highlights the flow: audio from the user goes through a local VAD/encoder then via WebRTC to STT. Partial text flows to the LLM, whose tokens flow to TTS, which streams back audio (e.g. over WebSocket or even WebRTC). The client decodes audio in a small jitter buffer and plays it. Each arrow is a streaming, low-latency channel.

Implementation Roadmap (Prioritized Milestones)
Prototype MVP:

Set up a minimal end-to-end pipeline: capture audio, send to OpenAI realtime STT, feed resulting text to a non-streaming LLM, then a non-streaming TTS, and play the full response.
Verify correctness of each component (STT text accuracy, LLM answer sensibility, TTS audio quality).
Milestone: Functional voice assistant with ~multi-second lag.
Enable Streaming:

Update STT usage to streaming deltas (gpt-realtime-whisper), immediately sending each partial transcript to LLM.
Use LLM stream=true and pipe tokens as they arrive into TTS.
Make TTS streaming (SSE mode) to play audio as chunks arrive.
Milestone: Reduced latency; user hears response audio segment-by-segment, not all at once.
Latency Tuning:

STT: Tune delay target in OpenAI session (e.g. 0.4–1.0 s) using representative audio. Measure actual transcript latency.
LLM: Experiment with smaller models (GPT-3.5 vs 4, vs Turbo). Trim system prompts and examples. Adjust max_tokens.
TTS: Test noTextNormalization flag, confirm speaker transitions. Consider self-hosted Rime container for lower p99.
Buffers: Implement minimal audio buffers (client jitter buffer, server queues) and optimize sizes.
Milestone: End-to-end turn time <800 ms (for simple queries), with streaming partials working correctly
.
Network & Protocol:

Implement WebRTC-based audio transport if target is browser/mobile. Otherwise, use reliable media pipeline to ingest audio (e.g. Twilio SIP to app).
Use persistent WebSocket or HTTP/2 connections for text and audio chunks.
Optimize codec settings (Opus 24 kHz with ~20 ms frames recommended).
Ensure TLS/WebSocket keepalive to prevent idle disconnects (50–150 ms cost
).
Milestone: Stable streaming with <150 ms network latency, no packet drops.
Parallelism & Tools Integration:

If needed, integrate tool calls: e.g. call CRM or knowledge base. Do this asynchronously (e.g. non-blocking API call).
Pre-fetch data when possible (e.g. while STT is happening).
Verify turn detection: fine-tune VAD sensitivity on realistic audio.
Milestone: Pipeline robust to integration of external queries without >1 s stalls
.
Server & Ops:

Decide on self-host vs cloud: probably self-host Rime for TTS if large scale (to cut 50–100 ms
). LLM likely stays on OpenAI.
Containerize STT/LLM/TTS microservices. Enable autoscaling based on CPU/GPU load.
Implement detailed logging/metrics: track STT errors, LLM latency, TTS latency. Set up dashboards for p95/p99 latencies.
Milestone: Production-grade deployment with monitoring and alerting.
Quality & UX polishing:

Adjust voice style, speed, and prosody (via Rime settings) to achieve natural feel. Test at narrowband vs wideband.
Calibrate echo cancellation and double-talk handling on client.
Perform human tests for perceived latency (goal: user gap <500 ms feels seamless
).
Milestone: Meet KPIs (e.g. median turn <500 ms, p95 <800 ms) and acceptable voice quality (MOS >4).
Iteration & Scale:

Iterate on voice model selection (Rime periodically releases new voices) and LLM (watch for GPT-4 Turbo releases).
Scale infrastructure with load testing (simulate concurrency). Tune self-host replicas and adjust concurrency/queues.
Milestone: System handles target concurrency (open-ended), with stable latency under load.
Each stage builds on the previous, ensuring a working baseline before heavy optimization. Measure and validate at each milestone before proceeding.

Options Comparison Table
Option	Category	Pros	Cons	Latency Notes
WebRTC	Transport	Very low mouth-to-ear latency (60–120 ms on good nets)
; built-in jitter buffer, echo/VAD	Complex (ICE/STUN needed), peer connectivity issues	~60–150 ms end-to-end (audio)
WebSocket (TCP)	Transport	Simple integration; supports bi-directional data (STT & TTS)	No built-in jitter; TCP handshake if not keep-alive	~50–100 ms one-way + buffering
HTTP/2 + SSE	Transport	Easy streaming of text/audio over single conn; multi-language support	Unidirectional per connection; slight overhead vs raw UDP	~100–200 ms initial, streaming continuous
gpt-3.5-turbo	LLM Model	Fastest of OpenAI chat models; low cost; 16k context	Lower comprehension than GPT-4; may need prompt tuning	~50–100 ms per token on GPU (estimate)
gpt-4-turbo	LLM Model	Higher accuracy/naturalness; 128k context	Slower (~2–3× GPT-3.5 speed); higher cost	~150–300 ms per token (estimate)
gpt-4 (base)	LLM Model	Even higher fidelity on nuance; 32k context	Slowest (~3–5× GPT-3.5)	~200–400 ms per token
Offline Whisper v3	STT Engine	Self-hostable ASR (no API call)	Requires GPU; slower than realtime API; no streaming natively	Transcribe minutes of audio, not streaming
Rime Mist (cloud)	TTS Service	150–200 ms TTFB
; high-quality natural voices	Dependent on internet, rate-limited; cost per char	~150–200 ms first audio, then streaming
Rime Mist (self-host)	TTS Service	Sub-150 ms TTFB
; predictable latencies; avoid API cost	Ops overhead; needs GPU; maintenance	~100–150 ms first audio
Small jitter buffer	Buffering	Minimal delay; very responsive playback	Risk of audio glitches if packet loss/jitter occur	+0–50 ms additional
Large jitter buffer	Buffering	Smooth audio, robust to jitter	Adds fixed latency (100–200 ms extra)	+100–200 ms delay buffer

Notes: WebRTC vs WebSocket depends on client type. LLM “latency per token” varies with system load – these are ballparks. Jitter buffer size depends on network stability; start low and increase until smooth. The target is to keep total turn latency (user done speaking → agent audio start) under ~500 ms for a fluid feel
.