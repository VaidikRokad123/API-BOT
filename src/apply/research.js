import { sendMessage } from '../ai.js';
import { sanitizeGptJson } from './prompt.js';

export async function researchJob(aiPage, jobUrl, pageText, profile) {
  console.log('\n  🔍 Researching company and role...');

  const raw = await sendMessage(aiPage, `
You are preparing a job application. Research the company and role using the job page text below, then return a JSON object.

JOB URL: ${jobUrl}

JOB PAGE TEXT:
${pageText.slice(0, 4000)}

CANDIDATE PROFILE SUMMARY:
Name: ${profile.name}
Current Role: ${profile.currentRole}
Experience: ${profile.yearsOfExperience} years
Skills: ${profile.skills.join(', ')}
City: ${profile.city}
Current CTC: ${profile.currentCTC}
Expected CTC: ${profile.expectedCTC}

TASKS:
1. Extract company name, job title, and key requirements from the page text.
2. Based on the role, location, and your knowledge — determine an appropriate expected salary to quote.
   - It should be at or slightly below market rate to maximise selection chances.
   - If you are uncertain about the range, set salaryToQuote to null.
3. Identify which of the candidate's skills best match this specific role — ordered by relevance.
4. Write a one-line positioning statement: how to present this candidate for this specific role.
5. Note any company values, mission, or tech stack mentioned that could be referenced in open-ended answers.

Return ONLY this raw JSON object — no markdown, no explanation:
{
  "companyName": "...",
  "jobTitle": "...",
  "companyContext": "brief background — product, culture, tech stack, size if known",
  "keyRequirements": ["top 5 must-have skills/qualities from JD"],
  "matchingSkills": ["candidate skills that match JD, in priority order"],
  "salaryToQuote": "e.g. 5.5 LPA  — or null if unknown",
  "salaryFallback": "As per company standard",
  "positioningStatement": "one line on how to pitch this candidate for this role",
  "companyTalkingPoints": ["specific things to mention: mission, product, values, tech"]
}
`.trim());

  try {
    const research = sanitizeGptJson(raw);
    console.log(`  ✓ Company : ${research.companyName}`);
    console.log(`  ✓ Role    : ${research.jobTitle}`);
    console.log(`  ✓ Salary  : ${research.salaryToQuote ?? research.salaryFallback}`);
    console.log(`  ✓ Skills  : ${research.matchingSkills?.slice(0, 4).join(', ')}`);
    return research;
  } catch {
    console.log('  ⚠ Research parse failed — continuing without enrichment');
    return null;
  }
}
