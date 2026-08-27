import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sessionDir = path.join(__dirname, 'session');

const files = {
  SESSION_CHATGPT_BASE64: 'session.json',
  SESSION_GEMINI_BASE64: 'gemini.json',
  SESSION_GROK_BASE64: 'grok.json',
  SESSION_PERPLEXITY_BASE64: 'perplexity.json',
  SESSION_DEEPSEEK_BASE64: 'deepseek.json'
};

console.log('\n================================================================');
console.log('  EXPORTED BASE64 SESSION ENVIRONMENT VARIABLES FOR RENDER/DOCKER');
console.log('================================================================\n');

let count = 0;
for (const [envVar, file] of Object.entries(files)) {
  const filePath = path.join(sessionDir, file);
  if (fs.existsSync(filePath)) {
    const b64 = fs.readFileSync(filePath).toString('base64');
    console.log(`--- ${envVar} ---`);
    console.log(b64);
    console.log('\n');
    count++;
  }
}

if (count === 0) {
  console.log('No session files found in backend/session/. Run `npm run agent` to log into providers first.\n');
} else {
  console.log(`Successfully generated ${count} session Base64 string(s).`);
  console.log('Copy the Base64 value for each provider and paste it into Render Environment Variables.\n');
}
