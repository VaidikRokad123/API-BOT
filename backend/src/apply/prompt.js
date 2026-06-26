export { fixUnescapedQuotes, sanitizeGptJson } from '../subagent/ai-json.js';

export function parsePhoneNumber(profile) {
  let phone = String(profile.phone || '').trim();
  let countryCode = profile.phoneCountryCode;
  let digits = profile.phoneNumberDigits;

  if (!phone) {
    return {
      phoneCountryCode: countryCode || 'United States',
      phoneNumberDigits: digits || '',
      phone: ''
    };
  }

  const allDigits = phone.replace(/\D/g, '');

  if (!countryCode || !digits) {
    if (phone.startsWith('+')) {
      const codes = [
        { code: '91', country: 'India' },
        { code: '1', country: 'United States' },
        { code: '44', country: 'United Kingdom' },
        { code: '61', country: 'Australia' },
        { code: '49', country: 'Germany' },
        { code: '33', country: 'France' },
        { code: '81', country: 'Japan' },
        { code: '86', country: 'China' },
        { code: '7', country: 'Russia' },
        { code: '55', country: 'Brazil' },
        { code: '34', country: 'Spain' },
        { code: '39', country: 'Italy' },
        { code: '92', country: 'Pakistan' },
        { code: '880', country: 'Bangladesh' },
        { code: '62', country: 'Indonesia' },
        { code: '65', country: 'Singapore' },
      ];
      let matched = null;
      // Match longer codes first
      const sortedCodes = [...codes].sort((a, b) => b.code.length - a.code.length);
      for (const item of sortedCodes) {
        if (allDigits.startsWith(item.code)) {
          matched = item;
          break;
        }
      }

      if (matched) {
        countryCode = countryCode || matched.country;
        digits = digits || allDigits.slice(matched.code.length);
      } else {
        countryCode = countryCode || 'United States';
        digits = digits || allDigits;
      }
    } else {
      if (allDigits.length === 10) {
        countryCode = countryCode || 'United States';
        digits = digits || allDigits;
      } else if (allDigits.length === 11 && allDigits.startsWith('1')) {
        countryCode = countryCode || 'United States';
        digits = digits || allDigits.slice(1);
      } else if (allDigits.length === 12 && allDigits.startsWith('91')) {
        countryCode = countryCode || 'India';
        digits = digits || allDigits.slice(2);
      } else {
        countryCode = countryCode || 'United States';
        digits = digits || allDigits;
      }
    }
  }

  return {
    phoneCountryCode: countryCode,
    phoneNumberDigits: digits,
    phone: phone
  };
}

function isPhoneField(f) {
  if (f.type === 'tel') return true;
  const label = (f.label || '').toLowerCase();
  const hint = (f.hint || '').toLowerCase();
  const placeholder = (f.placeholder || '').toLowerCase();
  const selector = (f.selector || '').toLowerCase();
  const searchTerms = ['phone', 'mobile', 'tel', 'contact number', 'telephone', 'facsimile'];
  return searchTerms.some(term => 
    label.includes(term) || 
    hint.includes(term) || 
    placeholder.includes(term) || 
    selector.includes(term)
  );
}

function isPhonePrefixOnly(val) {
  const clean = String(val || '').trim();
  return /^\+\d{1,4}[-\s]*$/.test(clean) || clean === '+';
}

export function buildAgentPrompt(profile, pageState, step, research = null) {
  const [firstName, ...rest] = (profile.name || '').split(' ');
  const lastName = rest.join(' ');

  const parsedPhone = parsePhoneNumber(profile);

  const compactProfile = {
    // Identity
    name: profile.name,
    firstName,
    lastName,
    email: profile.email,
    phone: parsedPhone.phone,
    phoneCountryCode: parsedPhone.phoneCountryCode,
    phoneNumberDigits: parsedPhone.phoneNumberDigits,
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
  const isPlaceholderLike = (val) => {
    const v = String(val || '').trim()
      .replace(/^\d+\s+match(?:es)?\s+found\.?\s*/i, '')
      .replace(/^\d+\s+result(?:s)?\s*\.?\s*/i, '')
      .replace(/^no\s+results?\.?\s*/i, '')
      .trim();
    return !v || /^(?:[-–—]+\s*)?(?:select|choose|pick|search|please\s+(?:select|choose)|none\s*selected|select\s+an?\s+option|select\s+one|type\s+to\s+search)(?:\s*\.{3}|…)?$/i.test(v);
  };

  const actionableFields = pageState.fields.filter(f => {
    if (f.disabled) return false;
    if (f.type === 'radio') {
      const group = f.groupName && pageState.checkboxGroups?.[f.groupName];
      if (group?.some(option => option.checked)) return false;
      return !f.checked;
    }
    if (f.type === 'checkbox') return !f.checked;
    // For select/dropdown: also treat placeholder-like values as empty
    if (f.type === 'select') return isPlaceholderLike(f.currentValue);
    if (String(f.currentValue || '').trim()) {
      if (isPhoneField(f) && isPhonePrefixOnly(f.currentValue)) {
        // Keep phone inputs that only have a country prefix (like "+91")
      } else {
        return false;
      }
    }
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
    if (f.hint) compact.hint = f.hint;
    if (f.question) compact.question = f.question;
    if (f.currentValue && String(f.currentValue).trim()) {
      compact.value = f.currentValue;
    }
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
- Skip fields that already have a currentValue (unless radio/checkbox, or phone fields containing only country prefixes like "+91" or "+1").
- Fill ALL empty required fields before clicking Submit/Next.
- upload when any file-type field is present. signature when canvas present.
- Click Submit/Next/Continue LAST after filling all fields on the current section.
- status "done" is allowed ONLY when the page explicitly says the application was submitted/received. Seeing a Submit button means it is NOT done; click that button after completing the fields.

PROFILE FIELD MAPPING (use these answers for corresponding form questions):
- "Preferred First Name" / "First Name" → firstName
- "Preferred Last Name" / "Last Name" → lastName
- "Is your legal name the same" → legalNameSameAsPreferred ("Yes")
- "Email" → email
- "Phone number" (digits only, no country code) → phoneNumberDigits (if there is a separate Country Code dropdown); OR use full phone number with country code (e.g. +15551234567 or +911234567890) if it is a single standalone phone field.
- "Phone country code" / "Country code" dropdown → phoneCountryCode ("United States" or candidate's country name)

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
