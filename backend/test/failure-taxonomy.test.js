import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyFailure, classifyFailureDetailed } from '../src/apply/failure-taxonomy.js';
import { computeElementHash, findElementsByHash } from '../src/subagent/element-hash.js';
import { prepareDomainSkillForReplay } from '../src/subagent/domain-skills.js';
import { resolveCredentialRef, resolveFillValue, isCredentialToken } from '../src/credentials.js';

test('classifyFailure: access denied without auth context → captcha/cloudflare family', () => {
  assert.equal(classifyFailure('Access denied by firewall'), 'captcha');
});

test('classifyFailure: access denied with auth context → auth_failure', () => {
  const cats = classifyFailureDetailed('Access denied during login with invalid password');
  assert.ok(cats.some(c => c.category === 'auth_failure'));
  assert.ok(!cats.some(c => c.category === 'captcha') || cats.findIndex(c => c.category === 'auth_failure') < cats.findIndex(c => c.category === 'captcha'));
});

test('classifyFailure: proxy before browser when exception name contains Browser', () => {
  const cats = classifyFailureDetailed('proxy pool exhausted', { exceptionName: 'UnknownErrorWhileCreatingBrowserContext' });
  assert.equal(cats[0].category, 'proxy_error');
});

test('classifyFailure: llm_reasoning_error distinct from element_not_found', () => {
  assert.equal(classifyFailure('AI returned invalid action schema mismatch'), 'llm_reasoning_error');
  assert.equal(classifyFailure('element not found for selector #foo'), 'element_not_found');
});

test('classifyFailure: parameter_binding_error for config bugs', () => {
  assert.equal(classifyFailure('resume pdf not found at (unset)'), 'credential_error');
  assert.equal(classifyFailure('parameter binding: workflow parameter missing'), 'parameter_binding_error');
});

test('computeElementHash: stable for same semantic element', () => {
  const el = { role: 'textbox', name: 'Email', tag: 'input', type: 'email', placeholder: 'you@example.com', context: 'Sign in' };
  assert.equal(computeElementHash(el), computeElementHash({ ...el }));
  assert.notEqual(computeElementHash(el), computeElementHash({ ...el, name: 'Password' }));
});

test('prepareDomainSkillForReplay: aborts on hash ambiguity', () => {
  const hash = computeElementHash({ role: 'button', name: 'Next', tag: 'button', type: 'button', context: '' });
  const skill = {
    strategy: [{ tool: 'click', elementHash: hash, args: { elementHash: hash } }]
  };
  const observation = {
    elements: [
      { ref: 'gpt-ref-1', selector: '[data-gpt-auth-ref="gpt-ref-1"]', elementHash: hash },
      { ref: 'gpt-ref-2', selector: '[data-gpt-auth-ref="gpt-ref-2"]', elementHash: hash }
    ]
  };
  const replay = prepareDomainSkillForReplay(skill, observation, []);
  assert.equal(replay.skillReplay.mode, 'fallback');
  assert.equal(replay.skillReplay.reason, 'hash_ambiguous');
});

test('prepareDomainSkillForReplay: resolves unique hash to current ref', () => {
  const hash = computeElementHash({ role: 'textbox', name: 'Name', tag: 'input', type: 'text', context: '' });
  const skill = {
    strategy: [{ tool: 'fill', elementHash: hash, args: { elementHash: hash, value: 'Alice' } }]
  };
  const observation = {
    elements: [
      { ref: 'gpt-ref-9', selector: '[data-gpt-auth-ref="gpt-ref-9"]', elementHash: hash }
    ]
  };
  const replay = prepareDomainSkillForReplay(skill, observation, []);
  assert.equal(replay.strategy[0].args.ref, 'gpt-ref-9');
  assert.equal(replay.skillReplay.mode, 'cache');
});

test('credentials: password tokens never resolve in AI-safe stub', () => {
  assert.ok(isCredentialToken('__default_password__'));
  const resolved = resolveFillValue('__default_password__', { credentials: { default: { passwordRef: 'env:TEST_SECRET' } } });
  assert.equal(resolved.isSecret, true);
  assert.equal(resolved.credentialFilled, true);
});

test('resolveCredentialRef: env and profile paths', () => {
  const prev = process.env.GPT_AUTH_TEST_PW;
  process.env.GPT_AUTH_TEST_PW = 'secret123';
  try {
    assert.equal(resolveCredentialRef('env:GPT_AUTH_TEST_PW'), 'secret123');
    assert.equal(resolveCredentialRef('profile:email', { email: 'a@b.com' }), 'a@b.com');
  } finally {
    if (prev === undefined) delete process.env.GPT_AUTH_TEST_PW;
    else process.env.GPT_AUTH_TEST_PW = prev;
  }
});
