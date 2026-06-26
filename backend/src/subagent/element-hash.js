import crypto from 'crypto';

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Content fingerprint: role + accessible name + tag/type + nearby section context. */
export function computeElementHash(element = {}) {
  const payload = {
    role: element.role || '',
    name: normalizeText(element.name),
    tag: element.tag || '',
    type: element.type || '',
    placeholder: normalizeText(element.placeholder),
    context: normalizeText(element.context || element.sectionLabel || '')
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
}

export function findElementsByHash(elements = [], hash) {
  if (!hash) return [];
  return elements.filter(el => el.elementHash === hash);
}

export function resolveHashToElement(elements = [], hash) {
  const matches = findElementsByHash(elements, hash);
  if (matches.length !== 1) return { match: null, ambiguous: matches.length > 1, count: matches.length };
  return { match: matches[0], ambiguous: false, count: 1 };
}
