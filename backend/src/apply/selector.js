export function attributeSelector(attribute, value) {
  const safeAttribute = String(attribute).replace(/[^a-z0-9_-]/gi, '');
  const safeValue = String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    .replace(/\r/g, '\\d ').replace(/\n/g, '\\a ');
  return `[${safeAttribute}='${safeValue}']`;
}

export function idFromLegacySelector(selector) {
  if (!String(selector || '').startsWith('#')) return null;
  return String(selector).slice(1).replace(/\\(.)/g, '$1');
}
