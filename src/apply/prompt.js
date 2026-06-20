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

export function buildAgentPrompt(profile, pageState, step, research = null) {
  // Build a COMPACT profile — exclude the full resume text to save tokens
  const compactProfile = {
    name: profile.name,
    email: profile.email,
    phone: profile.phone,
    city: profile.city,
    linkedin: profile.linkedin,
    github: profile.github,
    portfolio: profile.portfolio,
    yearsOfExperience: profile.yearsOfExperience,
    currentRole: profile.currentRole,
    currentCTC: profile.currentCTC,
    expectedCTC: profile.expectedCTC,
    noticePeriod: profile.noticePeriod,
    reasonForLeaving: profile.reasonForLeaving,
    skills: profile.skills,
    education: profile.education,
    resumeSummary: (profile.resume || '').slice(0, 800),  // first 800 chars only
  };

  const researchBlock = research ? `
JOB RESEARCH:
Company: ${research.companyName} | Role: ${research.jobTitle}
Context: ${research.companyContext?.slice(0, 200)}
Key Reqs: ${research.keyRequirements?.join(', ')}
Matched Skills: ${research.matchingSkills?.join(', ')}
Salary: ${research.salaryToQuote ?? research.salaryFallback}
Positioning: ${research.positioningStatement?.slice(0, 200)}
` : '';

  // Compress fields: only include fields that NEED action
  const actionableFields = pageState.fields.filter(f => {
    // Skip fields that already have a value (unless they're unchecked checkboxes/radios)
    if (f.type !== 'checkbox' && f.type !== 'radio' && f.currentValue && f.currentValue.trim()) return false;
    // Skip disabled fields
    if (f.disabled) return false;
    return true;
  }).slice(0, 40);  // Cap at 40 actionable fields

  // Compress each field to minimal representation
  const compactFields = actionableFields.map(f => {
    const compact = { label: f.label, type: f.type, selector: f.selector };
    if (f.required) compact.required = true;
    if (f.placeholder) compact.ph = f.placeholder;
    if (f.type === 'select' && f.options) {
      compact.options = f.options.filter(o => !o.isPlaceholder).map(o => o.text).slice(0, 20);
    }
    if ((f.type === 'checkbox' || f.type === 'radio') && f.checked) compact.checked = true;
    if (f.groupName) compact.group = f.groupName;
    return compact;
  });

  // Compress checkbox groups to just list of values
  const compactGroups = {};
  for (const [name, opts] of Object.entries(pageState.checkboxGroups || {})) {
    compactGroups[name] = opts.map(o => o.value);
  }
  const groupsBlock = Object.keys(compactGroups).length
    ? `\nCHECKBOX GROUPS:\n${JSON.stringify(compactGroups)}`
    : '';

  // Compact buttons — only include relevant ones
  const relevantButtons = pageState.buttons.filter(b =>
    !b.disabled &&
    /apply|submit|next|continue|save|upload|sign|cart/i.test(b.text)
  ).slice(0, 10);
  // If no relevant buttons found, include all non-disabled ones (capped)
  const buttonsToShow = relevantButtons.length
    ? relevantButtons
    : pageState.buttons.filter(b => !b.disabled).slice(0, 10);

  return `
You are an AI job application agent (step ${step}). Return ONLY raw JSON — no markdown.

CANDIDATE:
${JSON.stringify(compactProfile)}
${researchBlock}
PAGE: ${pageState.url}
Title: ${pageState.title}
Text: ${pageState.pageText?.slice(0, 1500)}

FIELDS (${compactFields.length} actionable):
${JSON.stringify(compactFields)}
${groupsBlock}

CANVASES: ${JSON.stringify(pageState.canvases)}

BUTTONS: ${JSON.stringify(buttonsToShow.map(b => ({ text: b.text, selector: b.selector })))}

FORMAT:
{"reasoning":"...","actions":[{"type":"fill|select|check|upload|signature|click","selector":"...","value":"...","description":"..."}],"status":"continue|done|error","message":"..."}

RULES:
- Fill ALL empty fields before clicking Next/Submit.
- select: use EXACT text from options[]. check: for checkboxes/radios. fill: for text inputs ONLY.
- NEVER use "fill" on checkbox/radio — always use "check".
- Skip already-filled fields. Check "I agree/accept" boxes.
- upload when file input present. signature when canvas present.
- Click Submit/Next LAST.
- "Thank you" or "submitted" → status "done".
- NEVER click Back. If this is a job SEARCH page (not application form) → status "error".
`.trim();
}

