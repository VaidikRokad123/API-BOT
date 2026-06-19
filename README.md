# AI Automation Agent

Automate **ChatGPT, Grok, Gemini, or Perplexity** from the terminal — no API key, no cost. Uses your real logged-in account through a Playwright-controlled browser.

**What it can do:**
- **Login** — pick a provider and save your session once
- **Chat** — interactive terminal chat with memory across messages
- **Ask** — one-shot question, prints the answer, returns
- **Apply** — researches the company, then AI fills and submits job application forms automatically

Everything runs from a single interactive console (`node agent.js`). The browser is **visible by default** so you can watch it work.

---

## Quick Start

```powershell
# 1. Install
npm install
npx playwright install chromium

# 2. Create your profile (only needed for /apply)
copy data\profile.example.json data\profile.json
# → open data\profile.json and fill in your real info

# 3. Start the agent
node agent.js
```

Then inside the console:

```
> /login          choose ChatGPT / Grok / Gemini / Perplexity, log in once
> /chat           start chatting
> /apply <url>    auto-fill a job application
```

---

## Requirements

- **Node.js v18+** — [nodejs.org](https://nodejs.org)
- An account with at least one of: **ChatGPT**, **Grok**, **Gemini**, **Perplexity** (free tiers work)

---

## The Console

Run `node agent.js` and you get an interactive prompt:

```
  ╔══════════════════════════════════════════════════════╗
  ║    AI Agent                                  v1.0    ║
  ║    Chat · Job Apply · Browser Automation             ║
  ╚══════════════════════════════════════════════════════╝

  Provider  :  Grok  ✓  (session active)

  Type /help for all commands.

>
```

### Commands

| Command | What it does |
|---|---|
| `/login` | Pick a provider, open a browser, log in manually, save the session |
| `/chat` | Interactive chat with the active provider (type `exit` to return) |
| `/ask <question>` | One-shot question — prints the answer and returns to the menu |
| `/apply <url>` | Research the company + AI-fill the job application form |
| `/apply <url> --hidden` | Same, but browser minimized |
| `/status` | Show the active provider and whether its session is valid |
| `/help` | List all commands |
| `/exit` | Quit |

---

## Setup (step by step)

### Step 1 — Install

```powershell
npm install
npx playwright install chromium
```

> If your **C: drive is full**, redirect the browser download:
> ```powershell
> $env:PLAYWRIGHT_BROWSERS_PATH="D:\playwright-browsers"
> npx playwright install chromium
> ```
> Set that env var again before running `node agent.js`.

### Step 2 — Log in to a provider

```
> /login

    1)  ChatGPT       chatgpt.com
    2)  Grok          grok.com
    3)  Gemini        gemini.google.com
    4)  Perplexity    perplexity.ai

  Enter 1–4: 2
```

1. A browser window opens at the provider's site
2. Log in to your account (handle any CAPTCHA manually)
3. Once you see the chat interface, come back to the terminal
4. Press **ENTER**
5. Session is saved to `session/<provider>.json`

You only do this **once per provider**. Re-run `/login` if a session expires.

### Step 3 — Create your profile (only for `/apply`)

```powershell
copy data\profile.example.json data\profile.json
```

Fill in `data\profile.json` — this is what the agent uses to answer application questions.

| Field | What to put |
|---|---|
| `name`, `email`, `phone`, `city` | Personal details (`city` is used for location questions) |
| `linkedin`, `github`, `portfolio` | Full URLs |
| `yearsOfExperience`, `currentRole` | e.g. `"2"`, `"Full Stack Developer"` |
| `currentCTC`, `expectedCTC` | e.g. `"4 LPA"`, `"6 LPA"` |
| `noticePeriod`, `reasonForLeaving` | e.g. `"30"`, why you're switching |
| `skills` | Array: `["React", "Node.js", ...]` |
| `education` | Degree, field, college, year |
| `resume` | Full resume as plain text — used for open-ended questions |
| `resumePdfPath` | Absolute path to your resume PDF (double backslashes: `"D:\\Docs\\resume.pdf"`) |

---

## How `/chat` works

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

You: give me a code example
Grok: Here's a simple component...
────────────────────────────────────────────────────────────

You: exit

  Closing chat... returning to main menu.
>
```

All messages in one chat session share memory. Type `exit`, `quit`, or `/exit` to return to the main console (the provider stays logged in).

---

## How `/apply` works

```
> /apply https://company.com/jobs/apply/123
```

It opens **two browsers**:
- **Browser 1** (hidden) — your AI provider session (the brain)
- **Browser 2** (visible) — the job application form (the hands)

Then it:

1. **Researches first** — reads the job page, asks the AI to extract the company, role, key requirements, a fitting salary to quote (at/below market), and which of your skills match best.
2. **Loops** (up to 20 steps): scrape the form → ask the AI how to fill it (using your profile + research) → execute → repeat.
3. **Submits** and saves `application_done.png`.

**What it handles automatically:**

| | |
|---|---|
| Text fields | Name, email, phone, experience, tailored open-ended answers |
| Dropdowns | Selects the correct option by text |
| Checkboxes | Checks "I agree / accept terms" boxes |
| File upload | Uploads your resume PDF |
| Signature pad | Draws a cursive signature on canvas |
| Multi-page forms | Clicks Next and continues |
| Salary questions | Quotes a market-appropriate figure, or "as per company standard" when unsure |

Run with `--hidden` to minimize the form browser.

---

## How It Works (under the hood)

```
node agent.js  →  interactive REPL (slash commands)

/login   → pick provider → browser opens → you log in → saves session/<provider>.json + active.json

/chat    → loads active session → opens provider site → readline loop
             You type → agent types into the provider's input → waits for the
             response to stabilize → prints it

/apply   → Browser 1 (hidden, the AI) + Browser 2 (visible, the form)
             research the company once, then loop:
               scrape form → AI returns JSON actions → execute → repeat → submit
```

**Why not use an official API?** This drives your **existing logged-in account** through a real browser. No API key, no cost, no extra rate limits beyond normal usage.

**Switching providers:** run `/login` again and pick a different one. The last provider you logged into becomes the active one (`/chat`, `/ask`, `/apply` all use it).

---

## Project Structure

```
gpt_auth/
├── agent.js                    ← interactive REPL (command router)
├── package.json
├── README.md
├── src/
│   ├── config.js               ← file paths
│   ├── browser.js              ← shared Playwright/stealth helpers
│   ├── ai.js                   ← provider-agnostic session + sendMessage
│   ├── login.js                ← provider menu + session save
│   ├── chat.js                 ← chat loop
│   ├── providers/
│   │   ├── index.js            ← provider registry + waitForStable
│   │   ├── chatgpt.js          ← ChatGPT selectors
│   │   ├── grok.js             ← Grok selectors
│   │   ├── gemini.js           ← Gemini selectors
│   │   └── perplexity.js       ← Perplexity selectors
│   └── apply/
│       ├── index.js            ← apply loop
│       ├── research.js         ← company/role research step
│       ├── scraper.js          ← DOM scraper
│       ├── executor.js         ← action executor + signature drawer
│       └── prompt.js           ← prompt builder + JSON sanitizer
├── data/
│   ├── profile.example.json    ← template (safe to share)
│   └── profile.json            ← YOUR INFO (gitignored)
└── session/
    ├── active.json             ← which provider is active (gitignored)
    └── <provider>.json         ← saved sessions (gitignored)
```

---

## Private Files (gitignored — never pushed)

| File | Why |
|---|---|
| `session/*.json` | Your login cookies — treat like passwords |
| `data/profile.json` | Name, email, phone, salary — personal info |
| `data/resume.pdf` | Your actual resume |

---

## Troubleshooting

**"Login expired" right after logging in**
The provider's input selector may have drifted (their UI changed). Your session is probably fine — open the site, inspect the input box, and update the `readySelector` in `src/providers/<provider>.js`.

**`/chat` returns the wrong/previous answer**
Should be fixed — each provider waits for a *new* response element before reading. If it recurs, the response selector in `src/providers/<provider>.js` needs updating.

**"Cannot find module 'playwright'"**
```powershell
npm install
npx playwright install chromium
```

**Dropdown / field not filling in `/apply`**
The browser is visible — watch what happens. The agent auto-retries on bad JSON.

**Resume PDF not uploading**
Check `resumePdfPath` in `data/profile.json` is a real path with double backslashes: `"D:\\Docs\\resume.pdf"`.

---

## Adding a New Provider

1. Create `src/providers/<name>.js` exporting `config` (`key`, `name`, `url`, `readySelector`) and `sendMessage(page, text)`.
2. Register it in `src/providers/index.js` and add it to the `MENU` in `src/login.js`.

That's it — `/chat`, `/ask`, and `/apply` pick it up automatically.

---

## License

MIT
