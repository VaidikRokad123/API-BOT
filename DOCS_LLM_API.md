# Local LLM API Documentation

This project transforms your web browser sessions (**ChatGPT, Grok, Gemini, Perplexity, DeepSeek**) into a **Local OpenAI-Compatible LLM API**. 

You can run this backend locally and use it as a drop-in replacement for OpenAI API in Python scripts, Node.js apps, LangChain, AutoGen, or any AI client software (Chatbox, AnythingLLM, Jan, Cursor, etc.) **without requiring paid API keys**.

---

## Key Features

- 🔌 **OpenAI Compatible Endpoint**: Full support for `/v1/chat/completions`, `/v1/models`, and `/v1/completions`.
- 🤖 **Multi-Provider Support**: Choose dynamically between `chatgpt`, `grok`, `gemini`, `perplexity`, or `deepseek`.
- ⚡ **Persistent Session Pooling**: Fast multi-turn conversations by maintaining warm browser tabs via `session_id`.
- 🌊 **Streaming SSE Support**: Supports `stream: true` for real-time frontend streaming interfaces.
- 🔑 **Optional API Key Security**: Secure your endpoint with `LLM_API_KEY` or leave it open for local network use.
- 🚀 **Simple REST Endpoint**: Quick `/api/v1/generate` endpoint for rapid single-prompt completions.

---

## Getting Started

### 1. Prerequisite: Log into your Provider(s)
First, make sure you have logged into at least one AI provider so your session is saved locally:

```bash
# Start CLI agent to login
npm run agent
# Inside REPL type /login, select ChatGPT, Grok, Gemini, Perplexity, or DeepSeek
```

### 2. Start the Backend API Server
Start the Express server on port `3000`:

```bash
# From workspace root
npm start

# Or directly in backend folder
cd backend
npm run serve
```

Your Local LLM API is now running locally at: **`http://localhost:3000`**

---

## 🌐 Remote & Public Access (via ngrok Tunnel)

If you connect your backend to **ngrok** (e.g. `https://karine-trisomic-karima.ngrok-free.dev`), you can use your local LLM API **from anywhere in the world**!

### Your Endpoints:
- **Local Base URL**: `http://localhost:3000/v1`
- **ngrok Remote Base URL**: `https://karine-trisomic-karima.ngrok-free.dev/v1`

> 💡 **ngrok Free Tier Tip**: Free ngrok URLs display an initial warning page for browser HTTP requests. When making API requests via code or cURL, pass the header `'ngrok-skip-browser-warning': 'true'` to bypass this screen automatically.

---

## Usage Examples

### 1. Python (`openai` Official Package)

Install `openai`:
```bash
pip install openai
```

Python Code (`example.py`):
```python
from openai import OpenAI

# Local connection:
# base_url = "http://localhost:3000/v1"

# Remote ngrok connection (accessible from anywhere):
base_url = "https://karine-trisomic-karima.ngrok-free.dev/v1"

client = OpenAI(
    base_url=base_url,
    api_key="local",  # or your LLM_API_KEY if enabled
    default_headers={"ngrok-skip-browser-warning": "true"}  # Required for ngrok free tier
)

response = client.chat.completions.create(
    model="grok",  # Options: "chatgpt", "grok", "gemini", "perplexity", "deepseek", or "default"
    messages=[
        {"role": "system", "content": "You are a helpful programming assistant."},
        {"role": "user", "content": "Write a python function to check if a string is a palindrome."}
    ]
)

print(response.choices[0].message.content)
```

---

### 2. Python (Persistent Multi-Turn Chat Session)

To preserve context and speed up follow-up requests, reuse a `session_id`:

