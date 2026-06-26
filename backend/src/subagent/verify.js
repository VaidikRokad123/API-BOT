import { buildObservation } from './perception.js';
import { sendMessage } from '../ai.js';
import { isSubmissionConfirmed } from '../apply/completion.js';
import { sanitizeGptJson } from './ai-json.js';

export async function verifyGoal(page, task, aiPage, consoleBuffer = null, agentReport = '', options = {}) {
  const obs = await buildObservation(page, consoleBuffer);

  if (options.isApply && isSubmissionConfirmed(obs)) {
    return {
      passed: true,
      reason: 'Structural submission confirmation (page text or confirmation URL)',
      evidence: `${obs.url} | ${obs.pageText?.slice(0, 200)}`
    };
  }

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
- For EXTRACTION / LIST / SUMMARY / REPORT tasks: the deliverable is the SUBAGENT'S PRODUCED ANSWER above.

Return ONLY this JSON:
{"passed":true,"reason":"Clear explanation","evidence":"Concrete evidence"}`;

  try {
    let raw = await sendMessage(aiPage, verifyPrompt);
    let result;
    try {
      result = sanitizeGptJson(raw);
    } catch (parseErr) {
      raw = await sendMessage(
        aiPage,
        `Invalid JSON: ${parseErr.message}. Return ONLY {"passed":boolean,"reason":"...","evidence":"..."}`
      );
      result = sanitizeGptJson(raw);
    }
    return {
      passed: !!result.passed,
      reason: result.reason || 'No explanation provided.',
      evidence: result.evidence || 'N/A'
    };
  } catch (e) {
    return {
      passed: false,
      reason: `Verification process failed with error: ${e.message}`,
      evidence: 'N/A'
    };
  }
}
