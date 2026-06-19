# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Skills to strictly follow

Always invoke these two skills at the start of every session:

- **`karpathy-guidelines`** — follow before writing or modifying any code
- **`caveman`** — use for all responses (compressed, token-efficient communication)

## Commands

```powershell
npm install                      # install dependencies
npx playwright install chromium  # download browser binary (one-time)

node agent.js login              # save ChatGPT session to session/session.json
node agent.js chat               # interactive terminal chat
node agent.js ask "question"     # one-shot question, prints answer and exits
node agent.js apply "URL"        # AI-driven job application form filler
node agent.js apply "URL" --hidden  # same but browser minimized
```

There are no tests or linter configured.

## Architecture

**Entry point:** `agent.js` — pure CLI router. Parses `process.argv`, switches on the command, delegates to `src/`. No logic lives here.

**`src/` module map:**

| File | Responsibility |
|---|---|
| `src/config.js` | `SESSION_FILE` and `PROFILE_FILE` path constants |
| `src/browser.js` | `launchBrowser()`, `newStealthContext()`, stealth args/script/user-agent |
| `src/gpt.js` | `openGptSession()` — loads session.json into Playwright context, navigates to chatgpt.com; `sendMessage()` — types into `#prompt-textarea`, polls `.markdown` DOM until stable |
| `src/login.js` | Opens visible Chrome, waits for user to log in manually, calls `ctx.storageState()` to save cookies |
| `src/chat.js` | readline loop over `sendMessage()` |
| `src/apply/index.js` | Main apply loop — up to 20 steps, each: scrape → GPT → execute → repeat |
| `src/apply/scraper.js` | `scrapePageState()` — runs `page.evaluate()` to extract all inputs, selects, checkboxes, canvases, buttons from the DOM |
| `src/apply/executor.js` | `executeAction()` dispatches fill/select/click/check/upload/signature; `drawSignature()` simulates cursive mouse path on canvas; `autoHandleSpecials()` catches file inputs and consent checkboxes GPT may miss |
| `src/apply/prompt.js` | `buildAgentPrompt()` — constructs the GPT prompt with profile + page state; `sanitizeGptJson()` — manual char-by-char parser that escapes control chars inside JSON strings before `JSON.parse` |

**Data flow for `apply`:**
```
agent.js → apply/index.js
  ├─ openGptSession()        → hidden Browser 1 (ChatGPT)
  ├─ launchBrowser(visible)  → visible Browser 2 (job form)
  └─ loop:
       scrapePageState()     → structured DOM snapshot
       sendMessage(prompt)   → GPT returns JSON actions
       sanitizeGptJson()     → safe parse
       executeAction()       → mutates Browser 2
       autoHandleSpecials()  → catches missed file/checkbox fields
```

**Why two browsers:** Browser 1 holds the authenticated ChatGPT tab. Browser 2 navigates the job application. They run concurrently — GPT is the brain, Browser 2 is the hands.

## Key constraints

- **ESM only** — `"type": "module"` in package.json. Use `import/export`, never `require()`.
- **No API key** — ChatGPT is automated via browser, not the OpenAI API. Session auth lives in `session/session.json`.
- **Browser is always visible by default** — `launchBrowser(visible = true)`. Pass `--hidden` flag to minimize. The GPT session browser is always hidden (hardcoded `false` in `apply/index.js`).
- **`session/session.json`** and **`data/profile.json`** are gitignored — never commit them. `data/profile.example.json` is the committed template.
- **`__dirname` workaround** — ESM has no `__dirname`. Every file that needs paths uses `fileURLToPath(import.meta.url)`. `src/config.js` exports the two canonical paths; all other files import from there.
