/**
 * Credential resolution — secrets never enter AI prompts.
 * AI may reference fill tokens (__default_password__); executor resolves and types locally.
 *
 * Ref formats in profile.credentials.*:
 *   env:VAR_NAME          — process.env
 *   profile:email         — dotted path under profile root
 *   literal string        — inline value (discouraged for passwords)
 */

export const CREDENTIAL_FILL_TOKENS = {
  googleemail: { slot: 'google', field: 'username', public: true },
  googlepassword: { slot: 'google', field: 'password', public: false },
  defaultusername: { slot: 'default', field: 'username', public: true },
  defaultpassword: { slot: 'default', field: 'password', public: false }
};

export function normalizeCredentialToken(value) {
  return String(value || '').toLowerCase().replace(/_/g, '');
}

export function isCredentialToken(value) {
  return normalizeCredentialToken(value) in CREDENTIAL_FILL_TOKENS;
}

export function resolveCredentialRef(ref, profile = {}) {
  if (ref == null || ref === '') return null;
  const text = String(ref);
  if (text.startsWith('env:')) {
    return process.env[text.slice(4)] ?? null;
  }
  if (text.startsWith('profile:')) {
    let cur = profile;
    for (const part of text.slice(8).split('.')) {
      cur = cur?.[part];
    }
    return cur != null ? String(cur) : null;
  }
  return text;
}

export function resolveCredential(slot, field, profile = {}) {
  const creds = profile.credentials?.[slot];
  if (!creds) {
    if (slot === 'google' && field === 'username') return profile.email || null;
    return null;
  }
  const refKey = `${field}Ref`;
  if (creds[refKey]) return resolveCredentialRef(creds[refKey], profile);
  if (creds[field] != null && creds[field] !== '') return String(creds[field]);
  if (slot === 'google' && field === 'username') return profile.email || null;
  return null;
}

/** Resolve AI fill token or pass through normal field value. */
export function resolveFillValue(rawValue, profile = {}) {
  const tok = normalizeCredentialToken(rawValue);
  const spec = CREDENTIAL_FILL_TOKENS[tok];
  if (!spec) {
    return { value: rawValue, isSecret: false, credentialFilled: false };
  }
  const value = resolveCredential(spec.slot, spec.field, profile) ?? '';
  return {
    value,
    isSecret: !spec.public,
    credentialFilled: true,
    slot: spec.slot,
    field: spec.field
  };
}

export function credentialFillLogMessage(resolved) {
  if (!resolved.credentialFilled) return null;
  if (resolved.isSecret) {
    return `    → [credential:${resolved.slot}.${resolved.field} filled]`;
  }
  return `    → "${String(resolved.value).slice(0, 80)}"`;
}

export function redactCredentialArgs(args = {}) {
  if (!args || typeof args !== 'object') return args;
  const out = { ...args };
  if (isCredentialToken(out.value)) {
    out.value = '[credential]';
  }
  return out;
}
