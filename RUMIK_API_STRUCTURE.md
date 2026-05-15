# Rumik Voice API — Developer Documentation

> **Base URL**: `https://silk-api.rumik.ai`
> **Authentication**: Bearer token in Authorization header
> **Audio Format**: PCM int16, 24kHz, mono

---

## Quick Start

### 1. Get an API Key

Contact the Rumik team to get your API key (format: `rk_live_xxxxx`).

### 2. Generate Audio (HTTP)

```bash
curl -X POST https://silk-api.rumik.ai/v1/tts \
  -H "Authorization: Bearer rk_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello, how are you?", "model": "muga"}' \
  -o output.wav
```

### 3. Stream Audio (WebSocket)

```bash
# Step 1: Get session
curl -X POST https://silk-api.rumik.ai/v1/tts/ws-connect \
  -H "Authorization: Bearer rk_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello", "model": "muga"}'

# Response: {"ws_url": "wss://silk-api.rumik.ai/ws/tts", "token": "sess_xxx", "expires_in": 300}

# Step 2: Connect WebSocket with token
wscat -c "wss://silk-api.rumik.ai/ws/tts?token=sess_xxx"
# Send: {"text": "Hello world", "speaker_id": 0}
# Receive: binary PCM audio chunks + {"type": "done"} at end
```

---

## Authentication

All requests require an API key in the `Authorization` header:

```
Authorization: Bearer rk_live_YOUR_KEY
```

For WebSocket connections, the token is passed as a query parameter:

```
wss://silk-api.rumik.ai/ws/tts?token=sess_xxx
```

### Rate Limits

Each API key has a configurable concurrent connection limit (default: 5). Exceeding it returns `429 Too Many Requests`.

---

## Endpoints

### POST /v1/tts

Generate audio from text. Returns a WAV file.

**Request:**
```json
{
  "text": "Hello, how are you doing today?",
  "model": "muga",
  "description": "neutral",
  "temperature": 0.6,
  "topk": 40,
  "max_new_tokens": 2048
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `text` | string | Yes | — | Text to synthesize (max 2000 chars) |
| `model` | string | No | `muga` | Model to use (`muga`, `mulberry`) |
| `description` | string | No | `neutral` | Voice description/style |
| `temperature` | float | No | 0.6 | Sampling temperature (0.1–1.0) |
| `topk` | int | No | 40 | Top-k sampling |
| `max_new_tokens` | int | No | 2048 | Max audio tokens to generate |

**Response:**
- `Content-Type: audio/wav`
- `X-Request-Id: <uuid>`
- `X-Credits-Used: <amount>`
- Body: WAV audio file (PCM int16, 24kHz, mono)

**Errors:**
| Status | Code | Description |
|--------|------|-------------|
| 401 | UNAUTHORIZED | Missing or invalid API key |
| 402 | INSUFFICIENT_CREDITS | Not enough credits |
| 429 | RATE_LIMITED | Too many concurrent requests |
| 502 | GENERATION_ERROR | Inference failed |

---

### POST /v1/tts/json

Same as `/v1/tts` but returns JSON with base64-encoded audio.

**Request:** Same as `/v1/tts`

**Response:**
```json
{
  "audio_base64": "UklGRi4AAABXQVZFZm10IBAAAA...",
  "duration": 3.5,
  "request_id": "abc-123",
  "credits_used": 26
}
```

---

### POST /v1/tts/ws-connect

Create a WebSocket session for streaming audio. Returns a URL and one-time token.

**Request:**
```json
{
  "text": "any text",
  "model": "muga"
}
```

**Response:**
```json
{
  "ws_url": "wss://silk-api.rumik.ai/ws/tts",
  "token": "sess_abc123...",
  "request_id": "uuid",
  "expires_in": 300
}
```

The token:
- Is one-time use (consumed on first WebSocket connect)
- Expires in 5 minutes
- Is tied to your API key's concurrent limit

---

### WebSocket /ws/tts

Connect using the URL and token from `/v1/tts/ws-connect`.

**Connection:**
```
wss://silk-api.rumik.ai/ws/tts?token=sess_abc123
```

**Protocol:**

1. **Client sends text** (JSON):
```json
{"text": "Hello world", "speaker_id": 0}
```

2. **Server sends queue status** (JSON):
```json
{"type": "queued", "queue_depth": 1}
```

3. **Server sends audio chunks** (binary):
   - Raw PCM int16, 24kHz, mono
   - Multiple chunks per request (~400ms of audio each)

4. **Server sends completion** (JSON):
```json
{
  "type": "done",
  "audio_duration": 3.5,
  "total_time": 4.2,
  "rtf": 0.83,
  "total_bytes": 168000,
  "request_id": "uuid",
  "credits_used": 0
}
```

5. **Client can send another text** (same connection):
```json
{"text": "Another sentence", "speaker_id": 0}
```

6. **Client closes** (optional):
```json
{"type": "close"}
```

**Connection lifecycle:**
- Connection stays open for multiple texts
- 1 minute idle timeout (auto-closes if no text sent)
- Client can send `{"type": "close"}` to end gracefully

---

### GET /v1/usage

Get credit balance and usage stats.

**Request:**
```
GET /v1/usage
Authorization: Bearer rk_live_YOUR_KEY
```

**Response:**
```json
{
  "credit_balance": 998000,
  "last_30_days": {
    "requests": 150,
    "credits_used": 2000,
    "input_tokens": 5000,
    "output_tokens": 0
  },
  "pending_ws_logs": 0
}
```

---

### GET /health

Health check (no auth required).

**Response:**
```json
{
  "service": "rumik-gateway",
  "redis": "ok",
  "db": "ok",
  "status": "ok"
}
```

---

## Client Examples

### Python — HTTP

```python
import requests

