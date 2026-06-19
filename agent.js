import { login }          from './src/login.js';
import { chat }           from './src/chat.js';
import { apply }          from './src/apply/index.js';
import { openGptSession, sendMessage } from './src/gpt.js';

const mode    = process.argv[2];
const arg     = process.argv[3];
const visible = process.argv.includes('--visible');

const HELP = `
╔══════════════════════════════════════════════════════════════╗
║              GPT Automation Agent — Commands                 ║
╠══════════════════════════════════════════════════════════════╣
║  node agent.js login                    Save ChatGPT session ║
║  node agent.js chat                     Interactive chat      ║
║  node agent.js chat --visible           Chat (show browser)  ║
║  node agent.js ask "question"           One-shot question     ║
║  node agent.js apply "url"              Apply for a job       ║
║  node agent.js apply "url" --visible    Apply (show browser)  ║
╚══════════════════════════════════════════════════════════════╝
`;

switch (mode) {
  case 'login':
    login();
    break;

  case 'chat':
    chat(visible);
    break;

  case 'ask':
    if (!arg) { console.log('Usage: node agent.js ask "your question"'); process.exit(1); }
    (async () => {
      const { browser, page } = await openGptSession(visible);
      try {
        console.log(`Asking: "${arg}"\n`);
        const response = await sendMessage(page, arg);
        console.log('GPT: ' + response + '\n');
      } finally {
        await browser.close();
      }
    })();
    break;

  case 'apply':
    if (!arg) { console.log('Usage: node agent.js apply "https://company.com/apply/..."'); process.exit(1); }
    apply(arg, visible);
    break;

  default:
    console.log(HELP);
}
