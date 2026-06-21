import fs from 'fs';
import readline from 'readline';
import { ACTIVE_FILE, sessionFile } from './src/config.js';
import { readBrowserPref, getEngineList, saveBrowserPref } from './src/browser.js';

// ─── Status helpers ────────────────────────────────────────────────────────

function getStatus() {
  try {
    const { provider } = JSON.parse(fs.readFileSync(ACTIVE_FILE, 'utf8'));
    return { provider, hasSession: fs.existsSync(sessionFile(provider)) };
  } catch {
    return { provider: null, hasSession: false };
  }
}

function providerLabel(key) {
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : null;
}

// ─── UI helpers ────────────────────────────────────────────────────────────

function printBanner() {
  const { provider, hasSession } = getStatus();
  const name = providerLabel(provider);

  console.clear();
  console.log('\n  ╔══════════════════════════════════════════════════════╗');
  console.log('  ║                                                      ║');
  console.log('  ║    AI Agent                                  v1.0    ║');
  console.log('  ║    Chat · Job Apply · Browser Automation             ║');
  console.log('  ║                                                      ║');
  console.log('  ╚══════════════════════════════════════════════════════╝\n');

  if (name && hasSession) {
    console.log(`  Provider  :  ${name}  ✓  (session active)`);
  } else if (name && !hasSession) {
    console.log(`  Provider  :  ${name}  ✗  session missing — run /login`);
  } else {
    console.log('  Provider  :  none — run /login to get started');
  }

  const browserPref = readBrowserPref();
  const browserName = getEngineList().find(e => e.key === browserPref)?.name || browserPref;
  console.log(`  Browser   :  ${browserName}`);

  console.log('\n  Type /help for all commands.\n');
}

function printHelp() {
  console.log('\n  Commands:\n');
  const maxLen = Math.max(...Object.values(COMMANDS).map(c => c.usage.length));
  for (const cmd of Object.values(COMMANDS)) {
    console.log(`    ${cmd.usage.padEnd(maxLen + 2)}  ${cmd.desc}`);
  }
  console.log();
}

function printStatus() {
  const { provider, hasSession } = getStatus();
  const name = providerLabel(provider);
  if (!name) {
    console.log('\n  No provider set — run /login to choose one.\n');
    return;
  }
  console.log(`\n  Provider : ${name}`);
  console.log(`  Session  : ${hasSession ? '✓  active' : '✗  missing — run /login'}\n`);
}

// ─── Command registry ──────────────────────────────────────────────────────
// To add a new command: add an entry here. handler(args, rl) is called with
// the remaining text after the command name, and the outer readline instance.

