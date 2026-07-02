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

/** Generate optimal correction prompt based on the classified error type */
export async function getCorrectionPrompt(type, error, rawResponse, action, page) {
  switch (type) {
    case 'syntax':
      return `Your previous response could not be parsed as JSON:
Error: ${error.message}

Previous Response:
${rawResponse}

Please correct the JSON syntax. Ensure all quotes are escaped properly and there are no trailing commas.
Return ONLY the corrected JSON object matching the tool schema. Do not write any markdown code block wraps (like \`\`\`json) or explanations.`;

    case 'validation':
      return `Your previous response was valid JSON but failed schema validation:
Error: ${error.message}

Previous Response:
${JSON.stringify(action, null, 2)}

Please correct the action arguments or tool name to match the allowed schema.
Return ONLY the corrected JSON object matching the tool schema. Do not write any markdown code block wraps or explanations.`;

    case 'execution':
      return `Your previous action was valid and schema-compliant, but failed to execute on the browser page:
Error: ${error.message}

Action:
${JSON.stringify(action, null, 2)}

This usually happens when the target element is not found, not visible, disabled, or not ready for interaction.
Please review the page state, find the correct selector/ref or try a different action, and output a corrected action.
Return ONLY the corrected JSON object matching the tool schema.`;

    case 'semantic': {
      // Find visible error messages on the page to provide rich context to the LLM
      const pageErrors = await page.evaluate(() => {
        const errorElements = Array.from(document.querySelectorAll('.error, .invalid, .warning, [role="alert"], [class*="error" i], [class*="invalid" i], [class*="warning" i]'));
        return errorElements
          .map(el => el.innerText.trim())
          .filter(txt => txt.length > 0 && txt.length < 200)
          .slice(0, 5);
      }).catch(() => []);
      
      const errorContext = pageErrors.length > 0
        ? `Visible form errors/warnings on page:\n${pageErrors.map(e => `- "${e}"`).join('\n')}`
        : 'The action completed but did not produce the expected result or triggered form validation warnings.';

      return `Your previous action executed successfully but resulted in a semantic error or validation failure:
Action:
${JSON.stringify(action, null, 2)}

Context:
${errorContext}

Please analyze why this action was incorrect (e.g. wrong input value, wrong dropdown selection, or missing required field before clicking) and output a corrected action.
Return ONLY the corrected JSON object matching the tool schema.`;
    }
    default:
      return `Your previous response or action failed: ${error.message}\nPlease correct it and return only one JSON object matching the schema.`;
  }
}
