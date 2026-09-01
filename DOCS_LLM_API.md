# Local & Cloud LLM API Documentation

This project transforms your web browser sessions (**ChatGPT, Grok, Gemini, Perplexity, DeepSeek**) into a **Production-Ready OpenAI-Compatible LLM API**. 

You can run this backend locally via Docker or connect directly to the hosted cloud server at **`https://my-local-llm-api.onrender.com`** as a drop-in replacement for OpenAI API in Python scripts, Node.js apps, LangChain, AutoGen, or any AI client software (Chatbox, AnythingLLM, Jan, Cursor, NextChat, etc.) **without requiring paid API keys**.

---

## 🌐 Public Cloud API Endpoint (Render)

The API is deployed and hosted live on Render:

| Service | URL |
|---|---|
| **Public API Base URL** | **`https://my-local-llm-api.onrender.com/v1`** |
| **Public Web Dashboard & Chat** | **`https://my-local-llm-api.onrender.com`** |
| **Public Remote Browser GUI (noVNC)** | **`https://my-local-llm-api.onrender.com/novnc/vnc.html`** |
| **Local API Base URL** | `http://localhost:3000/v1` |
| **Local Remote GUI (noVNC)** | `http://localhost:3000/novnc/vnc.html` |

---

## Key Features

- 🔌 **OpenAI Compatible Endpoint**: Full drop-in support for `/v1/chat/completions`, `/v1/models`, and `/v1/completions`.
- 🤖 **Multi-Provider Support**: Choose dynamically between `chatgpt`, `grok`, `gemini`, `perplexity`, or `deepseek`.
- ⚡ **Persistent Session Pooling**: Fast multi-turn conversations by maintaining warm browser tabs via `session_id`.
- 🔄 **Session Lifecycle Management**: Create a session once, send unlimited requests, close when done — no browser reopening.
- 🌊 **Streaming SSE Support**: Supports `stream: true` for real-time frontend streaming interfaces.
- 🔑 **Optional API Key Security**: Secure your endpoint with `LLM_API_KEY` (send via `Authorization: Bearer <KEY>` or `x-api-key`).
- 📥 **Web Session Importer & Exporter**: Paste or export Base64 session tokens directly from the Web UI without restarting containers.
- 🖥️ **Virtual Display (`Xvfb`) & Remote GUI (`noVNC`)**: Browser automation runs in a real virtual X11 display buffer, with optional web-based remote viewing.
- 🛡️ **Built-in Cloudflare & Anti-Bot Solver**: Automated challenge detection and stealth evasion.
- 🌐 **Residential Proxy Support**: Route browser traffic through `PROXY_SERVER` to avoid datacenter IP bans.

---

## Quick Start & Usage Examples

### 1. Python (`openai` Official Package)

Install `openai`:
```bash
pip install openai
```

Python Code (`example.py`):
```python
from openai import OpenAI

# Connect to the live hosted API on Render:
client = OpenAI(
    base_url="https://my-local-llm-api.onrender.com/v1",
    api_key="local"  # Or your LLM_API_KEY if configured
)

# Test request to ChatGPT
response = client.chat.completions.create(
    model="chatgpt",  # Options: "chatgpt", "grok", "gemini", "perplexity", "deepseek"
    messages=[
        {"role": "system", "content": "You are a helpful programming assistant."},
        {"role": "user", "content": "Write a python function to check if a string is a palindrome."}
    ]
)

print(response.choices[0].message.content)
```

---

### 2. JavaScript / Node.js (OpenAI SDK)

Install `openai`:
```bash
npm install openai
```

Node.js Code (`example.js`):
```javascript
import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'https://my-local-llm-api.onrender.com/v1',
  apiKey: 'local' // Or your LLM_API_KEY
});

async function main() {
  const completion = await openai.chat.completions.create({
    model: 'grok', // "chatgpt" | "grok" | "gemini" | "perplexity" | "deepseek"
    messages: [
      { role: 'user', content: 'Explain quantum computing in 2 simple sentences.' }
    ],
  });

  console.log(completion.choices[0].message.content);
}

main();
```

---

### 3. cURL / REST API

#### Standard OpenAI Chat Completion
```bash
curl -X POST https://my-local-llm-api.onrender.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "chatgpt",
    "messages": [
      {"role": "user", "content": "Hello! List 3 advantages of Docker."}
    ]
  }'
```

#### Simple REST Generation (`POST /api/v1/generate`)
```bash
curl -X POST https://my-local-llm-api.onrender.com/api/v1/generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Summarize clean architecture in software development.",
    "provider": "gemini"
  }'
```

---

### 4. Persistent Multi-Turn Conversations (High Speed)

To preserve context and speed up follow-up requests, reuse a `session_id`:

