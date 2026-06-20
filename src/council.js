import fs from 'fs';
import { launchBrowser, newStealthContext } from './browser.js';
import { sessionFile } from './config.js';
import { PROVIDERS, getProvider } from './providers/index.js';

const question = (rl, q) => new Promise((resolve) => rl.question(q, resolve));

// Providers that have a saved session on disk.
function loggedInProviders() {
  return Object.keys(PROVIDERS).filter((key) => fs.existsSync(sessionFile(key)));
}

// Purpose-built opener — deliberately does NOT touch ai.js's _providerKey singleton,
// so several providers can run concurrently. Returns a `send` closure bound to its page.
async function openProvider(key, visible) {
  const provider = getProvider(key);
  const browser  = await launchBrowser(visible, key);
  const ctx      = await newStealthContext(browser, sessionFile(key));
  const page     = await ctx.newPage();

  await page.goto(provider.config.url);
  await page.waitForSelector(provider.config.readySelector, { timeout: 20000 });

  return {
    key,
    name:    provider.config.name,
    browser,
    page,
    send:    (text) => provider.sendMessage(page, text),
  };
}

function buildMergePrompt(questionText, answers) {
  const blocks = answers
    .map((a, i) => `### Answer ${i + 1} — ${a.name}\n${a.text}`)
    .join('\n\n');

  return `Several AI assistants answered the same question. Merge them into ONE best answer: combine their strengths, resolve any disagreements, and drop anything wrong or redundant. Be concise and correct. Do not mention the individual assistants.

QUESTION:
${questionText}

${blocks}

Return only the merged answer.`;
}

const RULE = '─'.repeat(60);
const DRULE = '═'.repeat(60);

export async function council(questionText, rl, visible = true) {
  if (!questionText) { console.log('\n  Usage: /council <question>\n'); return; }
  if (!rl)           { console.log('\n  /council must be run from the console.\n'); return; }

  const keys = loggedInProviders();
  if (keys.length < 2) {
    console.log(`\n  Council needs at least 2 logged-in providers (found ${keys.length}). Run /login for more.\n`);
    return;
  }

  console.log(`\n  Convening council: ${keys.map((k) => getProvider(k).config.name).join(', ')}\n`);

  // Open all providers in parallel; drop any that fail (e.g. expired session).
  const opened   = await Promise.allSettled(keys.map((k) => openProvider(k, visible)));
  const sessions = [];
  opened.forEach((r, i) => {
    if (r.status === 'fulfilled') sessions.push(r.value);
    else console.log(`  ✗ ${getProvider(keys[i]).config.name}: failed to open (session expired?) — skipping`);
  });

  if (sessions.length < 2) {
    console.log('\n  Fewer than 2 providers available — aborting.\n');
    await Promise.allSettled(sessions.map((s) => s.browser.close().catch(() => {})));
    return;
  }

  try {
    // Fan out the question to all providers at once; print each as it lands.
    console.log('  Asking all providers (this runs in parallel)...\n');
    const answers = [];
    await Promise.allSettled(sessions.map((s) =>
      s.send(questionText).then(
        (text) => {
          answers.push({ key: s.key, name: s.name, text });
          console.log(`\n${RULE}\n  ${s.name}\n${RULE}\n${text}\n`);
        },
        (err) => {
          console.log(`\n  ✗ ${s.name}: ${err?.message || 'failed'}\n`);
        },
      ),
    ));

    if (answers.length < 2) {
      console.log('\n  Fewer than 2 answers came back — nothing to merge.\n');
      return;
    }

    // User chooses which provider merges the answers.
    console.log(RULE);
    answers.forEach((a, i) => console.log(`    ${i + 1}) ${a.name}`));
    const pick = (await question(rl, '\n  Which provider should merge all answers? (number, blank to skip): ')).trim();
    const merger = answers[parseInt(pick, 10) - 1];

    if (!merger) { console.log('\n  Skipped merge.\n'); return; }

    const session = sessions.find((s) => s.key === merger.key);
    console.log(`\n  ${merger.name} is merging...\n`);
    try {
      const consensus = await session.send(buildMergePrompt(questionText, answers));
      console.log(`${DRULE}\n  CONSENSUS  (merged by ${merger.name})\n${DRULE}\n${consensus}\n`);
    } catch (e) {
      console.log(`  ✗ Merge failed: ${e.message}\n`);
    }
  } finally {
    await Promise.allSettled(sessions.map((s) => s.browser.close().catch(() => {})));
    console.log('  Council closed.\n');
  }
}