```python
import requests

# Use local or ngrok URL
url = "https://karine-trisomic-karima.ngrok-free.dev/v1/chat/completions"
headers = {
    "Content-Type": "application/json",
    "ngrok-skip-browser-warning": "true"
}

# First turn - creates session 'chat-user-1'
payload = {
    "model": "chatgpt",
    "session_id": "chat-user-1",
    "messages": [
        {"role": "user", "content": "My name is Alice and my favorite language is Python."}
    ]
}

res1 = requests.post(url, json=payload, headers=headers).json()
print("AI:", res1["choices"][0]["message"]["content"])

# Second turn - reuses warm browser tab for fast response
payload2 = {
    "model": "chatgpt",
    "session_id": "chat-user-1",
    "messages": [
        {"role": "user", "content": "What is my favorite language?"}
    ]
}

res2 = requests.post(url, json=payload2, headers=headers).json()
print("AI:", res2["choices"][0]["message"]["content"])
```

---

### 3. JavaScript / Node.js (OpenAI SDK)

Install `openai`:
```bash
npm install openai
```

Node.js Code (`example.js`):
```javascript
import OpenAI from 'openai';

const openai = new OpenAI({
  // Local: 'http://localhost:3000/v1'
  // Remote ngrok:
  baseURL: 'https://karine-trisomic-karima.ngrok-free.dev/v1',
  apiKey: 'local',
  defaultHeaders: {
    'ngrok-skip-browser-warning': 'true'
  }
});

async function main() {
  const completion = await openai.chat.completions.create({
    model: 'gemini', // "chatgpt" | "grok" | "gemini" | "perplexity" | "deepseek"
    messages: [{ role: 'user', content: 'Explain quantum computing in 2 simple sentences.' }],
  });

  console.log(completion.choices[0].message.content);
}

main();
```

---

### 4. cURL / REST API

#### Standard OpenAI Chat Completion (Remote ngrok)
```bash
curl https://karine-trisomic-karima.ngrok-free.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "ngrok-skip-browser-warning: true" \
  -d '{
    "model": "deepseek",
    "messages": [
      {"role": "user", "content": "Hello! List 3 advantages of Docker."}
    ]
  }'
```

#### Simple REST Generation (`POST /api/v1/generate`)
```bash
curl https://karine-trisomic-karima.ngrok-free.dev/api/v1/generate \
  -H "Content-Type: application/json" \
  -H "ngrok-skip-browser-warning: true" \
  -d '{
    "prompt": "Summarize clean architecture in software development.",
    "provider": "grok"
  }'
```

---

### 5. LangChain Integration (Python)

```python
from langchain_community.chat_models import ChatOpenAI
from langchain_core.messages import HumanMessage

llm = ChatOpenAI(
    openai_api_base="http://localhost:3000/v1",
    openai_api_key="local",
    model_name="perplexity"
)

response = llm.invoke([HumanMessage(content="What are the latest news about Space exploration?")])
print(response.content)
```

---

### 6. Desktop AI Clients (Chatbox, AnythingLLM, Jan, NextChat)

You can connect popular AI UIs directly to your local backend:

- **API Provider**: OpenAI Custom / Compatible
- **API Host / Base URL**: `http://localhost:3000/v1`
- **API Key**: `local` (or your custom `LLM_API_KEY`)
- **Model Name**: `chatgpt`, `grok`, `gemini`, `perplexity`, or `deepseek`

---

## API Reference

### 1. `GET /v1/models` (or `/api/v1/models`)
Lists all supported local LLM provider models and their authentication status.

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

### 2. `POST /v1/chat/completions` (or `/api/v1/chat/completions`)

OpenAI-compatible Chat Completion API.

**Request Parameters:**
| Parameter | Type | Required | Description |
|---|---|---|---|
| `model` | string | No | Model provider: `"chatgpt"`, `"grok"`, `"gemini"`, `"perplexity"`, `"deepseek"`, or `"default"`. |
| `messages` | array | Yes | Array of message objects `[{ "role": "user"|"system"|"assistant", "content": "..." }]`. |
| `stream` | boolean | No | If `true`, returns Server-Sent Events (`text/event-stream`). Default: `false`. |
| `session_id` | string | No | Persistent session identifier. Reuses warm tab context for low-latency follow-up queries. |
| `keep_alive` | boolean | No | If `true`, preserves the browser session for future calls. Default: `false` (closes on completion unless `session_id` is set). |

