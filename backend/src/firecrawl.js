import dotenv from 'dotenv';
dotenv.config();

const DEFAULT_LOCAL_FIRECRAWL_URL = process.env.FIRECRAWL_BASE_URL || 'http://localhost:3002';
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || null;

/**
 * Checks if Firecrawl service is available (locally at localhost:3002 or via API key).
 */
export async function isFirecrawlAvailable() {
  try {
    const baseUrl = FIRECRAWL_API_KEY ? 'https://api.firecrawl.dev' : DEFAULT_LOCAL_FIRECRAWL_URL;
    const res = await fetch(`${baseUrl}/v1/scrape`, {
      method: 'OPTIONS',
      headers: FIRECRAWL_API_KEY ? { 'Authorization': `Bearer ${FIRECRAWL_API_KEY}` } : {}
    }).catch(() => null);

    return res !== null && (res.status < 500);
  } catch {
    return false;
  }
}

/**
 * Scrapes a single URL using Firecrawl (local or cloud).
 */
export async function firecrawlScrape(url, options = {}) {
  const isCloud = !!FIRECRAWL_API_KEY;
  const baseUrl = isCloud ? 'https://api.firecrawl.dev' : DEFAULT_LOCAL_FIRECRAWL_URL;

  const headers = {
    'Content-Type': 'application/json'
  };
  if (isCloud) {
    headers['Authorization'] = `Bearer ${FIRECRAWL_API_KEY}`;
  }

  const body = {
    url,
    formats: options.formats || ['markdown', 'extract'],
    extract: options.extractSchema ? { schema: options.extractSchema } : undefined,
    onlyMainContent: true
  };

  try {
    const res = await fetch(`${baseUrl}/v1/scrape`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Firecrawl scrape failed (${res.status}): ${errText}`);
    }

    const json = await res.json();
    return json.data || json;
  } catch (err) {
    console.warn(`[Firecrawl] Scrape failed for ${url}:`, err.message);
    return null;
  }
}

/**
 * Performs a web search and content extraction using Firecrawl Search API.
 */
export async function firecrawlSearch(query, options = {}) {
  const isCloud = !!FIRECRAWL_API_KEY;
  const baseUrl = isCloud ? 'https://api.firecrawl.dev' : DEFAULT_LOCAL_FIRECRAWL_URL;

  const headers = {
    'Content-Type': 'application/json'
  };
  if (isCloud) {
    headers['Authorization'] = `Bearer ${FIRECRAWL_API_KEY}`;
  }

  const body = {
    query,
    limit: options.limit || 10,
    scrapeOptions: {
      formats: ['markdown']
    }
  };

  try {
    const res = await fetch(`${baseUrl}/v1/search`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Firecrawl search failed (${res.status}): ${errText}`);
    }

    const json = await res.json();
    return json.data || json.results || [];
  } catch (err) {
    console.warn(`[Firecrawl] Search failed for query "${query}":`, err.message);
    return null;
  }
}
