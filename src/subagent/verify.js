import { buildObservation } from './perception.js';
import { sendMessage } from '../ai.js';
import { sanitizeGptJson } from '../apply/prompt.js';

export async function verifyGoal(page, task, aiPage, consoleBuffer = null) {
  console.log('  🔍 Verifying task outcome...');
  const obs = await buildObservation(page, consoleBuffer);

  const verifyPrompt = `You are a browser subagent checking if a TASK was completed successfully.
Original TASK: "${task}"

CURRENT BROWSER STATE:
URL: ${obs.url}
Title: ${obs.title}
Text Snippet: ${obs.pageText?.slice(0, 2000)}

Verify if the task has been successfully achieved. Consider the page text, inputs filled, url, and title.

Return your response in this exact JSON format:
{
  "passed": true,
  "reason": "Clear explanation of why it passed or failed",
  "evidence": "Concrete evidence seen on the page (e.g. success message text, URL path)"
}
Return ONLY the raw JSON object, no markdown, no explanation.`;

  try {
    const raw = await sendMessage(aiPage, verifyPrompt);
    const result = sanitizeGptJson(raw);
    return {
      passed: !!result.passed,
      reason: result.reason || 'No explanation provided.',
      evidence: result.evidence || 'N/A'
    };
  } catch (e) {
    console.error('  ⚠ Verification evaluation failed:', e.message);
    return {
      passed: false,
      reason: `Verification process failed with error: ${e.message}`,
      evidence: 'N/A'
    };
  }
}
