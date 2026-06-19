import { openAiSession, sendMessage } from './ai.js';

export async function chat(visible = true) {
  let browser, page;
  try {
    ({ browser, page } = await openAiSession(visible));
  } catch (e) {
    console.error('✗', e.message); process.exit(1);
  }

  const readline = (await import('readline')).default;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('╔════════════════════════════════════════╗');
  console.log('║      ChatGPT Interactive Console       ║');
  console.log('║  All messages share memory this session║');
  console.log('║  Type "exit" or Ctrl+C to quit         ║');
  console.log('╚════════════════════════════════════════╝\n');

  const ask = () => {
    rl.question('You: ', async input => {
      const prompt = input.trim();
      if (!prompt) { ask(); return; }

      if (prompt.toLowerCase() === 'exit') {
        console.log('\nClosing... Goodbye!');
        await browser.close(); rl.close(); process.exit(0);
      }

      try {
        process.stdout.write('GPT: thinking...\r');
        const response = await sendMessage(page, prompt);
        process.stdout.write('\x1B[2K\r');
        console.log('GPT: ' + response);
        console.log('─'.repeat(60) + '\n');
      } catch (e) {
        console.error('\n[Error]', e.message, '\n');
      }
      ask();
    });
  };

  ask();
  rl.on('close', async () => { await browser.close(); process.exit(0); });
}