API_KEY = "rk_live_YOUR_KEY"
BASE_URL = "https://silk-api.rumik.ai"

# Generate WAV
response = requests.post(
    f"{BASE_URL}/v1/tts",
    headers={"Authorization": f"Bearer {API_KEY}"},
    json={"text": "Hello world", "model": "muga"},
)

with open("output.wav", "wb") as f:
    f.write(response.content)
```

### Python — WebSocket Streaming

```python
import asyncio
import json
import websockets
import requests

API_KEY = "rk_live_YOUR_KEY"
BASE_URL = "https://silk-api.rumik.ai"

async def stream_tts(text):
    # Step 1: Get session
    session = requests.post(
        f"{BASE_URL}/v1/tts/ws-connect",
        headers={"Authorization": f"Bearer {API_KEY}"},
        json={"text": text, "model": "muga"},
    ).json()

    # Step 2: Connect and stream
    ws_url = f"{session['ws_url']}?token={session['token']}"

    async with websockets.connect(ws_url) as ws:
        await ws.send(json.dumps({"text": text, "speaker_id": 0}))

        audio_data = b""
        async for message in ws:
            if isinstance(message, bytes):
                # PCM audio chunk — play or save
                audio_data += message
            else:
                data = json.loads(message)
                if data.get("type") == "done":
                    print(f"Done: {data['audio_duration']}s audio")
                    break

    return audio_data

# Run
pcm = asyncio.run(stream_tts("Hello, how are you?"))
print(f"Got {len(pcm)} bytes of PCM audio")
```

### Python — Multi-Message Session

```python
import asyncio
import json
import websockets
import requests

API_KEY = "rk_live_YOUR_KEY"
BASE_URL = "https://silk-api.rumik.ai"

async def chat_tts():
    # Get session
    session = requests.post(
        f"{BASE_URL}/v1/tts/ws-connect",
        headers={"Authorization": f"Bearer {API_KEY}"},
        json={"text": "init", "model": "muga"},
    ).json()

    ws_url = f"{session['ws_url']}?token={session['token']}"

    async with websockets.connect(ws_url) as ws:
        texts = [
            "Welcome to our service.",
            "How can I help you today?",
            "Thank you for calling.",
        ]

        for text in texts:
            await ws.send(json.dumps({"text": text, "speaker_id": 0}))

            async for message in ws:
                if isinstance(message, bytes):
                    # Play audio chunk in real-time
                    pass
                else:
                    data = json.loads(message)
                    if data.get("type") == "done":
                        print(f"'{text}' → {data['audio_duration']}s")
                        break

        # Close session
        await ws.send(json.dumps({"type": "close"}))

asyncio.run(chat_tts())
```

### JavaScript — Browser

```javascript
const API_KEY = "rk_live_YOUR_KEY";
const BASE_URL = "https://silk-api.rumik.ai";
const SAMPLE_RATE = 24000;

async function streamTTS(text) {
  // Step 1: Get session
  const session = await fetch(`${BASE_URL}/v1/tts/ws-connect`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text, model: "muga" }),
  }).then(r => r.json());

  // Step 2: Connect WebSocket
  const ws = new WebSocket(`${session.ws_url}?token=${session.token}`);
  ws.binaryType = "arraybuffer";

  // Step 3: Setup audio playback (ring buffer for gap-free audio)
  const audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
  const RING_SIZE = SAMPLE_RATE * 60;
  const ringBuf = new Float32Array(RING_SIZE);
  let writePos = 0, readPos = 0, started = false;

  const scriptNode = audioCtx.createScriptProcessor(2048, 0, 1);
  scriptNode.onaudioprocess = (e) => {
    const output = e.outputBuffer.getChannelData(0);
    const available = (writePos - readPos + RING_SIZE) % RING_SIZE;
    if (!started && available >= SAMPLE_RATE * 1.5) started = true;
    if (!started) { output.fill(0); return; }
    for (let i = 0; i < output.length; i++) {
      if (readPos !== writePos) {
        output[i] = ringBuf[readPos];
        readPos = (readPos + 1) % RING_SIZE;
      } else output[i] = 0;
    }
  };
  scriptNode.connect(audioCtx.destination);

  // Step 4: Stream
  ws.onopen = () => {
    ws.send(JSON.stringify({ text, speaker_id: 0 }));
  };

  ws.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
      // Feed PCM into ring buffer
      const int16 = new Int16Array(event.data);
      for (let i = 0; i < int16.length; i++) {
        ringBuf[(writePos + i) % RING_SIZE] = int16[i] / 32768;
      }
      writePos = (writePos + int16.length) % RING_SIZE;
    } else {
      const msg = JSON.parse(event.data);
      if (msg.type === "done") {
        console.log(`Done: ${msg.audio_duration}s audio`);
      }
    }
  };
}

