# GPT Automation Agent

Automate ChatGPT from the terminal — no API key, no cost. Uses your real ChatGPT account through a Playwright-controlled browser.

**Three things it can do:**
- **Login** — save your ChatGPT session once
- **Chat** — interactive terminal chat with memory across messages
- **Apply** — AI fills and submits job application forms automatically

> The browser is **always visible by default**. Pass `--hidden` if you want it minimized.

---

## Quick Start

```powershell
# 1. Install
npm install
npx playwright install chromium

# 2. Create your profile
copy data\profile.example.json data\profile.json
# → open data\profile.json and fill in your real info

# 3. Save your ChatGPT session
node agent.js login

# 4. Use it
node agent.js chat
node agent.js apply "https://company.com/jobs/apply/123"
```

---

## Requirements

- **Node.js v18+** — [nodejs.org](https://nodejs.org)
- A **ChatGPT account** (free or Plus — both work)

---

## Setup (step by step)

### Step 1 — Install dependencies

```powershell
npm install
npx playwright install chromium
```

> If your **C: drive is full**, redirect the browser download to another drive:
> ```powershell
> $env:PLAYWRIGHT_BROWSERS_PATH="D:\playwright-browsers"
> npx playwright install chromium
> ```
> Set that env var again before running `agent.js` commands.

---

### Step 2 — Create your profile

```powershell
copy data\profile.example.json data\profile.json
```

Open `data\profile.json` and fill in your real details. This is what the agent reads to answer job application form questions.

| Field | What to put |
|---|---|
| `name` | Your full name |
| `email` | Your email |
| `phone` | Your phone number |
| `city` | Your city — used for location questions ("Are you from X?") |
| `linkedin` | Full LinkedIn URL |
| `github` | Full GitHub URL |
| `portfolio` | Your website/portfolio URL |
| `yearsOfExperience` | Number as a string, e.g. `"2"` |
| `currentRole` | Your current job title |
| `currentCTC` | Current salary, e.g. `"4 LPA"` |
| `expectedCTC` | Expected salary, e.g. `"6 LPA"` |
| `noticePeriod` | Days, e.g. `"30"` |
| `reasonForLeaving` | Why you're switching jobs |
| `skills` | Array of skills: `["React", "Node.js", ...]` |
| `education` | Degree, field, college, year |
| `resume` | Paste your full resume as plain text — GPT reads this for open questions |
| `resumePdfPath` | Absolute path to your resume PDF, e.g. `"D:\\Documents\\resume.pdf"` |

---

### Step 3 — Login to ChatGPT

```powershell
node agent.js login
```

**What happens:**
1. A Chrome window opens and navigates to `chatgpt.com`
2. Log in to your ChatGPT account (handle any CAPTCHA manually)
3. Once you see your chat sidebar, come back to the terminal
4. Press **Enter**
5. Session is saved to `session/session.json`

You only need to do this **once**. Re-run it if your session expires (usually after a few weeks).

---

## How to Run

### Chat with GPT

```powershell
node agent.js chat
```

Opens a visible browser window and starts an interactive chat in the terminal. All messages in one session share memory — GPT remembers what you said earlier.

```
╔════════════════════════════════════════╗
║      ChatGPT Interactive Console       ║
║  All messages share memory this session║
║  Type "exit" or Ctrl+C to quit         ║
╚════════════════════════════════════════╝

You: what is React?
GPT: React is a JavaScript library for building user interfaces...
────────────────────────────────────────────────────────────

You: give me a code example
GPT: Here's a simple React component...
────────────────────────────────────────────────────────────

You: exit
Closing... Goodbye!
```

**One-shot question** (no loop — just prints the answer and exits):
```powershell
node agent.js ask "Explain closures in JavaScript"
```

**Run with browser hidden:**
```powershell
node agent.js chat --hidden
```

---

### Apply for a Job

```powershell
node agent.js apply "https://company.com/jobs/apply/123"
```

Opens the job URL in a visible browser. The agent reads every form field, asks ChatGPT how to fill them using your profile, and submits — you can watch it work in real time.

**Run with browser hidden (background mode):**
```powershell
node agent.js apply "https://company.com/jobs/apply/123" --hidden
```

**What it handles automatically:**

| | |
|---|---|
| Text fields | Name, email, phone, experience, etc. |
| Dropdowns | Selects the correct option by text |
| Checkboxes | Checks "I agree / accept terms" boxes |
| File upload | Uploads your resume PDF |
| Signature pad | Draws a cursive signature on canvas |
| Multi-page forms | Clicks Next and continues on the next page |
| Submission | Clicks Submit and saves `application_done.png` |

**Live output example:**
```
╔════════════════════════════════════════╗
║     Job Application AI Agent           ║
╚════════════════════════════════════════╝
URL     : https://company.com/apply/sde
Applying: Vaidik Rokad <vaidik@email.com>

════════════════════════════════════════════
  STEP 1  —  1:05:29 PM
════════════════════════════════════════════
  Fields: 0 | Buttons: 1 | Canvases: 0
  🤖 Asking ChatGPT...
  💭 Job details page — clicking Continue.
  [CLICK] Continue to Application

════════════════════════════════════════════
  STEP 2  —  1:05:49 PM
════════════════════════════════════════════
  Fields: 6 | Buttons: 2 | Canvases: 0
  🤖 Asking ChatGPT...
  💭 Page 1 of 2. Filling personal info.
  [FILL] Email → "vaidik@email.com"
  [FILL] Full Name → "Vaidik Rokad"
  [FILL] Years of Experience → "2"
  [SELECT] Current Location → "Surat"
  [CLICK] Next Page

✅ Application submitted! Screenshot → application_done.png
```

---

## All Commands

```powershell
node agent.js login                             # Save ChatGPT session (do once)

node agent.js chat                              # Interactive chat (browser visible)
node agent.js chat --hidden                     # Interactive chat (browser minimized)
node agent.js ask "your question"               # Single question, print answer, exit

node agent.js apply "URL"                       # Auto-apply to a job (browser visible)
node agent.js apply "URL" --hidden              # Auto-apply (browser minimized)
```

---

## How It Works

```
node agent.js login
  └─ Opens Chrome → you log in → saves cookies to session/session.json

node agent.js chat
  └─ Loads session → opens chatgpt.com (visible) → readline loop
       You type → agent types into #prompt-textarea → waits for .markdown to stabilize → prints response

node agent.js apply "URL"
  └─ Opens two browsers:
       Browser 1 (always hidden) — your ChatGPT session (the AI brain)
       Browser 2 (visible)       — the job application form

     Loop (up to 20 steps):
       1. scrapePageState()  → reads all inputs, selects, checkboxes, canvases, buttons from DOM
       2. sendMessage()      → sends page state + your profile to ChatGPT
       3. GPT returns JSON   → { actions: [{type, selector, value}], status }
       4. executeAction()    → fill / select / check / upload / signature / click
       5. repeat until status === "done"
       6. saves application_done.png on completion
```

**Why not use the ChatGPT API?**
This uses your **free ChatGPT account** through a real browser. No API key. No cost. No rate limits beyond your normal ChatGPT usage.

---

## File Structure

```
gpt_auth/
├── agent.js                    ← CLI entry point (routes commands)
├── package.json
├── package-lock.json
├── .gitignore
├── README.md
├── src/
│   ├── config.js               ← file paths
│   ├── browser.js              ← shared browser helpers
│   ├── gpt.js                  ← ChatGPT session + sendMessage
│   ├── login.js                ← login command
│   ├── chat.js                 ← chat command
│   └── apply/
│       ├── index.js            ← apply loop
│       ├── scraper.js          ← DOM scraper
│       ├── executor.js         ← action executor + signature drawer
│       └── prompt.js           ← GPT prompt builder + JSON sanitizer
├── data/
│   ├── profile.example.json    ← template (safe to share)
│   ├── profile.json            ← YOUR INFO (gitignored)
│   └── resume.pdf              ← YOUR RESUME (gitignored)
└── session/
    └── session.json            ← auto-generated by login (gitignored)
```

---

## Private Files

These are in `.gitignore` and will **never** be pushed to GitHub:

| File | Why |
|---|---|
| `session/session.json` | Your ChatGPT login cookies — treat like a password |
| `data/profile.json` | Name, email, phone, salary — personal info |
| `data/resume.pdf` | Your actual resume |

---

## Troubleshooting

**"Cannot find module 'playwright'"**
```powershell
npm install
npx playwright install chromium
```

**Session expired / login prompt appears**
```powershell
node agent.js login
```

**Dropdown not selecting correctly**
- Watch the browser — it's visible by default so you can see exactly what's happening
- The agent auto-retries if GPT returns bad JSON

**Resume PDF not uploading**
- Check `resumePdfPath` in `data/profile.json` points to a real file
- Use double backslashes on Windows: `"D:\\Documents\\MyResume.pdf"`

**Playwright browser not found**
```powershell
npx playwright install chromium
```

---

## License

MIT
