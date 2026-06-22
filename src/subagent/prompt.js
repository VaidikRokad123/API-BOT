import { TOOL_REGISTRY } from './tools.js';
import { parsePhoneNumber } from '../apply/prompt.js';

export function buildSubagentPrompt(task, obs, history = [], profile = null, research = null) {
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

  let candidateBlock = '';
  let guidelinesBlock = '';

  if (profile) {
    const [firstName, ...rest] = (profile.name || '').split(' ');
    const lastName = rest.join(' ');
    const parsedPhone = parsePhoneNumber(profile);

    const compactProfile = {
      name: profile.name,
      firstName,
      lastName,
      email: profile.email,
      phone: parsedPhone.phone,
      phoneCountryCode: parsedPhone.phoneCountryCode,
      phoneNumberDigits: parsedPhone.phoneNumberDigits,
      legalNameSameAsPreferred: profile.legalNameSameAsPreferred || 'Yes',
      address: profile.address,
      city: profile.city,
      state: profile.state,
      country: profile.country || 'United States',
      postalCode: profile.postalCode,
      linkedin: profile.linkedin,
      github: profile.github,
      portfolio: profile.portfolio,
      yearsOfExperience: profile.yearsOfExperience,
      currentRole: profile.currentRole,
      desiredRole: profile.desiredRole,
      currentCTC: profile.currentCTC,
      expectedCTC: profile.expectedCTC,
      noticePeriod: profile.noticePeriod,
      reasonForLeaving: profile.reasonForLeaving,
      skills: profile.skills,
      education: profile.education,
      resumeSummary: (profile.resume || '').slice(0, 800),
      workAuthorization: profile.workAuthorization || 'Yes',
      requiresSponsorship: profile.requiresSponsorship || 'No',
      gender: profile.gender || 'Prefer not to say',
      ethnicity: profile.ethnicity || 'Prefer not to say',
      veteranStatus: profile.veteranStatus || 'No',
      disabilityStatus: profile.disabilityStatus || 'No',
      armedForcesStatus: profile.armedForcesStatus || profile.militaryOrGovernmentEmployee || 'No',
      militaryOrGovernmentEmployee: profile.militaryOrGovernmentEmployee || 'No',
      hasNonCompete: profile.hasNonCompete || 'No',
      previouslyEmployedHere: profile.previouslyEmployedHere || 'No',
      currentlyAtSubsidiary: profile.currentlyAtSubsidiary || 'No',
      willingToRelocate: profile.willingToRelocate || 'No',
    };

    let researchText = '';
    if (research) {
      researchText = `
JOB RESEARCH:
Company: ${research.companyName} | Role: ${research.jobTitle}
Context: ${research.companyContext?.slice(0, 200)}
Key Reqs: ${research.keyRequirements?.join(', ')}
Matched Skills: ${research.matchingSkills?.join(', ')}
Salary: ${research.salaryToQuote ?? research.salaryFallback}
Positioning: ${research.positioningStatement?.slice(0, 200)}
`;
    }

    candidateBlock = `
CANDIDATE PROFILE:
${JSON.stringify(compactProfile)}
${researchText}
`;

    guidelinesBlock = `
GUIDELINES FOR FORM FILLING:
1. Use the CANDIDATE PROFILE and JOB RESEARCH above to answer form questions.
2. Selectors MUST be chosen exactly from the FIELDS/BUTTONS list below. Do not invent selectors.
3. If there are multiple form fields visible (inputs, dropdowns, checkboxes, radios, signature pads, uploads), use the "fill_form" tool to fill them all at once in a single step.
4. For "fill_form", the actions parameter must be an array of objects: {"type": "fill|select|check|upload|signature", "selector": "...", "value": "..."}.
5. Fill ALL fields on the current page section using "fill_form" BEFORE clicking Next/Submit/Continue.
6. Once a page section is fully filled, use the "click" tool to click the Next/Submit/Continue button.
7. If faced with multiple login options (Google, Microsoft, LinkedIn, Email), click "Continue with Google" / "Sign in with Google".
8. Do not mark the task "done" / "finish" until the page explicitly confirms the application has been submitted/received. Seeing a Submit button means it is NOT done.
9. If a Google OAuth or login window pops up, use the "handle_login" tool immediately.
10. If a CAPTCHA or verification challenge appears, use the "wait" tool to pause so the user can solve it.
`;
  } else {
    guidelinesBlock = `
GUIDELINES:
1. Return exactly ONE tool call in the JSON format specified below.
2. Selectors MUST be chosen exactly from the FIELDS/BUTTONS list below. Do not invent selectors.
3. For elements inside iframes, use the selectors containing " >>> " (frame-piercing) exactly as they are scraped.
4. If an OAuth/Google login window pops up, use the "handle_login" tool immediately.
5. If you believe the task is fully completed, use the "finish" tool with status "done".
`;
  }

  return `You are a browser subagent executing a task in the browser.
Your goal is to achieve this TASK: "${task}"

AVAILABLE TOOLS:
${toolsInfo}
${candidateBlock}
${guidelinesBlock}

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
{"reasoning":"...","tool":"navigate|click|click_blank|fill|select|check|upload|scroll|hover|press|wait|read|screenshot|extract|handle_login|signature|fill_form|finish","args":{...},"status":"continue|done|blocked"}
`;
}