streamTTS("Hello from the browser!");
```

### Node.js

```javascript
const WebSocket = require("ws");

const API_KEY = "rk_live_YOUR_KEY";
const BASE_URL = "https://silk-api.rumik.ai";

async function streamTTS(text) {
  // Get session
  const resp = await fetch(`${BASE_URL}/v1/tts/ws-connect`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text, model: "muga" }),
  });
  const session = await resp.json();

  // Connect WebSocket
  const ws = new WebSocket(`${session.ws_url}?token=${session.token}`);

  ws.on("open", () => {
    ws.send(JSON.stringify({ text, speaker_id: 0 }));
  });

  const chunks = [];
  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      chunks.push(data);
    } else {
      const msg = JSON.parse(data.toString());
      if (msg.type === "done") {
        const total = chunks.reduce((a, c) => a + c.length, 0);
        console.log(`Done: ${msg.audio_duration}s, ${total} bytes`);
        ws.close();
      }
    }
  });
}

streamTTS("Hello from Node.js!");
```

---

## Audio Format

All audio is delivered as:
- **Format**: Raw PCM
- **Sample rate**: 24,000 Hz
- **Bit depth**: 16-bit signed integer (int16)
- **Channels**: 1 (mono)
- **Byte order**: Little-endian

HTTP endpoints return WAV (PCM with header). WebSocket endpoints return raw PCM chunks without headers.

### Converting PCM to WAV (Python)

```python
import wave

def pcm_to_wav(pcm_bytes, output_path, sample_rate=24000):
    with wave.open(output_path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_bytes)
```

### Playback in Browser

Use a ring buffer with `ScriptProcessorNode` for gap-free streaming playback. See the JavaScript example above or `scripts/test-client.html` for a full implementation.

---

## Models

| Model | Description | Languages | Status |
|-------|-------------|-----------|--------|
| `muga` | Sesame CSM 1B — conversational speech | English, Hinglish | Available |
| `mulberry` | Maya 3B — high-quality TTS | English, Hindi, Hinglish | Coming soon |

---

## Credits & Billing

- Credits are denominated in **paise** (1 credit = ₹0.01)
- Billing is per-request based on token count
- Check balance: `GET /v1/usage`

---

## Error Handling

All errors return JSON:

```json
{
  "error": "Error description",
  "code": "ERROR_CODE"
}
```

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `UNAUTHORIZED` | 401 | Missing or invalid API key |
| `INSUFFICIENT_CREDITS` | 402 | Not enough credits |
| `RATE_LIMITED` | 429 | Too many concurrent requests |
| `INVALID_MODEL` | 400 | Unknown model name |
| `GENERATION_ERROR` | 502 | Inference failed |
| `SERVER_ERROR` | 500 | Internal server error |

WebSocket errors:
```json
{"error": true, "code": "RATE_LIMITED", "message": "Too many concurrent connections"}
```

---

## Best Practices

1. **Reuse WebSocket connections** — send multiple texts on the same connection instead of reconnecting per request
2. **Use ring buffer for playback** — `AudioBufferSourceNode` scheduling causes micro-gaps; use `ScriptProcessorNode` with a ring buffer instead
3. **Buffer before playing** — wait for 1-1.5s of audio before starting playback to avoid underruns
4. **Handle queuing** — if a pod is busy, your request is queued (up to 10 per pod). The `{"type": "queued"}` message tells you the queue depth
5. **Set idle timeout** — connections idle for 1 minute are auto-closed. Send text or `{"type": "close"}` before that
6. **Check credits** — call `/v1/usage` to check balance before long sessions

---

## Rate Limits

| Limit | Default | Configurable |
|-------|---------|-------------|
| Concurrent connections per key | 5 | Yes (per key in DB) |
| Max text length | 2000 chars | No |
| WebSocket idle timeout | 1 minute | No |
| Session token expiry | 5 minutes | No |
| Internal queue per pod | 10 requests | No |