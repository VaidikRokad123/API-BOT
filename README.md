# AI Automation Agent

> Terminal-based AI agent that automates **ChatGPT, Grok, Gemini, Perplexity, and DeepSeek** — no API keys, no cost. Drives your real logged-in account through a browser.

**Core capabilities:**

| Feature | Description |
|---|---|
| **Login** | Pick a provider and save your session once |
| **Chat** | Interactive terminal chat with memory across messages |
| **Ask** | One-shot question — prints the answer and returns |
| **Council** | Ask all logged-in providers at once, merge their answers into one best response |
| **Apply** | Researches the company, then AI fills and submits job applications automatically |
| **Browser Subagent** | Delegate natural-language browser tasks (check feeds, pull headlines, extract data) |

Everything runs from a single interactive console (`node agent.js`). The browser is **visible by default** so you can watch it work.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Requirements](#requirements)
- [The Console](#the-console)
- [Web Interface](#web-interface)
- [Setup (Step by Step)](#setup-step-by-step)
- [How `/chat` Works](#how-chat-works)
- [How `/ask` Works](#how-ask-works)
- [How `/council` Works](#how-council-works)
- [How `/apply` Works](#how-apply-works)
- [The Browser Subagent (`/browser`)](#the-browser-subagent-browser)
- [Architecture](#architecture)
- [Permissions System](#permissions-system)
- [Application Ledger](#application-ledger)
- [Domain Skills (Auto-Learning)](#domain-skills-auto-learning)
- [Indirect Prompt Injection Defense (IDPI)](#indirect-prompt-injection-defense-idpi)
- [AutoSolver & Challenge Heuristics](#autosolver--challenge-heuristics)
- [Project Structure](#project-structure)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Quick Start

```powershell
# 1. Install dependencies for all folders (root, backend, frontend)
npm install
npm run install:all
npx playwright install chromium

# 2. Configure Environment Variables
# Copy the env templates and set your MongoDB URI / ports
copy backend\.env.example backend\.env
copy frontend\.env.example frontend\.env

# 3. Create your profile (only needed for /apply)
copy backend\data\profile.example.json backend\data\profile.json
# → open backend/data/profile.json and fill in your real info

# 4. Start the interactive CLI agent REPL
npm run agent
```

Then inside the console:

```
> /login          choose ChatGPT / Grok / Gemini / Perplexity / DeepSeek, log in once
> /chat           start chatting
> /apply <url>    auto-fill a job application
```

---

## Requirements

- **Node.js v18+** — [nodejs.org](https://nodejs.org)
- **MongoDB** — A running MongoDB server instance (local or Atlas cloud URI)
- An account with at least one of: **ChatGPT**, **Grok**, **Gemini**, **Perplexity**, **DeepSeek** (free tiers work)

---

## The Console

Run `npm run agent` (or `node backend/agent.js`) and you get an interactive prompt:

```
  ╔══════════════════════════════════════════════════════╗
  ║    AI Agent                                  v1.0    ║
  ║    Chat · Job Apply · Browser Automation             ║
  ╚══════════════════════════════════════════════════════╝

  Provider  :  Grok  ✓  (session active)
  Browser   :  Playwright (ariaSnapshot scraping)

  Type /help for all commands.

>
```

### Commands

| Command | What it does |
|---|---|
| `/login` | Pick a provider, open a browser, log in manually, save the session |
| `/model [provider]` | Choose or switch the active AI provider (accepts name, index, or prompts if blank) |
| `/chat` | Interactive chat with the active provider (type `exit` to return) |
| `/ask <question>` | One-shot question — prints the answer and returns to the menu |
| `/council <question>` | Ask **all** logged-in providers at once, then merge their answers |
| `/apply <url> [--hidden]` | AI-driven job application (interactive engine selection) |
| `/browser` | Interactively choose/switch the default browser engine |
| `/browser <engine>` | Directly switch engine (e.g. `real-chrome`, `real-brave`, `real-opera`, `playwright`) |
| `/browser <task> [--hidden] [--engine=...] [--provider=...]` | Run a natural-language browser automation task via the Subagent |
| `/status` | Show the active provider and whether its session is valid |
| `/help` | List all commands |
| `/exit` | Quit |

---

## Web Interface

The project includes a premium, glassmorphic dark-themed Web Interface (Dashboard) built with **React and Vite**, communicating with an Express.js API backend with real-time Socket.IO logs.

### Start the Web Server

You can run the frontend and backend in development mode concurrently or serve them independently.

#### 1. Development Mode (Concurrent Server: Ports `3000` & `5000`)
You can run both the Express backend API and the React Vite dev server concurrently with a single command from the root folder:
```powershell
# Start both backend and React frontend concurrently
npm run dev
```
Open **[http://localhost:5000](http://localhost:5000)** in your browser. API calls and WebSocket connections will automatically be proxied to the backend on port `3000`.

#### 2. Production Mode (Single Port: `3000`)
You can compile the frontend SPA assets and have the Express backend serve them statically:
```powershell
# 1. Compile the React Vite frontend app
npm run build:frontend

# 2. Start the production backend server
npm start
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.

#### 3. Custom Backend Routing (e.g. for Render or Ngrok)
If you host the frontend SPA on a separate platform like **Render** or **GitHub Pages** and expose your local backend via **Ngrok**, you can configure the backend URL by editing the frontend environment variables:
1. Open `frontend/.env`.
2. Set the `VITE_BACKEND_URL` variable to your public Ngrok URL:
   ```env
   VITE_BACKEND_URL=https://your-ngrok-subdomain.ngrok-free.app
   ```
The frontend SPA will load this variable at build/runtime to establish connections. You can also configure or override this URL on the fly inside the **Settings** page of the web application.

### Features
- **Dashboard**: Quick view of active provider status, connection status, overall stats (e.g. total applied, success rate), and recent application ledger logs.
- **Chat**: Real-time message streaming with message history, provider selector dropdown, and a live "thinking" state.
- **Job Apply**: Paste a job application URL, select a browser/AI engine, toggle company research, and view real-time log streaming and final outcome status.
- **Browser Subagent**: Run natural-language tasks via the browser agent with a live status/screenshot console and completion reports.
- **History**: Full database query view of all job applications from the MongoDB database with filters and statistics cards.
- **Settings**: Manage logins/sessions for all 5 providers, choose active browser engines, edit natural-language permission policies, and configure custom backend connection URLs.

### Web Architecture

The application is structured as a standard MERN workspace:

- `/backend/server.js`: Express & Socket.IO server config.
- `/backend/routes/`: Route modules mapping request parameters to core engine runs.
- `/frontend/index.html`: Vite entry HTML template.
- `/frontend/src/App.jsx`: React main layout shell, navigation, and state.
- `/frontend/src/main.jsx`: React mount entrypoint.
- `/frontend/src/components/`: Reusable React components (Dashboard, Chat, Apply, Browser, History, Settings).
- `/frontend/src/index.css`: Glassmorphic layout styling.

---

## Setup (Step by Step)

### Step 1 — Install

```powershell
# Install all dependencies for root, backend, and frontend
npm install
npm run install:all

# Install playwright browser binaries
npx playwright install chromium
```

> If your **C: drive is full**, redirect the browser download:
> ```powershell
> $env:PLAYWRIGHT_BROWSERS_PATH="D:\playwright-browsers"
> npx playwright install chromium
> ```
> Set that env var again before running `npm run agent`.

### Step 2 — Log in to a provider

```
> /login

    1)  ChatGPT       chatgpt.com
    2)  Grok          grok.com
    3)  Gemini        gemini.google.com
    4)  Perplexity    perplexity.ai
    5)  DeepSeek      chat.deepseek.com

  Enter 1–5: 2
```

1. A browser window opens at the provider's site
2. Log in to your account (handle any CAPTCHA manually)
3. Once you see the chat interface, come back to the terminal
4. Press **ENTER**
5. Session is saved to `session/<provider>.json`

You only do this **once per provider**. Re-run `/login` if a session expires.

> **Login auto-detection:** The agent first tries to connect to a Chrome instance running with remote debugging on port 9222. If found, it uses that (best for bypassing bot protection). Otherwise it launches a new Playwright browser.

### Step 3 — Create your profile (only for `/apply`)

```powershell
copy backend\data\profile.example.json backend\data\profile.json
```

Fill in `data\profile.json` — this is what the agent uses to answer application questions and log you into job portals.

#### Profile Fields

| Field | What to put | Required |
|---|---|---|
| `name` | Your full legal name | ✅ |
| `email` | Email address | ✅ |
| `phone` | Phone with country code (e.g. `"+91-9999999999"`) | ✅ |
| `city`, `state`, `country` | Location details | ✅ |
| `address`, `postalCode` | Street address and postal/zip code | Optional |
| `linkedin`, `github`, `portfolio` | Full URLs | Optional |
| `yearsOfExperience` | e.g. `"2"` | ✅ |
| `currentRole`, `desiredRole` | e.g. `"Full Stack Developer"` | ✅ |
| `currentCTC`, `expectedCTC` | e.g. `"4 LPA"`, `"6 LPA"` | ✅ |
| `noticePeriod` | In days, e.g. `"30"` | ✅ |
| `reasonForLeaving` | Why you're switching jobs | Optional |
| `skills` | Array: `["React", "Node.js", ...]` | ✅ |
| `education` | Object: `{ degree, field, institution, year }` | ✅ |
| `resume` | Full resume as plain text — used for open-ended questions | ✅ |
| `resumeLastUpdated` | Date string (e.g. `"2026-06-19"`) | ✅ |
| `resumePdfPath` | Absolute path to your resume PDF (double backslashes on Windows) | ✅ |
| `resumePdfLastUpdated` | Date string indicating when the PDF was updated | ✅ |
| `coverLetterStyle` | Style instructions for cover letters, e.g. `"professional and concise, under 300 words"` | Optional |
| `workAuthorization` | e.g. `"Yes, I am authorized to work"` | Optional |
| `requiresSponsorship` | `"Yes"` or `"No"` | Optional |
| `gender` | e.g. `"Male"`, `"Female"`, `"Prefer not to say"` | Optional |
| `ethnicity` | e.g. `"Asian"`, `"Prefer not to say"` | Optional |
| `veteranStatus` | `"Yes"` or `"No"` | Optional |
| `disabilityStatus` | `"Yes"` or `"No"` | Optional |
| `armedForcesStatus` | Military or government employee status | Optional |
| `hasNonCompete` | `"Yes"` or `"No"` | Optional |
| `previouslyEmployedHere` | `"Yes"` or `"No"` | Optional |
| `currentlyAtSubsidiary` | `"Yes"` or `"No"` | Optional |
| `willingToRelocate` | `"Yes"` or `"No"` | Optional |
| `legalNameSameAsPreferred` | `"Yes"` or `"No"` | Optional |

> [!TIP]
> The agent validates that `resumeLastUpdated` and `resumePdfLastUpdated` match. If they differ, `/apply` prints a warning to remind you to update your plain-text `resume` content alongside your PDF.

---

## How `/chat` Works

```
> /chat
[AI] Connecting to Grok... Ready ✓

  ╔══════════════════════════════════════════╗
  ║  Grok       Chat                          ║
  ║  All messages share memory this session  ║
  ║  Type "exit" to return to main menu      ║
  ╚══════════════════════════════════════════╝

You: what is React?
Grok: React is a JavaScript library for building user interfaces...
────────────────────────────────────────────────────────────

You: exit

  Closing chat... returning to main menu.
>
```

All messages in one chat session share memory. Type `exit`, `quit`, or `/exit` to return to the main console. If the session is expired, the agent will offer to re-login automatically.

---

## How `/ask` Works

One-shot mode — ask a single question, get the answer, and return to the menu without entering chat mode.

```
> /ask what is the capital of France?

  Grok: The capital of France is Paris.

>
```

---

## How `/council` Works

Ask the same question to **every provider you're logged into**, then have one of them merge all the answers into a single best response. A merged answer is more reliable than any single model — and it's free.

```
> /council what is the best way to learn React?

  Convening council: ChatGPT, Grok, Gemini

  Asking all providers (this runs in parallel)...

  ────────────────────────────────────────────────────────────
    ChatGPT
  ────────────────────────────────────────────────────────────
  Start with the official docs...

  ────────────────────────────────────────────────────────────
    Grok
  ────────────────────────────────────────────────────────────
  Build real projects from day one...

    1) ChatGPT
    2) Grok
    3) Gemini

  Which provider should merge all answers? (number, blank to skip): 1

  ══════════════════════════════════════════════════════════════
    CONSENSUS  (merged by ChatGPT)
  ══════════════════════════════════════════════════════════════
  The best approach combines official docs with hands-on projects...
```

- Uses **all** providers with a saved session automatically
- Needs **at least 2** providers logged in
- All providers are queried **in parallel** for speed
- You choose which provider merges the final answer

---

## How `/apply` Works

```
> /apply https://company.com/jobs/apply/123
```

The `/apply` command runs an interactive setup, then executes a fully automated job application flow.

### Interactive Setup

When you run `/apply`, you're prompted to configure:

1. **AI Browser (Brain):** Which engine runs the AI provider (always Playwright)
2. **Job App Browser (Hands):** Which browser fills the application form
   - `Real Chrome` — connects to your running Chrome via CDP (port 9222)
   - `Real Brave` — connects to your running Brave via CDP (port 9223)
   - `Real Opera` — connects to your running Opera via CDP (port 9224)
   - `Playwright` — launches a new automated browser
3. **Research:** Whether to conduct company/job research before filling

### The Two-Browser Architecture

`/apply` opens **two browsers simultaneously**:

| Browser | Role | Purpose |
|---|---|---|
| **Browser 1** (hidden) | Brain | Your AI provider session — reads forms, decides what to fill |
| **Browser 2** (visible) | Hands | The job application form — fills inputs, clicks buttons |

### Execution Flow

```
/apply <url>
  │
  ├── 1. Duplicate check (MongoDB ledger — skip if already applied successfully)
  ├── 2. Resume version validation (warn if PDF ≠ plain text dates)
  ├── 3. Navigate to job URL
  ├── 4. Detect if page is the form or a landing page → navigate to form
  ├── 5. Research (optional): extract company, role, requirements, salary, skill match
  │
  ├── 6. Form-filling loop (up to 40 steps):
  │     ├── Check for CAPTCHA → pause for user if found
  │     ├── Scrape form (aria snapshot + element list + field inventory)
  │     ├── Check for submission confirmation → break if done
  │     ├── Send observation to AI → receive JSON action
  │     ├── Execute action (fill, click, select, check, upload, etc.)
  │     ├── Track FSM state transitions (research → fill → review → submit → verify)
  │     └── Repeat
  │
  ├── 7. Verify goal completion (AI checks the final page state)
  ├── 8. Classify verdict (success / failure with reason)
  ├── 9. Record to application ledger (MongoDB)
  ├── 10. Save domain skill (if successful — auto-learns site quirks)
  └── 11. Auto-retry on retryable failures (up to 3 attempts with backoff)
```

### What It Handles Automatically

| Field / Action | How it handles it |
|---|---|
| Text fields | Name, email, phone, experience, tailored open-ended answers |
| Dropdowns | Native `<select>` and custom ARIA combobox/listbox dropdowns |
| Checkboxes & radios | Checks "I agree / accept terms" boxes, selects radio options |
| File upload | Uploads your resume PDF from `resumePdfPath` |
| Signature pad | Draws a cursive signature on canvas elements |
| Multi-page forms | Clicks Next/Continue and keeps filling |
| Salary questions | Quotes a market-appropriate figure from research |
| Counter inputs | React state updating with automated increment/decrement clicks |
| OAuth logins | Clicks "Sign in with Google" and handles popup authorization windows |
| CAPTCHAs | Detects and pauses — beeps and waits for you to solve manually |
| Invisible fields | Filters out hidden/phantom CAPTCHA tokens and off-screen elements |

### Advanced Application Handling

- **Popup & New Window OAuth:** Detects if a job site opens a "Sign in with Google" popup. Switches focus to the popup, completes the login flow, then returns to the form.
- **Multi-Step Google Sign-In:** Traverses Email → Password → Consent → Account Chooser programmatically.
- **Enforced Google Preference:** When faced with multiple login options, the AI is instructed to use Google Login.
- **Smart CAPTCHA Pausing:** Detects Cloudflare challenges, reCAPTCHA, hCaptcha, and Turnstile. Pauses with a terminal beep and waits for manual solve.
- **Form Counter Widgets:** Detects `+`/`-` button wrappers. Tries React state bypass first, falls back to sequential button clicks.
- **Automatic JSON Safety:** Includes a robust quote sanitizer to prevent AI-generated CSS selectors from breaking JSON parsing.

### Real Browser Mode

Some job sites block automated browsers. Start your normal browser with remote debugging, then select it during the `/apply` interactive setup.

#### Starting your browser with remote debugging:

##### 🌐 Chrome
```powershell
# Windows
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222

# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

##### 🦁 Brave
```powershell
# Windows
& "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe" --remote-debugging-port=9223

# macOS
/Applications/Brave\ Browser.app/Contents/MacOS/Brave\ Browser --remote-debugging-port=9223
```

##### ⭕ Opera
```powershell
# Windows
& "$env:LOCALAPPDATA\Programs\Opera\opera.exe" --remote-debugging-port=9224

# macOS
/Applications/Opera.app/Contents/MacOS/Opera --remote-debugging-port=9224
```

You can also set a default browser engine from the console:

```
> /browser real-chrome
> /browser real-brave
> /browser real-opera
```

> Firefox is not supported because it does not use the Chrome DevTools Protocol (CDP).

---

## The Browser Subagent (`/browser`)

The Browser Subagent delegates generic natural-language tasks to an AI-controlled browser. It uses a **perceive → act → verify** loop: scrape the page → ask the AI what to do → execute → repeat until the task is complete.

### Syntax

```
> /browser <task> [--hidden] [--engine=<engine>] [--provider=<provider>]
```

| Flag | Description |
|---|---|
| `--hidden` | Run the browser in headless mode |
| `--engine=<engine>` | Override browser engine: `playwright`, `real-chrome`, `real-brave`, `real-opera` |
| `--provider=<provider>` | Override AI provider: `chatgpt`, `grok`, `gemini`, `perplexity`, `deepseek` |

### Examples

```
# Analyze your LinkedIn feed
> /browser check linkedin and give me top 5 posts analyzed --engine=real-brave

# Fetch news headlines
> /browser check breaking news on timesofindia and report top 5 articles

# GitHub search
> /browser search for "playwright" on github and report the star count

# Extract data from a page
> /browser go to reddit.com/r/programming and list the top 10 posts with upvote counts
```

### Available Tools

The subagent has access to these browser automation tools:

| Tool | Description |
|---|---|
| `navigate` | Navigate to a URL |
| `click` | Click an element by CSS selector or ref |
| `click_blank` | Click a blank area to dismiss overlays/dropdowns |
| `fill` | Fill a text input with a value |
| `select` | Select a dropdown option (native or custom combobox) |
| `check` | Check a checkbox or radio button |
| `upload` | Upload a file via file chooser |
| `scroll` | Scroll page (up/down) or scroll element into view |
| `hover` | Hover over an element |
| `press` | Press a keyboard key |
| `wait` | Wait for a duration or for a selector to appear |
| `read` | Re-read the page text (after scrolling) |
| `screenshot` | Take a screenshot |
| `extract` | Extract text from an element |
| `handle_login` | Handle OAuth/login popups |
| `signature` | Draw a signature on a canvas |
| `fill_form` | Fill multiple form fields at once (batch mode) |
| `finish` | Mark the task as complete and return a report |

### Step Execution and Trace Logs

Each subagent run creates a folder in `subagent_runs/`:

```
subagent_runs/
  └── run-2026-06-21T15-34-37-447Z-f7c7go/
        ├── report.md          # Markdown summary with verdict (✅ PASSED / ❌ FAILED)
        ├── trace.json         # Full structured JSON trace of every step
        ├── console.log        # Browser console and network logs
        └── step-01-step.png   # Step-by-step screenshots
```

Additionally, structured step data is saved in `data/runs/<run-id>/`:

```
data/runs/
  └── run-2026-06-21T15-34-37-447Z-f7c7go/
        ├── steps.json         # Structured step data with screenshots
        └── action-01-001.png  # Full-page action screenshots
```

---

## Architecture

### Two-Browser Model

```
node agent.js  →  interactive REPL (slash commands)

/apply   → Browser 1 (hidden, AI provider = Brain)
         + Browser 2 (visible, job form = Hands)

         research company → loop: scrape form → AI returns JSON actions → execute → repeat → submit
```

**Why not use an API?** This drives your **existing logged-in account** through a real browser. No API key, no cost, no extra rate limits beyond normal usage.

### State Machine (FSM)

The `/apply` flow is governed by a finite state machine (powered by [XState](https://xstate.js.org/) with a lightweight fallback):

```
research → fill → review → submit → verify
                ↑    ↓↑
                └────┘
```

| State | Description |
|---|---|
| `research` | Job/company research phase |
| `fill` | Form filling in progress |
| `review` | Reviewing filled fields before submission |
| `submit` | Submit button clicked, waiting for confirmation |
| `verify` | Final verification — AI checks if submission succeeded |

### Provider Architecture

Each AI provider (`src/providers/`) exports:
- `config` — name, URL, readySelector, responseSelector, inputSelector, stopSelector
- `sendMessage(page, text)` — sends a prompt and waits for a stable response

Supported providers:

| Provider | File | URL |
|---|---|---|
| ChatGPT | `src/providers/chatgpt.js` | chatgpt.com |
| Grok | `src/providers/grok.js` | grok.com |
| Gemini | `src/providers/gemini.js` | gemini.google.com |
| Perplexity | `src/providers/perplexity.js` | perplexity.ai |
| DeepSeek | `src/providers/deepseek.js` | chat.deepseek.com |

### Browser Engines

| Engine | How it works |
|---|---|
| `playwright` | Launches a new Chrome via Playwright (default, self-contained) |
| `real-chrome` | Connects to your running Chrome via CDP on port 9222 |
| `real-brave` | Connects to your running Brave via CDP on port 9223 |
| `real-opera` | Connects to your running Opera via CDP on port 9224 |

CDP URLs can be overridden via environment variables: `REAL_CHROME_CDP_URL`, `REAL_BRAVE_CDP_URL`, `REAL_OPERA_CDP_URL`.

---

## Permissions System

The file `data/permissions.json` controls which actions the agent can perform automatically vs. which require user confirmation:

```json
{
  "fill_text_field": "allow",
  "select_dropdown": "allow",
  "oauth_login": "ask",
  "submit_application": "ask",
  "upload_file": "allow"
}
```

| Permission | Values | Description |
|---|---|---|
| `fill_text_field` | `allow` / `ask` / `deny` | Filling text inputs |
| `select_dropdown` | `allow` / `ask` / `deny` | Selecting dropdown options |
| `oauth_login` | `allow` / `ask` / `deny` | OAuth / Google login handling |
| `submit_application` | `allow` / `ask` / `deny` | Clicking the final submit button |
| `upload_file` | `allow` / `ask` / `deny` | Uploading files (resume) |

- **`allow`** — executes automatically
- **`ask`** — pauses and asks for confirmation in the terminal
- **`deny`** — blocks the action entirely

---

## Application Ledger

The agent maintains a **MongoDB database collection** (via Mongoose) to track every job application:

| Column / Field | Description |
|---|---|
| `url` | The job application URL |
| `company` | Company name (from research) |
| `role` | Job title (from research) |
| `verdict` | `success` or `failure` |
| `failure_reason` | Classification: `captcha`, `session_expired`, `already_applied`, `sso_required`, `form_incompatible`, `element_not_found`, `timeout`, `cloudflare_block` |
| `run_id` | Link to the subagent run artifacts |
| `timestamp` | ISO timestamp |

**Features:**
- **Duplicate detection:** Before applying, checks if you've already successfully applied to the same URL (or same company+role). Skips if found.
- **Auto-retry:** Retryable failures (`element_not_found`, `timeout`) trigger up to 3 automatic retries with exponential backoff.
- **Permanent failures:** Non-retryable reasons (`captcha`, `session_expired`, `already_applied`, `sso_required`, `form_incompatible`, `cloudflare_block`) are recorded without retry.

---

## Domain Skills (Auto-Learning)

After a **successful** application, the agent saves a "domain skill" for that job site to `domain-skills/<hostname>.json`. On future applications to the same site, the agent loads this skill to:

- Reuse working selector/ref strategies
- Remember site quirks (custom dropdowns, canvas signature pads, counter widgets)
- Speed up form-filling by skipping trial-and-error

Example domain skill:
```json
{
  "hostname": "jobs.example.com",
  "learnedAt": "2026-06-21T15:34:37.447Z",
  "company": "Example Corp",
  "role": "Full Stack Developer",
  "strategy": [
    { "tool": "fill", "args": { "selector": "#name", "value": "..." }, "result": "..." },
    { "tool": "click", "args": { "selector": ".next-btn" }, "result": "..." }
  ],
  "quirks": ["custom_dropdown_handling"]
}
```

---

## Indirect Prompt Injection Defense (IDPI)

The Browser Subagent includes built-in safeguards to prevent external webpages (such as untrusted job descriptions or compromised domains) from executing **Indirect Prompt Injection** attacks (e.g. attempting to override the agent's instructions, leak system prompts, or exfiltrate session data).

### Defense Mechanisms

1. **Domain Whitelisting**: Restricts browser navigation to an allowed list of domains (such as target AI providers or specific job sites). Attempts to navigate to non-approved domains are flagged and can be configured to block in strict mode.
2. **Content Scanning**: Analyzes scraped page content against standard injection payload signatures (such as *"ignore previous instructions"*, *"reveal your system prompt"*, *"send cookies"*) before it is sent to the LLM.
3. **Delimiter Wrapping & Advisory**: Wraps untrusted webpage content inside explicit boundaries (`<untrusted_web_content url="..."> ... </untrusted_web_content>`) and prepends a safety warning. Delimiters inside the scraped text are automatically sanitized (replacing `</untrusted_web_content>` with `< /untrusted_web_content>`) to prevent the LLM from escaping the boundary.

---

## AutoSolver & Challenge Heuristics

The agent features an upgraded, heuristics-based anti-bot detection engine designed to identify browser verification challenges:

- **Cloudflare Turnstile**: Checks for cdn-cgi challenge URLs and browser verification status.
- **reCAPTCHA Enterprise & v2/v3**: Detects recaptcha execution wrappers and checkbox anchors.
- **hCaptcha**: Identifies hCaptcha API script targets and checkbox tags.
- **Custom JS Barriers**: Catches access-denied integrity tests and automated driver blocks.

When a challenge is detected, the agent logs the specific anti-bot type, sounds a terminal beep, and pauses execution so you can solve it manually.

---

## Project Structure

```
gpt_auth/
├── package.json                # Dependencies and npm scripts
│
├── backend/                    # Express.js API Backend & CLI Core
│   ├── agent.js                # CLI Entry point — interactive REPL with slash commands
│   ├── server.js               # Web server configuration (Express + Socket.IO)
│   ├── routes/                 # Express route handlers
│   │   ├── apply.js            # /api/apply endpoint
│   │   ├── ask.js              # /api/ask endpoint
│   │   ├── browser.js          # /api/browser endpoint
│   │   ├── chat.js             # /api/chat endpoint
│   │   ├── council.js          # /api/council endpoint
│   │   ├── history.js          # /api/history endpoint
│   │   ├── providers.js        # /api/providers endpoint
│   │   └── status.js           # /api/status endpoint
│   │
│   └── src/                    # Shared automation core engine
│       ├── ai.js               # AI session management
│       ├── browser.js          # Browser engine management
│       ├── chat.js             # Interactive chat mode
│       ├── config.js           # Configuration paths and helpers
│       ├── council.js          # Multi-provider council
│       ├── login.js            # Provider login and model selection
│       ├── playwright-adapter.js # Playwright-to-Puppeteer API adapter
│       │
│       ├── providers/          # AI provider integrations (chatgpt, grok, etc.)
│       ├── apply/              # Job application auto-filler engine
│       └── subagent/           # Browser subagent percept-act loop
│
├── frontend/                   # Premium Dark Theme React SPA Frontend
│   ├── index.html              # Main frontend HTML container
│   ├── vite.config.js          # Vite configuration
│   ├── package.json            # React & Vite build configurations
│   └── src/                    # React codebase
│       ├── main.jsx            # React mount entrypoint
│       ├── App.jsx             # React main layout shell, navigation, and state
│       ├── index.css           # Glassmorphic custom CSS styling
│       └── components/         # Reusable React components (Dashboard, Chat, Apply, Browser, History, Settings)
│
├── data/
│   ├── profile.example.json    # Example profile template
│   ├── profile.json            # Your personal profile (gitignored)
│   ├── permissions.json        # Action permission policy
│   ├── resume.pdf              # Your resume PDF (gitignored)
│   └── runs/                   # Structured step data per run (MongoDB records history)
│
├── session/                    # Provider session files (gitignored)
│   ├── active.json             # Currently active provider
│   ├── session.json            # ChatGPT session (legacy name)
│   ├── grok.json               # Grok session
│   ├── gemini.json             # Gemini session
│   └── browser.json            # Browser engine preference
│
├── subagent_runs/              # Subagent run artifacts (gitignored)
├── domain-skills/              # Learned domain strategies (auto-created)
│
├── test/                       # Unit tests (Node.js built-in test runner)
│   ├── dropdown.test.js
│   ├── completion.test.js
│   ├── apply-prompt.test.js
│   └── selector.test.js
│
└── tests/
    └── fixtures/               # Playwright fixture tests
```

---

## Testing

### Unit Tests

```powershell
npm test
```

Runs unit tests using Node.js built-in test runner:
- `test/dropdown.test.js` — Dropdown placeholder detection
- `test/completion.test.js` — Submission confirmation detection
- `test/apply-prompt.test.js` — AI prompt construction and JSON sanitization
- `test/selector.test.js` — CSS selector utilities

### Fixture Tests

```powershell
npm run test:fixtures
```

Runs Playwright-based fixture tests from `tests/fixtures/`.

---

## Troubleshooting

**"Login expired" right after logging in**
The provider's input selector may have drifted (their UI changed). Your session is probably fine — open the site, inspect the input box, and update the `readySelector` in `src/providers/<provider>.js`.

**Agent gets stuck on a CAPTCHA**
Check your terminal! The agent will detect CAPTCHAs and ask you to press `ENTER` once you have manually solved the challenge in the visible browser window.

**Resume PDF not uploading**
Check `resumePdfPath` in `data/profile.json` is a real path with double backslashes on Windows: `"D:\\Docs\\resume.pdf"`.

**MongoDB connection issues / status disconnected**
Make sure your MongoDB server is running (if local) or your connection string in `backend/.env` is correct. If you are using MongoDB Atlas, make sure your current IP address is whitelisted in the Atlas console.

**Real browser won't connect**
If Chrome/Brave/Opera is already running, close **all** windows/processes first, then restart with the `--remote-debugging-port` flag. Existing browser processes ignore new debugging flags.

**AI response timed out**
The provider may be slow or the stop button may be "stuck." The agent includes a deadlock protection: after ~16 seconds of a stuck stop button, it ignores it and returns whatever text is available.

---

## License

MIT
