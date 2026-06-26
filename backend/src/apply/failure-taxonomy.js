/**
 * Failure taxonomy — ordered classification with disambiguation (Skyvern-style).
 * classifyFailure() returns primary category string (backward compat).
 * classifyFailureDetailed() returns ranked categories with confidence.
 */

export const FAILURE_REASONS = [
  'captcha',
  'cloudflare_block',
  'proxy_error',
  'browser_error',
  'navigation_failure',
  'session_expired',
  'auth_failure',
  'credential_error',
  'already_applied',
  'sso_required',
  'llm_error',
  'llm_reasoning_error',
  'parameter_binding_error',
  'data_extraction_failure',
  'element_not_found',
  'wrong_page_state',
  'timeout',
  'form_incompatible',
  'max_steps_exceeded',
  'infrastructure_error',
  'unknown'
];

export const RETRYABLE_FAILURES = new Set(['element_not_found', 'timeout']);
export const PERMANENT_FAILURES = new Set(
  FAILURE_REASONS.filter(reason => !RETRYABLE_FAILURES.has(reason))
);

const AUTH_CONTEXT = ['login', 'auth', 'password', 'permission', 'credential', 'sign in', 'sign-in'];

function hasAuthContext(text) {
  return AUTH_CONTEXT.some(kw => text.includes(kw));
}

function pushCategory(categories, category, confidence, reasoning) {
  categories.push({ category, confidence_float: confidence, reasoning });
}

/**
 * @param {string} input - failure text
 * @param {{ exceptionName?: string, source?: string }} [ctx]
 * @returns {Array<{ category: string, confidence_float: number, reasoning: string }>}
 */
