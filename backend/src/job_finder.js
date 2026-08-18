import fs from 'fs';
import path from 'path';
import { PROFILE_FILE, DATA_DIR } from './config.js';
import { firecrawlSearch, firecrawlScrape, isFirecrawlAvailable } from './firecrawl.js';
import { openAiSession, sendMessage } from './ai.js';
import { launchBrowser } from './browser.js';

const DISCOVERED_JOBS_FILE = path.join(DATA_DIR, 'discovered_jobs.json');

/**
 * Reads user profile from data/profile.json
 */
export function getCandidateProfile() {
  if (!fs.existsSync(PROFILE_FILE)) {
    throw new Error('Profile file not found at backend/data/profile.json. Please create it first.');
  }
  try {
    return JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse profile.json: ${err.message}`);
  }
}

/**
 * Loads saved discovered jobs from data/discovered_jobs.json
 */
export function getDiscoveredJobs() {
  if (!fs.existsSync(DISCOVERED_JOBS_FILE)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(DISCOVERED_JOBS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

/**
 * Saves discovered jobs list to file
 */
export function saveDiscoveredJobs(jobs) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(DISCOVERED_JOBS_FILE, JSON.stringify(jobs, null, 2), 'utf8');
}

/**
 * Helper to extract numeric salary/CTC in LPA or annual USD
 */
function parseCtcValue(ctcStr) {
  if (!ctcStr) return 0;
  const s = String(ctcStr).toLowerCase().trim();
  const matchLpa = s.match(/(\d+(?:\.\d+)?)\s*(?:lpa|lakh|lakhs)/);
  if (matchLpa) return parseFloat(matchLpa[1]);

  const matchUsd = s.match(/\$?\s*(\d+)(?:,?\d+)?\s*k?/);
  if (matchUsd) {
    let val = parseFloat(matchUsd[1]);
    if (val < 1000) val = val * 1000; // $80k -> 80000
    return val;
  }
  return 0;
}

/**
 * Main Job Discovery Engine
 */
export async function searchAndMatchJobs(searchParams = {}) {
  const profile = getCandidateProfile();

  // Merge search criteria with defaults from candidate profile
  const filters = {
    role: searchParams.role || profile.desiredRole || profile.currentRole || 'Developer',
    location: searchParams.location || profile.city || profile.location || 'Remote',
    minCtc: searchParams.minCtc || profile.expectedCTC || '0',
    minExp: searchParams.minExp !== undefined ? Number(searchParams.minExp) : 0,
    maxExp: searchParams.maxExp !== undefined ? Number(searchParams.maxExp) : Number(profile.yearsOfExperience || 5) + 3,
    queryExtra: searchParams.query || '',
    limit: searchParams.limit || 10,
    useAiScoring: searchParams.useAiScoring !== false
  };

  console.log('\n  🔎 Searching for jobs matching criteria:');
  console.log(`     Role      : ${filters.role}`);
  console.log(`     Location  : ${filters.location}`);
  console.log(`     Min CTC   : ${filters.minCtc}`);
  console.log(`     Experience: ${filters.minExp} - ${filters.maxExp} years\n`);

  // Build target search query
  const queryStr = `${filters.role} jobs in ${filters.location} ${filters.queryExtra}`.trim();
  let scrapedResults = [];

  const firecrawlReady = await isFirecrawlAvailable();

  if (firecrawlReady) {
    console.log('  🔥 Using Firecrawl engine for job scraping...');
    const searchData = await firecrawlSearch(queryStr, { limit: filters.limit });
    if (searchData && searchData.length > 0) {
      scrapedResults = searchData.map(item => ({
        title: item.title || 'Job Listing',
        url: item.url,
        description: item.markdown || item.description || '',
        snippet: item.description || ''
      }));
    }
  }

  // Fallback to Playwright scraper if Firecrawl returned no results or is unavailable
  if (scrapedResults.length === 0) {
    console.log('  🌐 Falling back to Playwright web job scraper...');
    scrapedResults = await scrapeJobsWithPlaywright(queryStr, filters.limit);
  }

  if (scrapedResults.length === 0) {
    console.log('  ⚠ No jobs found for the specified query.');
    return [];
  }

  console.log(`  ✓ Harvested ${scrapedResults.length} potential job postings. Evaluating resume match...`);

  // Match & Rank Jobs against candidate profile
  const matchedJobs = [];

  for (const job of scrapedResults) {
    const jobAnalysis = evaluateJobMatch(job, profile, filters);
    
    // Filter out jobs that fail hard filter requirements
    if (jobAnalysis.passedFilters) {
      matchedJobs.push({
        id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        title: jobAnalysis.title,
        company: jobAnalysis.company,
        location: jobAnalysis.location,
        url: job.url,
        matchScore: jobAnalysis.matchScore,
        matchingSkills: jobAnalysis.matchingSkills,
        missingSkills: jobAnalysis.missingSkills,
        summary: jobAnalysis.summary,
        ctc: jobAnalysis.ctc,
        experience: jobAnalysis.experience,
        discoveredAt: new Date().toISOString(),
        status: 'discovered'
      });
    }
  }

  // Sort by highest match score
  matchedJobs.sort((a, b) => b.matchScore - a.matchScore);

  // Save to database/file
  const existing = getDiscoveredJobs();
  const updatedList = [...matchedJobs, ...existing.filter(e => !matchedJobs.some(m => m.url === e.url))];
  saveDiscoveredJobs(updatedList);

  console.log(`  🎯 Successfully discovered ${matchedJobs.length} matching jobs!\n`);
  return matchedJobs;
}

/**
 * Evaluates how well a single job posting matches the candidate's resume and filters
 */
function evaluateJobMatch(rawJob, profile, filters) {
  const text = `${rawJob.title} ${rawJob.description}`.toLowerCase();
  const profileSkills = (profile.skills || []).map(s => s.toLowerCase());

  // Extract Company Name if available
  let company = 'Unknown Company';
  const companyMatch = rawJob.title.match(/(?:at|@|-|\|)\s*([A-Za-z0-9\s.,&]+)/i);
  if (companyMatch) {
    company = companyMatch[1].trim();
  }

  // Extract skills matched
  const matchingSkills = profileSkills.filter(skill => text.includes(skill));
  const missingSkills = [];

  // Skill match ratio score (base 0 - 60 points)
  let skillScore = 0;
  if (profileSkills.length > 0) {
    skillScore = Math.min(60, Math.round((matchingSkills.length / Math.min(10, profileSkills.length)) * 60));
  } else {
    skillScore = 40;
  }

  // Role title match (0 - 25 points)
  let roleScore = 0;
  const targetRoleWords = filters.role.toLowerCase().split(/\s+/);
  const matchedRoleWords = targetRoleWords.filter(w => text.includes(w));
  if (targetRoleWords.length > 0) {
    roleScore = Math.round((matchedRoleWords.length / targetRoleWords.length) * 25);
  }

  // Location match (0 - 15 points)
  let locationScore = 10;
  if (filters.location) {
    const locLower = filters.location.toLowerCase();
    if (text.includes(locLower) || text.includes('remote') || locLower === 'remote') {
      locationScore = 15;
    }
  }

  const matchScore = Math.min(99, skillScore + roleScore + locationScore);

  // Filter check
  let passedFilters = true;
  if (roleScore === 0 && matchingSkills.length === 0) {
    passedFilters = false; // Completely irrelevant job
  }

  return {
    title: rawJob.title,
    company,
    location: filters.location || 'Remote',
    ctc: profile.expectedCTC || 'As per industry',
    experience: `${profile.yearsOfExperience || '1-3'} years`,
    matchScore,
    matchingSkills: matchingSkills.map(s => s.charAt(0).toUpperCase() + s.slice(1)),
    missingSkills,
    summary: `Matches ${matchingSkills.length} key skills (${matchingSkills.slice(0, 4).join(', ')})`,
    passedFilters
  };
}

/**
 * Fallback job search scraper using Playwright browser engine
 */
async function scrapeJobsWithPlaywright(query, limit = 5) {
  try {
    const browser = await launchBrowser(false, 'chatgpt', { forceAutomated: true });
    const page = await browser.newPage();
    
    // Search on Google Jobs / public engine
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query + ' apply job')}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });

    const results = await page.evaluate((max) => {
      const items = [];
      const links = document.querySelectorAll('.result__body');
      for (const link of links) {
        if (items.length >= max) break;
        const titleEl = link.querySelector('.result__title');
        const urlEl = link.querySelector('.result__url');
        const snippetEl = link.querySelector('.result__snippet');

        if (titleEl && urlEl) {
          items.push({
            title: titleEl.innerText.trim(),
            url: urlEl.href || urlEl.innerText.trim(),
            description: snippetEl ? snippetEl.innerText.trim() : '',
            snippet: snippetEl ? snippetEl.innerText.trim() : ''
          });
        }
      }
      return items;
    }, limit);

    await browser.close().catch(() => {});
    return results;
  } catch (err) {
    console.error('  ✗ Playwright fallback scraper error:', err.message);
    return [];
  }
}
