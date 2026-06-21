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
  const [firstName, ...rest] = (profile.name || '').split(' ');
  const lastName = rest.join(' ');

  const compactProfile = {
    // Identity
    name: profile.name,
    firstName,
    lastName,
    email: profile.email,
    phone: profile.phone,
    phoneCountryCode: profile.phoneCountryCode || 'United States',
    phoneNumberDigits: profile.phoneNumberDigits || (profile.phone || '').replace(/\D/g, '').replace(/^1/, ''),
    legalNameSameAsPreferred: profile.legalNameSameAsPreferred || 'Yes',
    // Location
    address: profile.address,
    city: profile.city,
    state: profile.state,
    country: profile.country || 'United States',
    postalCode: profile.postalCode,
    // Professional
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
    // Work authorization
    workAuthorization: profile.workAuthorization || 'Yes',
    requiresSponsorship: profile.requiresSponsorship || 'No',
    // Self-identification
    gender: profile.gender || 'Prefer not to say',
    ethnicity: profile.ethnicity || 'Prefer not to say',
    veteranStatus: profile.veteranStatus || 'No',
    disabilityStatus: profile.disabilityStatus || 'No',
    armedForcesStatus: profile.armedForcesStatus || profile.militaryOrGovernmentEmployee || 'No',
    // Common candidate questions
    militaryOrGovernmentEmployee: profile.militaryOrGovernmentEmployee || 'No',
    hasNonCompete: profile.hasNonCompete || 'No',
    previouslyEmployedHere: profile.previouslyEmployedHere || 'No',
    currentlyAtSubsidiary: profile.currentlyAtSubsidiary || 'No',
    willingToRelocate: profile.willingToRelocate || 'No',
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
    if (f.disabled) return false;
    if (f.type === 'radio') {
      const group = f.groupName && pageState.checkboxGroups?.[f.groupName];
      if (group?.some(option => option.checked)) return false;
      return !f.checked;
    }
    if (f.type === 'checkbox') return !f.checked;
    if (String(f.currentValue || '').trim()) return false;
    return true;
  }).sort((a, b) => {
    const priority = field => field.required ? 0
      : field.type === 'select' ? 1
      : field.type === 'file' ? 2
      : (field.type === 'radio' || field.type === 'checkbox') ? 4
      : 3;
    return priority(a) - priority(b);
  }).slice(0, 40);  // Filled controls drop out on the next loop, revealing the rest

  // Compress each field to minimal representation
  const compactFields = actionableFields.map(f => {
    const compact = { label: f.label, type: f.type, selector: f.selector };
    if (f.required) compact.required = true;
    if (f.placeholder) compact.ph = f.placeholder;
    if (f.question) compact.question = f.question;
    if (f.type === 'select' && f.options?.length) {
      // No cap — AI must see ALL options to pick the right one (state dropdown = 50 options)
      compact.options = f.options.filter(o => !o.isPlaceholder).map(o => o.text);
    }
    if (f.type === 'select' && !f.options?.length) compact.searchable = true;
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

  // Playwright engine only — compact accessibility tree for extra context.
  // Read-only reference; still ACT using selectors from FIELDS/BUTTONS.
  const ariaBlock = pageState.ariaSnapshot
    ? `\nACCESSIBILITY TREE (role + name + state — reference only, act via FIELDS selectors):\n${pageState.ariaSnapshot}\n`
    : '';

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
${ariaBlock}
FORMAT:
{"reasoning":"...","actions":[{"type":"fill|select|check|upload|signature|click","selector":"...","value":"...","description":"..."}],"status":"continue|done|error","message":"..."}

ACTION TYPES:
- fill → text/email/tel/textarea inputs only
- select → <select> dropdowns AND custom dropdowns; value must EXACTLY match one of the options[] listed
- check → radio buttons and checkboxes (use the selector from FIELDS, not the label text)
- upload → file inputs; system auto-selects the resume path
- click → buttons, links, custom UI elements
- signature → canvas signature pads

FIELD RULES:
- NEVER use "fill" on checkbox/radio — always "check".
- NEVER use label text as a selector — always use the selector field from FIELDS[].
- For every unanswered required radio group, read its question and choose exactly one option using that option's selector.
- A radio label such as Yes/No is only the option; use its question field to decide the truthful answer.
- For select with options[]: value must be the EXACT option text shown. If the target value is not listed, pick the closest match.
- For a searchable select with no options[]: use the exact profile value; the executor will type it to load matching options.
- Skip fields that already have a currentValue (unless radio/checkbox).
- Fill ALL empty required fields before clicking Submit/Next.
- upload when any file-type field is present. signature when canvas present.
- Click Submit/Next/Continue LAST after filling all fields on the current section.
- status "done" is allowed ONLY when the page explicitly says the application was submitted/received. Seeing a Submit button means it is NOT done; click that button after completing the fields.

PROFILE FIELD MAPPING (use these answers for corresponding form questions):
- "Preferred First Name" / "First Name" → firstName
- "Preferred Last Name" / "Last Name" → lastName
- "Is your legal name the same" → legalNameSameAsPreferred ("Yes")
- "Email" → email
- "Phone number" (digits only, no country code) → phoneNumberDigits
- "Phone country code" / "Country code" dropdown → phoneCountryCode ("United States")
- "Address" / "Address Line 1" → address
- "City" → city
- "State" / "Province" → state (select from dropdown options[])
- "Country" / "Country of residence" → country
- "Postal Code" / "Zip Code" → postalCode
- "LinkedIn" → linkedin
- "GitHub" → github
- "Years of experience" → yearsOfExperience
- "Salary" / "Expected salary" → expectedCTC
- "Notice period" → noticePeriod
- "Reason for leaving" / "Why are you looking" → reasonForLeaving
- "Are you legally authorized to work" → workAuthorization ("Yes")
- "Require sponsorship" / "Work visa" / "Work permit" → requiresSponsorship ("No")
- "Gender" → gender (select closest option from dropdown)
- "Ethnicity" / "Race" → ethnicity (select closest matching option)
- "Veteran status" / "Protected veteran" → veteranStatus ("No" → select "I am not a protected veteran" or equivalent)
- "Disability" / "Do you have a disability" → disabilityStatus ("No" → select "No, I don't have a disability" or equivalent)
- "U.S. Armed Forces Status" / "Military status" → armedForcesStatus ("No")
- "Member of military / government employee" → militaryOrGovernmentEmployee ("No")
- "Non-compete / NDA / non-disclosure" → hasNonCompete ("No")
- "Previously worked at [company]" / "Former employee" → previouslyEmployedHere ("No")
- "Currently employed by a subsidiary" → currentlyAtSubsidiary ("No")
- "Willing to relocate" → willingToRelocate ("No")
- "Bachelor's degree" or degree qualification questions → check education.degree field; if it matches, answer "Yes"
- "Years of experience in [X]" → compare to yearsOfExperience; answer honestly based on profile

ACKNOWLEDGMENT & CONSENT RULES:
- Any checkbox labelled "I agree", "I acknowledge", "I accept", "Yes" for terms/conditions/privacy/conduct → check it (value "Yes" or "true")
- "By checking this you agree to..." → always check
- All three acknowledgment checkboxes at the bottom of Microsoft forms → check all

LOGIN RULES:
- Login page with provider buttons → ONLY click "Sign in with Google" / "Continue with Google". NEVER click Microsoft, LinkedIn, GitHub, or Email.
- On accounts.google.com → return {"reasoning":"Google OAuth handled by system","actions":[],"status":"continue"}
- NEVER fill email/password on login pages — system handles it.
- NEVER click Back. Job SEARCH page (not application) → status "error".

JSON SAFETY:
- Escape double quotes in selectors with backslash or use single quotes: [data-testid='btn']
`.trim();
}
