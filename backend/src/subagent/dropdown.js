export function normalizeDropdownText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

function withoutParenthetical(value) {
  return normalizeDropdownText(String(value ?? '').replace(/\s*[([][^)\]]*[)\]]\s*$/g, ''));
}

export function isDropdownPlaceholder(option) {
  if (!option) return true;
  const text = String(option.text ?? option.label ?? '').replace(/\s+/g, ' ').trim();
  const value = String(option.value ?? '').trim().toLowerCase();
  return Boolean(option.isPlaceholder || option.disabled || option.hidden ||
    value === '' || ['default', 'placeholder', 'null', '-1'].includes(value) ||
    /^(?:please\s+)?(?:select|choose|pick)\b|^none selected$/i.test(text));
}

export function findVerifiedDropdownValue(values, expectedValue) {
  const expected = normalizeDropdownText(expectedValue);
  if (!expected) return null;
  return (values || []).find(value => {
    const actual = normalizeDropdownText(value);
    return actual === expected || actual.startsWith(`${expected} `) || actual.endsWith(` ${expected}`);
  }) || null;
}

/**
 * Match only when the choice is deterministic. A wrong dropdown value is much
 * worse than leaving the field empty for the next apply-loop iteration.
 */
export function findBestDropdownOption(options, requestedValue) {
  const target = normalizeDropdownText(requestedValue);
  if (!target) return null;

  const allowed = (options || []).filter(option =>
    option && !isDropdownPlaceholder(option) &&
    (normalizeDropdownText(option.text) || normalizeDropdownText(option.value))
  );

  const exactText = allowed.find(option => normalizeDropdownText(option.text) === target);
  if (exactText) return exactText;

  const exactValue = allowed.find(option => normalizeDropdownText(option.value) === target);
  if (exactValue) return exactValue;

  const withoutExtra = allowed.filter(option => withoutParenthetical(option.text) === target);
  if (withoutExtra.length === 1) return withoutExtra[0];

  const boundaryMatches = allowed.filter(option => {
    const text = normalizeDropdownText(option.text);
    return text.startsWith(`${target} `) || target.startsWith(`${text} `);
  });
  if (boundaryMatches.length === 1) return boundaryMatches[0];

  const uniqueContainment = allowed.filter(option => {
    const text = normalizeDropdownText(option.text);
    const val = normalizeDropdownText(option.value);
    return text.includes(target) || val.includes(target) || (target.length >= 2 && (target.includes(text) || target.includes(val)));
  });
  if (uniqueContainment.length === 1) return uniqueContainment[0];

  return null;
}

