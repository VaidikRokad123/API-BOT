import { validateAiAction } from './engine.js';

export function fixUnescapedQuotes(jsonStr) {
  let result = '';
  let i = 0;
  while (i < jsonStr.length) {
    if (jsonStr[i] === '"') {
      let tokenStart = i;
      let tokenEnd = i + 1;
      let escaped = false;
      while (tokenEnd < jsonStr.length) {
        if (escaped) escaped = false;
        else if (jsonStr[tokenEnd] === '\\') escaped = true;
        else if (jsonStr[tokenEnd] === '"') break;
        tokenEnd++;
      }
      const token = jsonStr.slice(tokenStart + 1, tokenEnd);
      let nextCharIdx = tokenEnd + 1;
      while (nextCharIdx < jsonStr.length && /\s/.test(jsonStr[nextCharIdx])) nextCharIdx++;
      if (nextCharIdx < jsonStr.length && jsonStr[nextCharIdx] === ':') {
        result += `"${token}"`;
        i = tokenEnd + 1;
      } else {
        let realEnd = tokenEnd;
        let foundRealEnd = false;
        while (realEnd < jsonStr.length) {
          if (jsonStr[realEnd] === '"' && (realEnd === tokenEnd || jsonStr[realEnd - 1] !== '\\')) {
            let followIdx = realEnd + 1;
            while (followIdx < jsonStr.length && /\s/.test(jsonStr[followIdx])) followIdx++;
            if (followIdx >= jsonStr.length || [',', '}', ']'].includes(jsonStr[followIdx])) {
              foundRealEnd = true;
              break;
            }
          }
          realEnd++;
        }
        if (foundRealEnd) {
          const valContent = jsonStr.slice(tokenStart + 1, realEnd);
          let escapedVal = '';
          for (let j = 0; j < valContent.length; j++) {
            escapedVal += valContent[j] === '"' && (j === 0 || valContent[j - 1] !== '\\') ? '\\"' : valContent[j];
          }
          result += `"${escapedVal}"`;
          i = realEnd + 1;
        } else {
          result += `"${token}"`;
          i = tokenEnd + 1;
        }
      }
    } else {
      result += jsonStr[i];
      i++;
    }
  }
  return result;
}

export function sanitizeGptJson(raw) {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object in GPT response');

  let src = raw.slice(start, end + 1);
  src = fixUnescapedQuotes(src);
  let result = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (escaped) { result += ch; escaped = false; continue; }
    if (ch === '\\' && inString) { result += ch; escaped = true; continue; }
    if (ch === '"') { inString = !inString; result += ch; continue; }
    if (inString) {
      if (ch === '\n') { result += '\\n'; continue; }
      if (ch === '\r') { result += '\\r'; continue; }
      if (ch === '\t') { result += '\\t'; continue; }
      if (ch.charCodeAt(0) < 0x20) continue;
    }
    result += ch;
  }
  return JSON.parse(result);
}

/** Parse raw AI text → Zod-validated action, with one self-repair retry via sendMessage. */
export async function parseAndValidateAction(raw, aiPage, sendMessage, logger) {
  try {
    return validateAiAction(sanitizeGptJson(raw));
  } catch (err) {
    logger?.warn?.({ err: err.message }, 'ai_action_invalid_retrying');
    const retry = await sendMessage(
      aiPage,
      `Your previous response was invalid: ${err.message}\nReturn ONLY one JSON object matching the requested tool schema. No markdown.`
    );
    return validateAiAction(sanitizeGptJson(retry));
  }
}
