import { openAiSession, sendMessage } from './ai.js';

// externalRl — passed from the main REPL so we share the same stdin.
// When null, chat owns the readline and exits the process on quit.
export async function chat(visible = true, externalRl = null) {
  let browser, page, providerName;
  try {
    ({ browser, page, providerName } = await openAiSession(visible));
  } catch (e) {
    console.error('\n  ✗', e.message, '\n');
    if (!externalRl) process.exit(1);
    return;
  }

  const readline = (await import('readline')).default;
  const rl    = externalRl ?? readline.createInterface({ input: process.stdin, output: process.stdout });
  const ownRl = !externalRl;

  const label = providerName.padEnd(10);
  console.log('\n  ╔══════════════════════════════════════════╗');
  console.log(`  ║  ${label} Chat                          ║`);
  console.log('  ║  All messages share memory this session  ║');
  console.log('  ║  Type "exit" to return to main menu      ║');
  console.log('  ╚══════════════════════════════════════════╝\n');

  const QUIT = new Set(['exit', 'quit', '/exit', '/quit']);

  await new Promise((resolve) => {
    const ask = () => {
      rl.question('You: ', async (input) => {
        const text = input.trim();
        if (!text) { ask(); return; }

        if (QUIT.has(text.toLowerCase())) {
          console.log('\n  Closing chat... returning to main menu.\n');
          await browser.close().catch(() => {});
          resolve();
          return;
        }

        try {
          process.stdout.write(`${providerName}: thinking...\r`);
          const response = await sendMessage(page, text);
          process.stdout.write('\x1B[2K\r');
          console.log(`${providerName}: ${response}`);
          console.log('─'.repeat(60) + '\n');
        } catch (e) {
          process.stdout.write('\x1B[2K\r');
          // If the browser/page was closed, bail to the menu instead of looping errors.
          if (!browser.isConnected() || /closed/i.test(e.message)) {
            console.error('\n  Browser was closed — returning to main menu.\n');
            await browser.close().catch(() => {});
            resolve();
            return;
          }
          console.error('\n  [Error]', e.message, '\n');
        }
        ask();
      });
    };
    ask();
  });

  if (ownRl) { rl.close(); process.exit(0); }
}
