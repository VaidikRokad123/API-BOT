import fs from 'fs';
import { PROFILE_FILE } from '../config.js';
import { runBrowserSubagent } from '../subagent/index.js';
import { findSuccessfulApplication, recordApplicationVerdict } from './ledger.js';
import { RETRYABLE_FAILURES } from './failure-taxonomy.js';
import { createRunLogger } from '../subagent/logger.js';

async function runWithRetry(fn, logger) {
  let pRetry = null;
  try {
    pRetry = (await import('p-retry')).default;
  } catch {
    pRetry = null;
  }

  const attempt = async () => {
    const result = await fn();
    const failure = result?.verdict?.failure_reason;
    if (!result?.verdict?.passed && RETRYABLE_FAILURES.has(failure)) {
      const err = new Error(`Retryable apply failure: ${failure}`);
      err.result = result;
      throw err;
    }
    return result;
  };

  if (!pRetry) {
    let last;
    for (let i = 0; i < 3; i++) {
      try {
        return await attempt();
      } catch (err) {
        last = err;
        logger?.warn?.({ attempt: i + 1, err: err.message }, 'apply_retry');
        await new Promise(resolve => setTimeout(resolve, 500 * 2 ** i));
      }
    }
    return last?.result || Promise.reject(last);
  }

  try {
    return await pRetry(attempt, {
      retries: 2,
      factor: 2,
      minTimeout: 500,
      onFailedAttempt: err => logger?.warn?.({
        attempt: err.attemptNumber,
        retriesLeft: err.retriesLeft,
        err: err.message
      }, 'apply_retry')
    });
  } catch (err) {
    if (err.result) return err.result;
    throw err;
  }
}

export async function apply(jobUrl, visible = true, options = {}) {
  const logger = await createRunLogger('apply-preflight', 'preflight');

  if (!fs.existsSync(PROFILE_FILE)) {
    logger.error({ profileFile: PROFILE_FILE }, 'profile_missing');
    process.stderr.write(`Profile not found: ${PROFILE_FILE}\nCopy data/profile.example.json to data/profile.json and fill in your details.\n`);
    process.exit(1);
  }

  const existing = await findSuccessfulApplication({ url: jobUrl }).catch(err => {
    logger.warn({ err: err.message }, 'ledger_preflight_failed');
    return null;
  });
  if (existing) {
    const msg = `Skipping /apply: ${jobUrl} was already marked successful in run ${existing.run_id}.`;
    logger.info({ url: jobUrl, run_id: existing.run_id }, 'ledger_skip_success');
    process.stdout.write(`${msg}\n`);
    return {
      skipped: true,
      verdict: { passed: true, verdict: 'success', reason: msg, failure_reason: null },
      runId: existing.run_id
    };
  }

  const profile = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8'));
  if (profile.resumeLastUpdated && profile.resumePdfLastUpdated && profile.resumeLastUpdated !== profile.resumePdfLastUpdated) {
    logger.warn({
      resumeLastUpdated: profile.resumeLastUpdated,
      resumePdfLastUpdated: profile.resumePdfLastUpdated
    }, 'resume_version_mismatch');
  }

  logger.info({
    url: jobUrl,
    candidate: profile.email,
    resumePdfPath: profile.resumePdfPath || null
  }, 'apply_start');

  const task = `Apply for the job at ${jobUrl} by filling out all required forms and submitting the application using the candidate profile. Ensure you click Next/Continue through all pages and submit the final form.`;

  const result = await runWithRetry(() => runBrowserSubagent(task, {
    engine: options.browserEngine || 'real-chrome',
    aiEngine: options.aiEngine || 'playwright',
    hidden: !visible,
    isApply: true,
    jobUrl,
    doResearch: options.doResearch !== false,
    maxSteps: 40
  }), logger);

  const company = result?.research?.companyName || null;
  const role = result?.research?.jobTitle || null;
  await recordApplicationVerdict({
    url: jobUrl,
    company,
    role,
    verdict: result?.verdict?.verdict || (result?.verdict?.passed ? 'success' : 'failure'),
    failure_reason: result?.verdict?.failure_reason || null,
    run_id: result?.runId
  }).catch(err => logger.warn({ err: err.message }, 'ledger_record_failed'));

  if (!result?.verdict?.passed && result?.verdict?.failure_reason) {
    logger.warn({
      failure_reason: result.verdict.failure_reason,
      reason: result.verdict.reason
    }, 'apply_escalate_failure');
    process.stdout.write(`Apply stopped: ${result.verdict.failure_reason}. ${result.verdict.reason || ''}\n`);
  }

  return result;
}

export { apply as startApplyFlow };

