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
node agent.js                    # start interactive REPL
```

Inside the REPL: `/login` `/chat` `/apply <url>` `/apply <url> --real[=chrome|brave|opera]` `/ask <q>` `/browser` `/status` `/help` `/exit`

Create `data/profile.json` from `data/profile.example.json` before using `/apply`.

There are no tests or linter configured.

## Architecture

**Entry point:** `agent.js` — interactive REPL. Shows a banner, reads slash commands (`/login`, `/chat`, `/ask`, `/council`, `/apply`, `/status`, `/help`, `/exit`), dispatches to `src/` handlers. Adding a new command = one new entry in the `COMMANDS` object.

**`src/` module map:**

| File | Responsibility |
|---|---|
| `src/config.js` | Path constants: `PROFILE_FILE`, `ACTIVE_FILE`, `sessionFile(key)` |
| `src/browser.js` | `launchBrowser()`, `newStealthContext()`, stealth args/script/user-agent |
| `src/ai.js` | `openAiSession()` — reads active provider from `session/active.json`, loads session, navigates to provider URL; `sendMessage()` — delegates to active provider's sendMessage |
| `src/login.js` | Terminal menu to pick provider, opens browser, waits for user to log in, saves `session/{provider}.json` + `session/active.json` |
| `src/chat.js` | Interactive chat loop; accepts optional `externalRl` to share the REPL's readline instance (returns to REPL on exit instead of killing the process) |
| `src/council.js` | `/council` — opens every logged-in provider concurrently (bypasses ai.js singleton via `getProvider(key).sendMessage`), fans out one prompt, user picks a provider to merge answers |
| `src/providers/index.js` | `PROVIDERS` map, `getProvider(key)`, shared `waitForStable()` polling helper |
| `src/providers/chatgpt.js` | ChatGPT-specific selectors and `sendMessage` |
| `src/providers/grok.js` | Grok — ProseMirror input (`.ProseMirror`), `keyboard.type()`, `[data-testid="assistant-message"]` |
| `src/providers/gemini.js` | Gemini — contenteditable input with fill→type fallback |
| `src/providers/perplexity.js` | Perplexity — textarea/contenteditable input, `.prose` response |
| `src/providers/deepseek.js` | DeepSeek — `textarea#chat-input`, `.ds-markdown` response |
| `src/apply/index.js` | Apply loop — research phase then up to 20 scrape→AI→execute steps |
| `src/apply/research.js` | `researchJob()` — asks AI to extract company info, salary, matching skills before form filling |
| `src/apply/scraper.js` | `scrapePageState()` — DOM snapshot of all inputs, selects, canvases, buttons |
| `src/apply/executor.js` | `executeAction()` dispatches fill/select/click/check/upload/signature; `drawSignature()` draws cursive on canvas |
| `src/apply/prompt.js` | `buildAgentPrompt()` with research context injection; `sanitizeGptJson()` char-by-char JSON sanitizer |

**Provider session files:**
- `session/active.json` — `{ "provider": "grok" }` — which provider is active
- `session/session.json` — ChatGPT (legacy name kept for backward compat)
- `session/grok.json`, `session/gemini.json`, `session/perplexity.json`, `session/deepseek.json` — other providers

**Data flow for `/apply`:**
```
agent.js REPL → apply/index.js
  ├─ openAiSession()         → hidden Browser 1 (active AI provider)
  ├─ launchBrowser(visible)  → visible Browser 2 (job form)
  ├─ researchJob()           → AI researches company, salary, matching skills (once)
  └─ loop (up to 20 steps):
       scrapePageState()     → structured DOM snapshot
       buildAgentPrompt()    → profile + research + page state
       sendMessage()         → AI returns JSON actions
       sanitizeGptJson()     → safe parse
       executeAction()       → mutates Browser 2
       autoHandleSpecials()  → catches missed file/checkbox fields
```

## Key constraints

- **ESM only** — `"type": "module"` in package.json. Use `import/export`, never `require()`.
- **No API key** — AI providers are automated via browser session, not APIs. Session auth lives in `session/*.json`.
- **Provider selectors may drift** — each `src/providers/*.js` file has DOM selectors that may need updating if a provider redesigns their UI. Comments in each file note what to inspect.
- **`__dirname` workaround** — ESM has no `__dirname`. Every file that needs paths uses `fileURLToPath(import.meta.url)`. `src/config.js` exports canonical paths; all other files import from there.