export function classifyFailureDetailed(input = '', ctx = {}) {
  const text = String(input || '').toLowerCase();
  const excName = String(ctx.exceptionName || '');
  const categories = [];

  const antibotKeywords = [
    'captcha', 'recaptcha', 'hcaptcha', 'turnstile', 'cloudflare', 'cf-challenge',
    'checking your browser', 'attention required', 'bot detect', 'bot block',
    'anti-bot', 'human verification', 'verify you are human', 'not a robot'
  ];
  if (!hasAuthContext(text)) antibotKeywords.push('access denied');
  if (antibotKeywords.some(kw => text.includes(kw))) {
    const isCloudflare = /cloudflare|cf-challenge|checking your browser|attention required/.test(text);
    pushCategory(categories, isCloudflare ? 'cloudflare_block' : 'captcha', 0.85, 'Bot/challenge keywords');
  }

  // Proxy before browser — exception names may contain "Browser"
  const proxyExc = ['NoProxy', 'ProxyError'];
  const proxyReason = ['no proxy available', 'proxy unavailable', 'proxy pool'];
  if (proxyExc.some(kw => excName.includes(kw)) || proxyReason.some(kw => text.includes(kw))) {
    pushCategory(categories, 'proxy_error', 0.9, excName ? `Exception: ${excName}` : 'Proxy keywords');
  } else if (
    ['Browser', 'CDP', 'TargetClosed'].some(kw => excName.includes(kw)) ||
    ['browser context closed', 'page closed', 'browser crash'].some(kw => text.includes(kw))
  ) {
    pushCategory(categories, 'browser_error', 0.9, excName ? `Exception: ${excName}` : 'Browser keywords');
  }

  if (/failed to navigate|404|redirect loop|navigation fail/.test(text) || excName.includes('FailedToNavigate')) {
    pushCategory(categories, 'navigation_failure', 0.9, 'Navigation keywords');
  }

  if (/timeout|timed out|navigation timeout/.test(text) || excName.includes('Timeout')) {
    pushCategory(categories, 'timeout', 0.8, 'Timeout keywords');
  }

  if (/session expired|sign in again|logged out|login expired|unauthorized/.test(text)) {
    pushCategory(categories, 'session_expired', 0.75, 'Session keywords');
  }

  if (
    /login fail|authentication fail|auth fail|mfa|two-step|2-step|invalid password|incorrect password/.test(text) ||
    (text.includes('access denied') && hasAuthContext(text))
  ) {
    pushCategory(categories, 'auth_failure', 0.75, 'Auth failure keywords');
  }

  if (/credential not found|missing credential|bitwarden|password not found|username not found|no google password|resume pdf not found|\(unset\)/.test(text)) {
    pushCategory(categories, 'credential_error', 0.8, 'Credential/config keywords');
  }

  if (/already applied|application already|previously applied|duplicate application/.test(text)) {
    pushCategory(categories, 'already_applied', 0.85, 'Duplicate application keywords');
  }

  if (/single sign-on|sso|saml|oauth required|microsoft login required|google login required/.test(text)) {
    pushCategory(categories, 'sso_required', 0.7, 'SSO keywords');
  }

  if (/rate limit|llm error|api error|openai|provider error/.test(text) || ['LLM', 'APIError', 'RateLimit'].some(kw => excName.includes(kw))) {
    pushCategory(categories, 'llm_error', 0.85, 'LLM/provider keywords');
  }

  // Upstream reasoning — distinct from element_not_found
  if (
    /wrong action|invalid action|hallucin|schema mismatch|ai action|unknown tool|invented selector|nonsensical/.test(text) ||
    ctx.source === 'ai_validation'
  ) {
    pushCategory(categories, 'llm_reasoning_error', 0.7, 'LLM reasoning keywords');
  }

  if (
    /should have already been set|parameter binding|workflow parameter|missing profile|failed to parse profile|permission policy denied|not configured|config bug/.test(text) ||
    ctx.source === 'config'
  ) {
    pushCategory(categories, 'parameter_binding_error', 0.95, 'Parameter binding keywords');
  }

  if (/scraping fail|extraction fail|empty extraction|data extraction/.test(text)) {
    pushCategory(categories, 'data_extraction_failure', 0.7, 'Extraction keywords');
  }

  // element_not_found after llm_reasoning — executor couldn't find target
  if (/not found|no element|element.*missing|element_not_found|no matching element|selector.*not found/.test(text)) {
    pushCategory(categories, 'element_not_found', 0.8, 'Element not found keywords');
  }

  if (/unexpected page|wrong page|blank page|wrong_page_state/.test(text)) {
    pushCategory(categories, 'wrong_page_state', 0.6, 'Wrong page state keywords');
  }

  if (/max steps|maximum steps|step limit|max number of steps/.test(text)) {
    pushCategory(categories, 'max_steps_exceeded', 0.9, 'Max steps keywords');
  }

  if (/network error|econnrefused|enotfound|infrastructure|out of memory|oom/.test(text)) {
    pushCategory(categories, 'infrastructure_error', 0.75, 'Infrastructure keywords');
  }

  if (/form_incompatible|disabled element|unsupported action|cannot select/.test(text)) {
    pushCategory(categories, 'form_incompatible', 0.65, 'Form incompatibility keywords');
  }

  if (!categories.length) {
    categories.push({ category: 'unknown', confidence_float: 0.5, reasoning: 'No keyword match' });
  }

  categories.sort((a, b) => b.confidence_float - a.confidence_float);
  return categories;
}

export function classifyFailure(input = '', ctx = {}) {
  return classifyFailureDetailed(input, ctx)[0]?.category || 'unknown';
}

export function verdictWithFailureReason(verdict = {}, ctx = {}) {
  if (verdict.passed) {
    return { ...verdict, verdict: 'success', failure_reason: null, failure_categories: null };
  }
  const blob = `${verdict.reason || ''}\n${verdict.evidence || ''}`;
  const categories = classifyFailureDetailed(blob, ctx);
  return {
    ...verdict,
    verdict: 'failure',
    failure_reason: categories[0]?.category || 'unknown',
    failure_categories: categories
  };
}
