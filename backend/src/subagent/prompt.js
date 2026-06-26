import { TOOL_REGISTRY } from './tools.js';
import { parsePhoneNumber } from '../apply/prompt.js';

export function buildSubagentPrompt(task, obs, history = [], profile = null, research = null, domainSkill = null) {
  const toolsInfo = Object.entries(TOOL_REGISTRY).map(([name, def]) => {
    return `- ${name}: ${def.description} | Params: ${JSON.stringify(def.params)}`;
  }).join('\n');

  const compactFields = (obs.fields || []).map(f => {
    const compact = { label: f.label, type: f.type, selector: f.selector, ref: f.ref };
    if (f.required) compact.required = true;
    if (f.placeholder) compact.ph = f.placeholder;
    if (f.currentValue) compact.value = f.currentValue;
    if (f.type === 'select' && f.options?.length) {
      compact.options = f.options.filter(o => !o.isPlaceholder).map(o => o.text);
      compact.optionKind = 'native_select';
    }
    return compact;
  });

  const compactFieldsCapped = compactFields.slice(0, 60);

  const compactButtons = (obs.buttons || []).slice(0, 60).map(b => ({
    text: b.text,
    selector: b.selector,
    ref: b.ref,
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
    ? `\nACCESSIBILITY SNAPSHOT:\n${obs.ariaSnapshot}\n`
    : '';

  const elementListBlock = obs.elementList
    ? `\nINTERACTIVE ELEMENT LIST (role, accessible name/placeholder fallback, ref, selector, current value/checked/selected/options):\n${obs.elementList}\n`
    : '';

  const consoleBlock = obs.consoleTail?.length
    ? `\nCONSOLE LOGS / ERRORS:\n${obs.consoleTail.join('\n')}\n`
    : '';

  let candidateBlock = '';
  let guidelinesBlock = '';
  const domainSkillBlock = domainSkill
    ? `\nKNOWN DOMAIN SKILL FOR THIS HOST:\n${JSON.stringify(domainSkill).slice(0, 4000)}\nPrefer this working selector/ref strategy when it still matches the current page.\n`
    : '';

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
2. Use selector or ref values exactly from the FIELDS/BUTTONS/ELEMENT LIST below. Do not invent selectors or refs.
3. If there are multiple form fields visible (inputs, dropdowns, checkboxes, radios, signature pads, uploads), use the "fill_form" tool to fill them all at once in a single step.
4. For "fill_form", actions must be objects like {"type":"fill|select|check|upload|signature","selector":"...","ref":"...","value":"..."}.
5. Fill ALL fields on the current page section using "fill_form" BEFORE clicking Next/Submit/Continue.
6. Once a page section is fully filled, use the "click" tool to click the Next/Submit/Continue button.
7. If faced with multiple login options (Google, Microsoft, LinkedIn, Email), click "Continue with Google" / "Sign in with Google".
8. Do not mark the task "done" / "finish" until the page explicitly confirms the application has been submitted/received. Seeing a Submit button means it is NOT done.
9. If a Google OAuth or login window pops up, use the "handle_login" tool immediately.
10. If a CAPTCHA or verification challenge appears, use the "wait" tool to pause so the user can solve it.
11. Native <select> controls have optionKind "native_select" and visible options; ARIA custom dropdowns/comboboxes/listboxes are "custom_combobox". Keep them distinct in select actions.
12. For final submit/apply clicks, include args.category="submit_application" so the permission policy can pause before submitting.
`;
  } else {
    guidelinesBlock = `
GUIDELINES:
1. Return exactly ONE tool call in the JSON format specified below.
2. Selectors or refs MUST be chosen exactly from the FIELDS/BUTTONS/ELEMENT LIST. Do not invent selectors.
3. For elements inside iframes, use selectors containing " >>> " (frame-piercing) exactly as scraped.
4. If an OAuth/Google login window pops up, use the "handle_login" tool immediately.
5. The page's currently visible text is in CURRENT OBSERVATION → Text. READ IT — most "find / list / extract / summarize" tasks are answered directly from that text, no clicking needed.
6. For long pages (feeds, search results, lists, articles): the Text shows only what is currently loaded. Use "scroll" (direction "down") then re-read on the next step to load MORE items. Repeat until you have collected enough, then finish.
7. Collect findings as you go and keep them in your "reasoning". Do NOT give up just because the first screen shows only one item — scroll and keep reading.
8. Only use "screenshot" when the task truly needs visual inspection; you cannot read pixels from a screenshot, so prefer the Text.
9. When the task is complete, call the "finish" tool with status "done" and put your FULL compiled answer/report (the actual deliverable: items, roles, links, summary) in args.report as a string. This text becomes the run's report — make it complete and self-contained.
10. Use status "blocked" ONLY if genuinely unable to proceed after scrolling/reading (e.g. login wall). Explain what blocked you in args.report.
11. CRITICAL MULTI-SITE INSTRUCTION: If the TASK requests performing actions across multiple websites or platforms (e.g., "do this in Perplexity then open ChatGPT... and make report in Grok"), you MUST physically navigate the browser to each site, enter the corresponding input/prompt, extract the response, and carry that context to the next site in the exact order requested. Do NOT skip any site or try to generate the final output early on a previous site.
`;
  }

  return `You are a browser subagent executing a task in the browser.
Your goal is to achieve this TASK: "${task}"

AVAILABLE TOOLS:
${toolsInfo}
${candidateBlock}
${domainSkillBlock}
${guidelinesBlock}

ROLLING HISTORY:
${historyBlock}

CURRENT OBSERVATION:
URL: ${obs.url}
Title: ${obs.title}
Text: ${obs.pageText?.slice(0, 8000)}

FIELDS:
${JSON.stringify(compactFieldsCapped)}

BUTTONS:
${JSON.stringify(compactButtons)}
${elementListBlock}
${ariaBlock}
${consoleBlock}
FORMAT (Return ONLY raw JSON - no markdown wrapper, no explanation):
{"reasoning":"...","tool":"navigate|click|click_blank|fill|select|check|upload|scroll|hover|press|wait|read|screenshot|extract|handle_login|signature|fill_form|finish","args":{...},"status":"continue|done|blocked"}
When finishing an extraction/report task, put the full deliverable in args.report, e.g. {"reasoning":"...","tool":"finish","args":{"report":"1. Role — Company — link ..."},"status":"done"}
`;
}
