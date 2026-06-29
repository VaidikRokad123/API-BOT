/**
 * element-relocator.js — Adaptive element relocation engine.
 *
 * Ported from Scrapling's parser.py `relocate()` + `__calculate_similarity_score()`.
 * When a cached CSS/hash selector fails to match, this module re-finds the element
 * using a multi-signal fuzzy similarity score instead of falling back to the LLM.
 *
 * Scoring signals (each 0-1, averaged into final percentage):
 *   1. Tag name exact match
 *   2. Text content similarity (Dice coefficient)
 *   3. Attributes dict overlap (keys + values)
 *   4. Individual key attribs: class, id, href, src, name, role, type
 *   5. DOM ancestry path similarity
 *   6. Parent tag + attributes + text
 *   7. Sibling tag list similarity
 */

// ─── Dice coefficient (fast string similarity, equivalent to SequenceMatcher) ──
function bigrams(str) {
  const s = String(str || '').toLowerCase();
  const set = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const bi = s.slice(i, i + 2);
    set.set(bi, (set.get(bi) || 0) + 1);
  }
  return set;
}

function diceCoefficient(a, b) {
  const sa = String(a || '');
  const sb = String(b || '');
  if (sa === sb) return 1;
  if (!sa || !sb) return 0;
  if (sa.length < 2 || sb.length < 2) return sa === sb ? 1 : 0;
  const biA = bigrams(sa);
  const biB = bigrams(sb);
  let intersection = 0;
  for (const [bi, count] of biA) {
    intersection += Math.min(count, biB.get(bi) || 0);
  }
  return (2 * intersection) / (sa.length - 1 + sb.length - 1);
}

// ─── Array similarity (for sibling lists, DOM paths) ────────────────────────
function arraySimilarity(a, b) {
  const arrA = Array.isArray(a) ? a : [];
  const arrB = Array.isArray(b) ? b : [];
  if (arrA.length === 0 && arrB.length === 0) return 1;
  if (arrA.length === 0 || arrB.length === 0) return 0;
  const strA = arrA.join('/');
  const strB = arrB.join('/');
  return diceCoefficient(strA, strB);
}

// ─── Dict similarity (keys + values, Scrapling's __calculate_dict_diff) ─────
function dictSimilarity(dict1, dict2) {
  const keys1 = Object.keys(dict1 || {});
  const keys2 = Object.keys(dict2 || {});
  const vals1 = Object.values(dict1 || {}).map(String);
  const vals2 = Object.values(dict2 || {}).map(String);
  const keySim = diceCoefficient(keys1.join(','), keys2.join(','));
  const valSim = diceCoefficient(vals1.join(','), vals2.join(','));
  return keySim * 0.5 + valSim * 0.5;
}

// ─── Element fingerprinting ─────────────────────────────────────────────────

/**
 * Extract a content-based fingerprint from a Playwright element handle or
 * from a pre-collected element descriptor object (from perception.js).
 *
 * For page.evaluate():
 *   const fp = await page.evaluate(elementToFingerprintInPage, elementHandle);
 *
 * For pre-collected elements (from perception snapshot):
 *   const fp = elementToFingerprint(descriptorObj);
 */
export function elementToFingerprint(el) {
  if (!el) return null;
  return {
    tag: String(el.tag || el.tagName || '').toLowerCase(),
    text: String(el.text || el.textContent || el.name || '').slice(0, 200).trim(),
    attributes: el.attributes || extractAttributes(el),
    path: el.path || [],
    parentTag: String(el.parentTag || el.parentName || '').toLowerCase(),
    parentAttribs: el.parentAttribs || {},
    parentText: String(el.parentText || '').slice(0, 200).trim(),
    siblings: el.siblings || [],
    // Extra signals your project already captures
    role: String(el.role || '').toLowerCase(),
    type: String(el.type || '').toLowerCase(),
  };
}

function extractAttributes(el) {
  if (el.attributes && typeof el.attributes === 'object' && !Array.isArray(el.attributes)) return el.attributes;
  const attrs = {};
  // If it's a perception-style element with class/id/etc directly
  if (el.className) attrs.class = el.className;
  if (el.id) attrs.id = el.id;
  if (el.href) attrs.href = el.href;
  if (el.src) attrs.src = el.src;
  if (el.name) attrs.name = el.name;
  if (el.role) attrs.role = el.role;
  if (el.type) attrs.type = el.type;
  if (el.placeholder) attrs.placeholder = el.placeholder;
  return attrs;
}

/**
 * In-page fingerprint extraction. Run inside page.evaluate() with an Element.
 * Returns a plain object that can be scored against a saved fingerprint.
 */
export const FINGERPRINT_EXTRACT_FN = function (el) {
  if (!el || !el.tagName) return null;

  function getPath(node) {
    const parts = [];
    let current = node;
    while (current && current.tagName) {
      parts.unshift(current.tagName.toLowerCase());
      current = current.parentElement;
    }
    return parts;
  }

  function cleanAttrs(node) {
    const result = {};
    for (const attr of node.attributes) {
      const val = (attr.value || '').trim();
      if (val) result[attr.name] = val;
    }
    return result;
  }

  const parent = el.parentElement;
  const siblings = parent
    ? Array.from(parent.children).filter(c => c !== el).map(c => c.tagName.toLowerCase())
    : [];

  return {
    tag: el.tagName.toLowerCase(),
    text: (el.textContent || '').slice(0, 200).trim(),
    attributes: cleanAttrs(el),
    path: getPath(el),
    parentTag: parent ? parent.tagName.toLowerCase() : '',
    parentAttribs: parent ? cleanAttrs(parent) : {},
    parentText: parent ? (parent.textContent || '').slice(0, 200).trim() : '',
    siblings,
    role: el.getAttribute('role') || '',
    type: el.getAttribute('type') || '',
  };
};

