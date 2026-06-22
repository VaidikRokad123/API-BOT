import { buildObservation } from './perception.js';
import { sendMessage } from '../ai.js';
import { sanitizeGptJson } from '../apply/prompt.js';

export async function verifyGoal(page, task, aiPage, consoleBuffer = null, agentReport = '') {
  console.log('  🔍 Verifying task outcome...');
  const obs = await buildObservation(page, consoleBuffer);

  const reportBlock = agentReport
    ? `\nSUBAGENT'S PRODUCED ANSWER / REPORT:\n${String(agentReport).slice(0, 4000)}\n`
    : '';

  const verifyPrompt = `You are a browser subagent checking if a TASK was completed successfully.
Original TASK: "${task}"

CURRENT BROWSER STATE:
URL: ${obs.url}
Title: ${obs.title}
Text Snippet: ${obs.pageText?.slice(0, 3000)}
${reportBlock}
Verify if the task has been achieved.
- For ACTION tasks (submit/login/navigate): judge by the page state (url, title, success text).
- For EXTRACTION / LIST / SUMMARY / REPORT tasks: the deliverable is the SUBAGENT'S PRODUCED ANSWER above. If it contains the requested information and is consistent with the page Text, mark passed=true — do NOT require a success banner on the page. Only fail if the answer is missing, empty, or clearly fabricated/contradicted by the page.

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
