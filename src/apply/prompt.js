export function fixUnescapedQuotes(jsonStr) {
  let result = '';
  let i = 0;
  while (i < jsonStr.length) {
    if (jsonStr[i] === '"') {
      let tokenStart = i;
      let tokenEnd = i + 1;
      let escaped = false;
      while (tokenEnd < jsonStr.length) {
        if (escaped) {
          escaped = false;
        } else if (jsonStr[tokenEnd] === '\\') {
          escaped = true;
        } else if (jsonStr[tokenEnd] === '"') {
          break;
        }
        tokenEnd++;
      }
      
      const token = jsonStr.slice(tokenStart + 1, tokenEnd);
      let nextCharIdx = tokenEnd + 1;
      while (nextCharIdx < jsonStr.length && /\s/.test(jsonStr[nextCharIdx])) {
        nextCharIdx++;
      }
      
      if (nextCharIdx < jsonStr.length && jsonStr[nextCharIdx] === ':') {
        result += '"' + token + '"';
        i = tokenEnd + 1;
      } else {
        let realEnd = tokenEnd;
        let foundRealEnd = false;
        while (realEnd < jsonStr.length) {
          if (jsonStr[realEnd] === '"' && (realEnd === tokenEnd || jsonStr[realEnd - 1] !== '\\')) {
            let followIdx = realEnd + 1;
            while (followIdx < jsonStr.length && /\s/.test(jsonStr[followIdx])) {
              followIdx++;
            }
            if (followIdx >= jsonStr.length || 
                jsonStr[followIdx] === ',' || 
                jsonStr[followIdx] === '}' || 
                jsonStr[followIdx] === ']') {
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
            if (valContent[j] === '"') {
              if (j === 0 || valContent[j - 1] !== '\\') {
                escapedVal += '\\"';
              } else {
                escapedVal += '"';
              }
            } else {
              escapedVal += valContent[j];
            }
          }
          result += '"' + escapedVal + '"';
          i = realEnd + 1;
        } else {
          result += '"' + token + '"';
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
  const end   = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object in GPT response');

  let src = raw.slice(start, end + 1);
  src = fixUnescapedQuotes(src);
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
- If this is a Login or Sign-In page (with buttons like "Sign in with Google", "Sign in with Microsoft", etc.), ALWAYS click the "Sign in with Google" or "Continue with Google" button. Under NO circumstances should you click Microsoft, LinkedIn, GitHub, or Email login options. Do NOT fill any email or password fields on login pages — the login system handles credentials automatically. Just click the Google button and set status "continue".
- If you are on accounts.google.com or any OAuth/SSO page, return ZERO actions and set status "continue" — the system handles Google login automatically. Do NOT type emails or passwords.
- NEVER click Back. If this is a job SEARCH page (not application/login page) → status "error".
- CRITICAL: In your JSON response, if selectors or values contain double quotes, you MUST escape them with a backslash (e.g. \"div[data-testid='btn']\") or use single quotes instead.
`.trim();
}

