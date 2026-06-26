export const FAILURE_REASONS = [
  'captcha',
  'session_expired',
  'already_applied',
  'sso_required',
  'form_incompatible',
  'element_not_found',
  'timeout',
  'cloudflare_block'
];

export const RETRYABLE_FAILURES = new Set(['element_not_found', 'timeout']);
export const PERMANENT_FAILURES = new Set(
  FAILURE_REASONS.filter(reason => !RETRYABLE_FAILURES.has(reason))
);

export function classifyFailure(input = '') {
  const text = String(input || '').toLowerCase();
  if (/captcha|recaptcha|hcaptcha|turnstile|verify you are human|not a robot/.test(text)) return 'captcha';
  if (/cloudflare|cf-challenge|checking your browser|attention required/.test(text)) return 'cloudflare_block';
  if (/session expired|sign in again|logged out|login expired|unauthorized/.test(text)) return 'session_expired';
  if (/already applied|application already|previously applied|duplicate application/.test(text)) return 'already_applied';
  if (/single sign-on|sso|saml|oauth|microsoft login|google login required/.test(text)) return 'sso_required';
  if (/not found|no element|element.*missing|selector/.test(text)) return 'element_not_found';
  if (/timeout|timed out|navigation timeout/.test(text)) return 'timeout';
  return 'form_incompatible';
}

export function verdictWithFailureReason(verdict = {}) {
  if (verdict.passed) {
    return { ...verdict, verdict: 'success', failure_reason: null };
  }
  const reason = classifyFailure(`${verdict.reason || ''}\n${verdict.evidence || ''}`);
  return { ...verdict, verdict: 'failure', failure_reason: reason };
}