const COMMANDS = {
  '/login': {
    usage:   '/login',
    desc:    'Choose an AI provider and save your session',
    handler: async (args, rl) => {
      const { login } = await import('./src/login.js');
      await login(rl);
    },
  },

  '/model': {
    usage:   '/model [provider]',
    desc:    'Choose or switch the active AI provider',
    handler: async (args, rl) => {
      const { selectModel } = await import('./src/login.js');
      await selectModel(rl, args);
    },
  },

  '/chat': {
    usage:   '/chat',
    desc:    'Start an interactive chat with the active provider',
    handler: async (args, rl) => {
      const { chat } = await import('./src/chat.js');
      await chat(true, rl);
    },
  },

  '/ask': {
    usage:   '/ask <question>',
    desc:    'One-shot question — prints the answer and returns',
    handler: async (args) => {
      if (!args) { console.log('\n  Usage: /ask <your question>\n'); return; }
      const { openAiSession, sendMessage } = await import('./src/ai.js');
      const { browser, page, providerName } = await openAiSession(false);
      try {
        process.stdout.write(`\n  ${providerName}: thinking...\r`);
        const response = await sendMessage(page, args);
        process.stdout.write('\x1B[2K\r');
        console.log(`\n  ${providerName}: ${response}\n`);
      } finally {
        await browser.close();
      }
    },
  },

  '/apply': {
    usage:   '/apply <url> [--hidden]',
    desc:    'AI-driven job application form filler (interactive configuration)',
    handler: async (args, rl) => {
      let url = args.replace('--hidden', '').trim();
      
      // Strip surrounding quotes if present
      if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) {
        url = url.slice(1, -1).trim();
      }

      if (!url) { console.log('\n  Usage: /apply <job-url> [--hidden]\n'); return; }

      // 1. Choose AI Browser (Brain) — always the controllable Playwright engine.
      console.log('\n  Select browser engine for AI (Brain):');
      const aiEngines = [
        { key: 'playwright', name: 'Playwright (ariaSnapshot)' },
      ];
      aiEngines.forEach((e, i) => console.log(`    ${i + 1})  ${e.name}`));
      console.log();
      const aiAns = (await new Promise(resolve => rl.question(`  Enter 1–${aiEngines.length} [default: 1]: `, resolve))).trim();
      const aiIdx = parseInt(aiAns, 10) - 1;
      const aiEngine = (aiIdx >= 0 && aiIdx < aiEngines.length) ? aiEngines[aiIdx].key : 'playwright';

      // 2. Choose Job App Browser (Hands)
      console.log('\n  Select browser engine for Job Application (Hands):');
      const appEngines = [
        { key: 'real-chrome', name: 'Real Chrome (connect over CDP)' },
        { key: 'real-brave', name: 'Real Brave (connect over CDP)' },
        { key: 'real-opera', name: 'Real Opera (connect over CDP)' },
        { key: 'playwright', name: 'Playwright' },
      ];
      appEngines.forEach((e, i) => console.log(`    ${i + 1})  ${e.name}`));
      console.log();
      const appAns = (await new Promise(resolve => rl.question(`  Enter 1–${appEngines.length} [default: 1]: `, resolve))).trim();
      const appIdx = parseInt(appAns, 10) - 1;
      const appEngine = (appIdx >= 0 && appIdx < appEngines.length) ? appEngines[appIdx].key : 'real-chrome';

      // 3. Ask if they want to research
      const researchAns = (await new Promise(resolve => rl.question('\n  Do you want to conduct company/job research? (y/n) [default: y]: ', resolve))).trim().toLowerCase();
      const doResearch = !researchAns.startsWith('n');

      const hidden = args.includes('--hidden');
      const { apply } = await import('./src/apply/index.js');
      await apply(url, !hidden, {
        aiEngine,
        browserEngine: appEngine,
        doResearch
      });
    },
  },

  '/council': {
    usage:   '/council <question>',
    desc:    'Ask all logged-in providers at once, then merge their answers',
    handler: async (args, rl) => {
      const { council } = await import('./src/council.js');
      await council(args, rl, true);
    },
  },

  '/browser': {
    usage:   '/browser [engine | <task> [--hidden] [--engine=...] [--provider=...]]',
    desc:    'Switch browser engine, or run a natural language task via the subagent',
    handler: async (args, rl) => {
      const engines = getEngineList();
      const current = readBrowserPref();

      // Check if it's a simple browser selection/switch command
      if (args && !args.includes(' ') && engines.some(e => e.key === args.toLowerCase().trim())) {
        const key = args.toLowerCase().trim();
        const match = engines.find(e => e.key === key);
        saveBrowserPref(key);
        console.log(`\n  ✓ Browser set to ${match.name}\n`);
        return;
      }

      // If there are args, treat it as a subagent task!
      if (args) {
        let task = args;
        const hidden = task.includes('--hidden');
        task = task.replace('--hidden', '').trim();

        // Extract optional --engine override
        let engine = current;
        const engineMatch = task.match(/--engine=(\S+)/);
        if (engineMatch) {
          engine = engineMatch[1];
          task = task.replace(engineMatch[0], '').trim();
        }

        // Extract optional --provider override (AI provider)
        let aiEngine = 'playwright';
        const aiMatch = task.match(/--provider=(\S+)/);
        if (aiMatch) {
          aiEngine = aiMatch[1];
          task = task.replace(aiMatch[0], '').trim();
        }

        const { runBrowserSubagent } = await import('./src/subagent/index.js');
        await runBrowserSubagent(task, {
          engine,
          aiEngine,
          hidden
        });
        return;
      }

      // Interactive selection (default fallback when no args)
      console.log('\n  Select a browser:\n');
      engines.forEach((e, i) => {
        const marker = e.key === current ? ' ← active' : '';
        console.log(`    ${i + 1})  ${e.name}${marker}`);
      });
      console.log();

      const answer = await new Promise(resolve => rl.question(`  Enter 1–${engines.length}: `, resolve));
      const idx = parseInt(answer, 10) - 1;
      if (idx < 0 || idx >= engines.length) {
        console.log('\n  Cancelled.\n');
        return;
      }
      saveBrowserPref(engines[idx].key);
      console.log(`\n  ✓ Browser set to ${engines[idx].name}\n`);
    },
  },

  '/status': {
    usage:   '/status',
    desc:    'Show the active provider and session state',
    handler: async () => printStatus(),
  },

  '/help': {
    usage:   '/help',
    desc:    'List all available commands',
    handler: async () => printHelp(),
  },

  '/exit': {
    usage:   '/exit',
    desc:    'Quit the program',
    handler: async () => {
      console.log('\n  Goodbye!\n');
      process.exit(0);
    },
  },
};

// ─── Main REPL loop ────────────────────────────────────────────────────────

async function main() {
  printBanner();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const prompt = () => {
    rl.question('> ', async (raw) => {
      const trimmed = raw.trim();
      if (!trimmed) { prompt(); return; }

      const space = trimmed.indexOf(' ');
      const cmd  = (space === -1 ? trimmed : trimmed.slice(0, space)).toLowerCase();
      const args =  space === -1 ? ''      : trimmed.slice(space + 1).trim();

      const command = COMMANDS[cmd];
      if (!command) {
        console.log(`\n  Unknown command "${cmd}". Type /help for all commands.\n`);
        prompt(); return;
      }

      try {
        await command.handler(args, rl);
      } catch (e) {
        console.error(`\n  Error: ${e.message}\n`);
      }

      prompt();
    });
  };

  prompt();
  rl.on('close', () => { console.log('\n  Goodbye!\n'); process.exit(0); });
}

main();