**Response Example:**
```json
{
  "id": "chatcmpl-1723981200000-a1b2c",
  "object": "chat.completion",
  "created": 1723981200,
  "model": "grok",
  "session_id": "session-1723981200000-xyz",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Here is the response from Grok..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 15,
    "completion_tokens": 40,
    "total_tokens": 55
  }
}
```

---

### 3. `POST /api/v1/generate`

Simple REST endpoint for straightforward completions.

**Request:**
```json
{
  "prompt": "Write a funny Haiku about debugging.",
  "provider": "gemini",
  "session_id": "my-optional-session"
}
```

**Response:**
```json
{
  "success": true,
  "provider": "Gemini",
  "providerKey": "gemini",
  "sessionId": "session-123456",
  "prompt": "Write a funny Haiku about debugging.",
  "response": "Code failed at midnight,\nMissing single semicolon,\nNow the sun rises.",
  "timestamp": "2026-08-18T14:33:42.000Z"
}
```

---

### 4. `GET /api/v1/sessions`

Lists all currently active persistent browser API sessions.

**Response:**
```json
{
  "success": true,
  "sessions": [
    {
      "id": "chat-user-1",
      "providerName": "ChatGPT",
      "providerKey": "chatgpt",
      "createdAt": "2026-08-18T14:00:00.000Z",
      "lastUsed": "2026-08-18T14:05:00.000Z",
      "isConnected": true
    }
  ]
}
```

---

### 5. `DELETE /api/v1/sessions/:sessionId`

Closes and terminates a persistent browser API session.

**Response:**
```json
{
  "success": true,
  "sessionId": "chat-user-1"
}
```

---

### 6. `POST /api/jobs/search` (Job Finder & Firecrawl Engine)

Finds jobs using local/cloud **Firecrawl**, matches them against your resume (`backend/data/profile.json`), and filters by role, experience, location, and min CTC.

**Request:**
```bash
curl https://karine-trisomic-karima.ngrok-free.dev/api/jobs/search \
  -H "Content-Type: application/json" \
  -H "ngrok-skip-browser-warning: true" \
  -d '{
    "role": "Full Stack Developer",
    "location": "Surat",
    "minCtc": "6 LPA",
    "minExp": 0,
    "maxExp": 3,
    "limit": 10
  }'
```

**Response Example:**
```json
{
  "success": true,
  "count": 3,
  "jobs": [
    {
      "id": "job-1723985000-abc",
      "title": "Full Stack Engineer (Node.js + React)",
      "company": "TechCorp",
      "location": "Surat / Hybrid",
      "url": "https://example.com/careers/job-123",
      "matchScore": 92,
      "matchingSkills": ["JavaScript", "TypeScript", "React", "Node.js", "Express", "MongoDB"],
      "missingSkills": [],
      "summary": "Matches 6 key skills (JavaScript, TypeScript, React, Node.js)",
      "ctc": "6 LPA",
      "experience": "1-3 years"
    }
  ]
}
```

---

### 7. `POST /api/jobs/apply`

Triggers the AI auto-application flow for a specific job posting URL.

**Request:**
```bash
curl https://karine-trisomic-karima.ngrok-free.dev/api/jobs/apply \
  -H "Content-Type: application/json" \
  -H "ngrok-skip-browser-warning: true" \
  -d '{
    "url": "https://example.com/careers/job-123"
  }'
```

---

## Configuration & Security Options

In `backend/.env`:

```env
PORT=3000
MONGODB_URI=mongodb://localhost:27017/gpt_auth

# Optional: Require API Key for API access
# LLM_API_KEY=your_secret_api_key_here
```

If `LLM_API_KEY` is set, all client requests must include the header:
`Authorization: Bearer your_secret_api_key_here` or `x-api-key: your_secret_api_key_here`.

> ⚠️ **SECURITY WARNING FOR NGROK USERS**: When exposing your local LLM API over public ngrok tunnels (`https://karine-trisomic-karima.ngrok-free.dev`), anyone with your public URL could potentially trigger requests on your logged-in browser accounts.
> 
> **Always set `LLM_API_KEY=your_secret_key` in `backend/.env` when hosting over ngrok to protect your endpoint with authentication.**
