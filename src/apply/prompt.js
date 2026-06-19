export function sanitizeGptJson(raw) {
  const start = raw.indexOf('{');
  const end   = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object in GPT response');

  let src = raw.slice(start, end + 1);
  let result = '', inString = false, escaped = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (escaped)                  { result += ch; escaped = false; continue; }
    if (ch === '\\' && inString)  { result += ch; escaped = true;  continue; }
    if (ch === '"')               { inString = !inString; result += ch; continue; }
    if (inString) {
      if      (ch === '\n') { result += '\\n'; continue; }
      else if (ch === '\r') { result += '\\r'; continue; }
      else if (ch === '\t') { result += '\\t'; continue; }
      else if (ch.charCodeAt(0) < 0x20) continue;
    }
    result += ch;
  }
  return JSON.parse(result);
}

export function buildAgentPrompt(profile, pageState, step) {
  return `
You are an AI job application agent on step ${step}. Analyze the current page and return ONLY a raw JSON object — no markdown, no code fences.

CANDIDATE PROFILE:
${JSON.stringify(profile, null, 2)}

CURRENT PAGE:
URL: ${pageState.url}
Title: ${pageState.title}
Page Text: ${pageState.pageText}

FORM FIELDS (${pageState.fields.length}):
${JSON.stringify(pageState.fields, null, 2)}

CANVAS ELEMENTS - signature pads (${pageState.canvases.length}):
${JSON.stringify(pageState.canvases, null, 2)}

BUTTONS (${pageState.buttons.length}):
${JSON.stringify(pageState.buttons, null, 2)}

RETURN THIS EXACT FORMAT:
{
  "reasoning": "what you see and plan",
  "actions": [
    { "type": "fill",      "selector": "#id",   "value": "text",          "description": "field name" },
    { "type": "select",    "selector": "#id",   "value": "EXACT option text from options[]", "description": "label" },
    { "type": "check",     "selector": "#id",   "description": "checkbox label" },
    { "type": "upload",    "selector": "input[type=file]", "description": "Resume upload" },
    { "type": "signature", "selector": "canvas","description": "Candidate Signature" },
    { "type": "click",     "selector": "button","description": "button label" }
  ],
  "status": "continue | done | error",
  "message": "summary"
}

RULES:
- Fill ALL fields on this page before clicking any navigation button.
- For select dropdowns: use the EXACT .text from the options[] array. Never guess.
- For Yes/No location questions: compare the job location with candidate's city ("${profile.city}").
- Check ALL "I agree / accept terms" checkboxes.
- Include a signature action when a canvas is present.
- Include an upload action when a file input is present.
- Click "Next Page" or "Submit Application" LAST after all fields are filled.
- If you see "Thank you" or "submitted", set status to "done".
- NEVER click Back buttons.
- Skip fields that already have a correct currentValue.
`.trim();
}