// ─── Similarity scoring ─────────────────────────────────────────────────────

/**
 * Calculate how similar a candidate fingerprint is to an original fingerprint.
 * Returns a percentage 0-100.
 *
 * Directly ported from Scrapling parser.py L807-872.
 */
export function calculateSimilarityScore(original, candidate) {
  if (!original || !candidate) return 0;

  let score = 0;
  let checks = 0;

  // 1. Tag name
  score += (original.tag === candidate.tag) ? 1 : 0;
  checks += 1;

  // 2. Text content
  if (original.text) {
    score += diceCoefficient(original.text, candidate.text || '');
    checks += 1;
  }

  // 3. Attributes dict overlap
  score += dictSimilarity(original.attributes, candidate.attributes);
  checks += 1;

  // 4. Individual key attributes (Scrapling's separate attrib checks)
  for (const attrib of ['class', 'id', 'href', 'src', 'name', 'role', 'type']) {
    const origVal = (original.attributes || {})[attrib];
    if (origVal) {
      score += diceCoefficient(origVal, (candidate.attributes || {})[attrib] || '');
      checks += 1;
    }
  }

  // 5. DOM ancestry path
  score += arraySimilarity(original.path, candidate.path);
  checks += 1;

  // 6. Parent tag + attributes + text
  if (original.parentTag) {
    if (candidate.parentTag) {
      score += diceCoefficient(original.parentTag, candidate.parentTag);
      checks += 1;

      score += dictSimilarity(original.parentAttribs, candidate.parentAttribs);
      checks += 1;

      if (original.parentText) {
        score += diceCoefficient(original.parentText, candidate.parentText || '');
        checks += 1;
      }
    }
  }

  // 7. Siblings
  if (original.siblings && original.siblings.length > 0) {
    score += arraySimilarity(original.siblings, candidate.siblings || []);
    checks += 1;
  }

  if (checks === 0) return 0;
  return Math.round((score / checks) * 10000) / 100; // 2 decimal places
}

// ─── Relocator ──────────────────────────────────────────────────────────────

/**
 * Scan all elements on the page and find the best match for a saved fingerprint.
 *
 * @param {import('playwright').Page} page - Playwright page object
 * @param {object} savedFingerprint - Previously saved element fingerprint
 * @param {number} threshold - Minimum similarity percentage (default 40, same as Scrapling)
 * @returns {{ element: ElementHandle|null, score: number, fingerprint: object|null }}
 */
export async function relocateElement(page, savedFingerprint, threshold = 40) {
  if (!page || !savedFingerprint) return { element: null, score: 0, fingerprint: null };

  // Collect fingerprints of ALL interactive elements on the page
  const candidates = await page.evaluate((extractFn) => {
    const fn = new Function('el', `return (${extractFn})(el)`);
    const allElements = document.querySelectorAll('*');
    const results = [];
    for (let i = 0; i < allElements.length && i < 5000; i++) {
      const el = allElements[i];
      // Skip non-visible or script/style/meta elements
      const tag = el.tagName.toLowerCase();
      if (['script', 'style', 'meta', 'link', 'head', 'noscript', 'br', 'hr'].includes(tag)) continue;
      const fp = fn(el);
      if (fp) {
        fp._index = i;
        results.push(fp);
      }
    }
    return results;
  }, FINGERPRINT_EXTRACT_FN.toString());

  // Score each candidate
  let bestScore = 0;
  let bestCandidate = null;
  let bestIndex = -1;

  for (const candidate of candidates) {
    const score = calculateSimilarityScore(savedFingerprint, candidate);
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
      bestIndex = candidate._index;
    }
  }

  if (bestScore < threshold) {
    return { element: null, score: bestScore, fingerprint: bestCandidate };
  }

  // Get the actual element handle
  const elementHandle = await page.evaluateHandle((idx) => {
    return document.querySelectorAll('*')[idx];
  }, bestIndex);

  return {
    element: elementHandle.asElement(),
    score: bestScore,
    fingerprint: bestCandidate,
  };
}

/**
 * Try to relocate from a list of pre-collected perception elements (no page.evaluate needed).
 * Returns the best matching element descriptor and its score.
 *
 * @param {object} savedFingerprint - Previously saved fingerprint
 * @param {Array} elements - Array of perception element descriptors
 * @param {number} threshold - Minimum percentage
 * @returns {{ match: object|null, score: number }}
 */
export function relocateFromPerception(savedFingerprint, elements = [], threshold = 40) {
  if (!savedFingerprint || !elements.length) return { match: null, score: 0 };

  let bestScore = 0;
  let bestMatch = null;

  for (const el of elements) {
    const fp = elementToFingerprint(el);
    const score = calculateSimilarityScore(savedFingerprint, fp);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = el;
    }
  }

  if (bestScore < threshold) return { match: null, score: bestScore };
  return { match: bestMatch, score: bestScore };
}
