import { TOOL_REGISTRY } from './tools.js';

export function buildSubagentPrompt(task, obs, history = []) {
  const toolsInfo = Object.entries(TOOL_REGISTRY).map(([name, def]) => {
    return `- ${name}: ${def.description} | Params: ${JSON.stringify(def.params)}`;
  }).join('\n');

  const compactFields = (obs.fields || []).map(f => {
    const compact = { label: f.label, type: f.type, selector: f.selector };
    if (f.required) compact.required = true;
    if (f.placeholder) compact.ph = f.placeholder;
    if (f.currentValue) compact.value = f.currentValue;
    if (f.type === 'select' && f.options?.length) {
      compact.options = f.options.filter(o => !o.isPlaceholder).map(o => o.text);
    }
    return compact;
  });

  const compactButtons = (obs.buttons || []).map(b => ({
    text: b.text,
    selector: b.selector,
    disabled: b.disabled || false
  }));

  const historyBlock = history.length ? history.slice(-6).map(h => {
    return `Step ${h.step}:
- Reasoning: ${h.reasoning}
- Tool: ${h.tool}
- Args: ${JSON.stringify(h.args)}
- Result: ${h.result}`;
  }).join('\n\n') : 'No history yet.';

  const ariaBlock = obs.ariaSnapshot
    ? `\nACCESSIBILITY TREE:\n${obs.ariaSnapshot}\n`
    : '';

  const consoleBlock = obs.consoleTail?.length
    ? `\nCONSOLE LOGS / ERRORS:\n${obs.consoleTail.join('\n')}\n`
    : '';

  return `You are a browser subagent executing a task in the browser.
Your goal is to achieve this TASK: "${task}"

AVAILABLE TOOLS:
${toolsInfo}

GUIDELINES:
1. Return exactly ONE tool call in the JSON format specified below.
2. Selectors MUST be chosen exactly from the FIELDS/BUTTONS list below. Do not invent selectors.
3. For elements inside iframes, use the selectors containing " >>> " (frame-piercing) exactly as they are scraped.
4. If an OAuth/Google login window pops up, use the "handle_login" tool immediately.
5. If you believe the task is fully completed, use the "finish" tool with status "done".

ROLLING HISTORY:
${historyBlock}

CURRENT OBSERVATION:
URL: ${obs.url}
Title: ${obs.title}
Text: ${obs.pageText?.slice(0, 1500)}

FIELDS:
${JSON.stringify(compactFields)}

BUTTONS:
${JSON.stringify(compactButtons)}
${ariaBlock}
${consoleBlock}
FORMAT (Return ONLY raw JSON - no markdown wrapper, no explanation):
{"reasoning":"...","tool":"navigate|click|fill|select|check|upload|scroll|hover|press|wait|read|screenshot|extract|handle_login|finish","args":{...},"status":"continue|done|blocked"}
`;
}
