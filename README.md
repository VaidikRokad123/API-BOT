# AI Automation Agent

Automate **ChatGPT, Grok, Gemini, Perplexity, or DeepSeek** from the terminal — no API key, no cost. Uses your real logged-in account through a Playwright-controlled browser.

**What it can do:**
- **Login** — pick a provider and save your session once
- **Chat** — interactive terminal chat with memory across messages
- **Ask** — one-shot question, prints the answer, returns
- **Apply** — researches the company, then AI fills and submits job application forms automatically, **including handling complex multi-step OAuth logins (like Google Sign-In) and CAPTCHAs.**

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
- An account with at least one of: **ChatGPT**, **Grok**, **Gemini**, **Perplexity**, **DeepSeek** (free tiers work)

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
| `/model [provider]` | Choose or switch the active AI provider (accepts name, index, or prompts if blank) |
| `/chat` | Interactive chat with the active provider (type `exit` to return) |
| `/ask <question>` | One-shot question — prints the answer and returns to the menu |
| `/council <question>` | Ask **all** logged-in providers at once, then merge their answers |
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
    5)  DeepSeek      chat.deepseek.com

  Enter 1–5: 2
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

Fill in `data\profile.json` — this is what the agent uses to answer application questions and automatically log you into job portals.

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
| `resumeLastUpdated` | Date string (e.g. `"2026-06-19"`) indicating when the plain-text resume was updated |
| `resumePdfPath` | Absolute path to your resume PDF (double backslashes: `"D:\\Docs\\resume.pdf"`) |
| `resumePdfLastUpdated` | Date string indicating when the PDF resume was updated |
| `credentials.google` | Your Google username and password (used for automatic Google Sign-In during applications) |
| `credentials.default` | A fallback username and password for standard login forms |

> [!TIP]
> The agent validates that `resumeLastUpdated` and `resumePdfLastUpdated` match. If they differ, `/apply` prints a warning to remind you to update your plain-text `resume` content alongside your PDF!

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

You: exit

  Closing chat... returning to main menu.
>
```

All messages in one chat session share memory. Type `exit`, `quit`, or `/exit` to return to the main console.

---

## How `/council` works

Ask the same question to **every provider you're logged into**, then have one of them
merge all the answers into a single best response. A merged answer is more reliable
than any single model — and it's free.

- Uses **all** providers with a saved session automatically.
- Needs **at least 2** providers logged in.

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

### NEW: Advanced Application & Login Handling

The agent now includes **advanced automation** to handle the most difficult parts of modern job applications:

- **Popup & New Window OAuth:** Detects if a job application opens a "Sign in with Google" or similar popup. It synchronously pauses the main form, switches focus to the popup, and completes the login flow automatically.
- **Multi-Step Google Sign-In:** Automatically traverses multi-step Google login pages programmatically (Email → Password → Consent / "I agree" → Account Chooser).
- **Enforced Google Preference:** When faced with multiple login options (LinkedIn, Microsoft, Google), the AI is strictly instructed to use Google Login.
- **Smart CAPTCHA Pausing:** If a visible CAPTCHA, Cloudflare check, or Google 2FA verification challenge appears, the agent pauses execution, alerts you in the terminal with a beep, and waits for you to manually solve it in the browser window before pressing `ENTER` to resume.
- **Invisible Field Filtering:** Automatically detects and ignores "phantom" CAPTCHA tokens or visually hidden elements (e.g. `opacity: 0`, `display: none`, or off-screen) so the AI doesn't get confused and try to fill them.
- **Automatic JSON Safety Bypass:** Includes a robust quote sanitizer to prevent AI providers from breaking execution when generating complex CSS selectors.

### What it handles automatically:

| Field / Action | How it handles it |
|---|---|
| Text fields | Name, email, phone, experience, tailored open-ended answers |
| Dropdowns | Selects the correct option by text or fallback DOM injection |
| Checkboxes | Checks "I agree / accept terms" boxes |
| File upload | Uploads your resume PDF |
| Signature pad | Draws a cursive signature on canvas |
| Multi-page forms | Clicks Next and continues |
| Salary questions | Quotes a market-appropriate figure |
| **OAuth Logins** | Clicks "Sign in with Google" and handles popup authorization windows |
| **CAPTCHAs** | Pauses and asks the user to intervene |

Run with `--hidden` to minimize the form browser.

---

## How It Works (under the hood)

```
node agent.js  →  interactive REPL (slash commands)

/apply   → Browser 1 (hidden, the AI) + Browser 2 (visible, the form)
             research the company once, then loop:
               scrape form (filter invisible fields) → AI returns JSON actions → execute → repeat → submit
```

**Why not use an official API?** This drives your **existing logged-in account** through a real browser. No API key, no cost, no extra rate limits beyond normal usage.

---

## Troubleshooting

**"Login expired" right after logging in**
The provider's input selector may have drifted (their UI changed). Your session is probably fine — open the site, inspect the input box, and update the `readySelector` in `src/providers/<provider>.js`.

**Agent gets stuck on a CAPTCHA**
Check your terminal! The agent will detect CAPTCHAs and ask you to press `ENTER` once you have manually solved the challenge in the visible browser window.

**Resume PDF not uploading**
Check `resumePdfPath` in `data/profile.json` is a real path with double backslashes: `"D:\\Docs\\resume.pdf"`.

---

## License

MIT