```python
import requests

BASE_URL = "https://my-local-llm-api.onrender.com/v1/chat/completions"
HEADERS = {"Content-Type": "application/json"}

# First turn - creates warm session tab 'user-session-101'
res1 = requests.post(BASE_URL, json={
    "model": "chatgpt",
    "session_id": "user-session-101",
    "messages": [{"role": "user", "content": "My name is Alice and I love Rust."}]
}, headers=HEADERS).json()

print("AI:", res1["choices"][0]["message"]["content"])

# Second turn - reuses the warm browser tab instantly
res2 = requests.post(BASE_URL, json={
    "model": "chatgpt",
    "session_id": "user-session-101",
    "messages": [{"role": "user", "content": "What is my name and favorite language?"}]
}, headers=HEADERS).json()

print("AI:", res2["choices"][0]["message"]["content"])
```

---

### 5. Desktop AI Clients (Chatbox, AnythingLLM, Jan, NextChat, Cursor)

Connect your favorite desktop or web client directly to the hosted server:

- **Provider**: OpenAI Compatible
- **Base URL / API Host**: `https://my-local-llm-api.onrender.com/v1`
- **API Key**: `local` (or your custom `LLM_API_KEY`)
- **Model Name**: `chatgpt`, `grok`, `gemini`, `perplexity`, or `deepseek`

---

## API Reference

### 1. `GET /v1/models` (or `/api/v1/models`)
Lists all supported LLM provider models and their authentication status.

**Endpoint:** `GET https://my-local-llm-api.onrender.com/v1/models`

**Response:**
```json
{
  "object": "list",
  "data": [
    {
      "id": "chatgpt",
      "object": "model",
      "owned_by": "openai",
      "meta": { "name": "ChatGPT", "loggedIn": true, "active": true }
    },
    {
      "id": "grok",
      "object": "model",
      "owned_by": "xai",
      "meta": { "name": "Grok", "loggedIn": true, "active": false }
    },
    {
      "id": "gemini",
      "object": "model",
      "owned_by": "google",
      "meta": { "name": "Gemini", "loggedIn": true, "active": false }
    },
    {
      "id": "perplexity",
      "object": "model",
      "owned_by": "perplexity",
      "meta": { "name": "Perplexity", "loggedIn": true, "active": false }
    },
    {
      "id": "deepseek",
      "object": "model",
      "owned_by": "deepseek",
      "meta": { "name": "DeepSeek", "loggedIn": true, "active": false }
    }
  ]
}
```

---

### 2. `POST /v1/chat/completions`

OpenAI-compatible Chat Completion API.

**Request Parameters:**
| Parameter | Type | Required | Description |
|---|---|---|---|
| `model` | string | No | Model provider: `"chatgpt"`, `"grok"`, `"gemini"`, `"perplexity"`, `"deepseek"`, or `"default"`. |
| `messages` | array | Yes | Array of message objects `[{ "role": "user"|"system"|"assistant", "content": "..." }]`. |
| `stream` | boolean | No | If `true`, returns Server-Sent Events (`text/event-stream`). Default: `false`. |
| `session_id` | string | No | Persistent session identifier. Reuses warm tab context for low-latency follow-up queries. |
| `keep_alive` | boolean | No | If `true`, preserves the browser session for future calls. Default: `false`. |

---

### 3. Session Lifecycle Endpoints

Manage persistent browser sessions to avoid opening a new browser on every API call.

#### `POST /api/v1/sessions` — Create a Warm Session
```bash
curl -X POST https://my-local-llm-api.onrender.com/api/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"model": "chatgpt", "session_id": "my-session"}'
```

#### `GET /api/v1/sessions` — List Active Sessions
```bash
curl https://my-local-llm-api.onrender.com/api/v1/sessions
```

#### `DELETE /api/v1/sessions/:sessionId` — Close a Session
```bash
curl -X DELETE https://my-local-llm-api.onrender.com/api/v1/sessions/my-session
```

---

### 4. Session Import & Export Endpoints (Cloud Management)

Manage session tokens dynamically on the server without redeploying containers:

#### `POST /api/sessions/import` — Import Session Token
```bash
curl -X POST https://my-local-llm-api.onrender.com/api/sessions/import \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "chatgpt",
    "sessionData": "<paste_base64_string_here>"
  }'
```

#### `GET /api/sessions/export` — Export All Sessions to Base64
```bash
curl https://my-local-llm-api.onrender.com/api/sessions/export
```

#### `GET /api/environment` — Check Runtime Status
```bash
curl https://my-local-llm-api.onrender.com/api/environment
```

---

## 🐳 Docker Local Setup

To run your own local instance using Docker:

1. **Start the container**:
   ```bash
   docker compose up -d --build
   ```

2. **Access local services**:
   * **API & Web UI**: [http://localhost:3000](http://localhost:3000)
   * **Remote Browser GUI (noVNC)**: [http://localhost:6080/vnc.html](http://localhost:6080/vnc.html)

3. **Exporting Sessions for Render**:
   To export your local session cookies to Base64 strings for Render:
   ```bash
   npm run export-sessions
   ```
