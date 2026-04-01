/**
 * Firecrawl Connector -- Web search, scraping, and crawling
 *
 * Ported from nexus-os: connectors/firecrawl.ts (320 lines)
 * Stripped of: settingsManager, privacyShield, Electron.
 * Adapted to: vault-based API key retrieval.
 *
 * Three tools:
 *   - web_search: Search the internet
 *   - web_scrape: Extract content from a URL as markdown
 *   - web_crawl:  Crawl an entire website
 */

import * as https from 'node:https';

const API_BASE = 'api.firecrawl.dev';
const API_VERSION = 'v2';
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_CONTENT_CHARS = 15_000;
const MAX_SNIPPET_CHARS = 1_500;
const CRAWL_POLL_INTERVAL_MS = 3_000;
const CRAWL_MAX_WAIT_MS = 120_000;

function truncate(text, maxLen) {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + `\n\n...[truncated, ${text.length} chars total]`;
}

function ok(text) { return { result: text.trim() || '(no output)' }; }
function fail(msg) { return { error: msg }; }

function getApiKey(vault) {
  if (!vault) return null;
  try {
    const keys = vault.read('api-keys');
    return keys?.firecrawl || null;
  } catch { return null; }
}

function apiRequest(method, apiPath, apiKey, body) {
  return new Promise((resolve, reject) => {
    if (!apiKey) { reject(new Error('Firecrawl API key not configured. Store it in vault under api-keys.firecrawl')); return; }
    const postData = body ? JSON.stringify(body) : undefined;
    const req = https.request({
      hostname: API_BASE, port: 443, path: `/${API_VERSION}${apiPath}`, method,
      headers: {
        'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
      },
      timeout: REQUEST_TIMEOUT_MS,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk.toString(); });
      res.on('end', () => {
        try { resolve({ status: res.statusCode || 0, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode || 0, data: { raw: data } }); }
      });
    });
    req.on('error', (err) => reject(new Error(`Firecrawl request failed: ${err.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error('Firecrawl request timed out')); });
    if (postData) req.write(postData);
    req.end();
  });
}

// -- Tool Implementations --

async function webSearch(args, apiKey) {
  const query = typeof args.query === 'string' ? args.query : '';
  if (!query) return 'ERROR: search query is required.';
  const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 20);
  const { status, data } = await apiRequest('POST', '/search', apiKey, {
    query, limit, scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
  });
  if (status === 401) return 'ERROR: Firecrawl API key is invalid.';
  if (status === 429) return 'ERROR: Rate limit exceeded.';
  if (status !== 200 || !data.success) return `ERROR: Search failed (${status}): ${data.error || ''}`;
  const results = (data.data || []).map((r, i) => {
    const title = r.title || r.metadata?.title || 'Untitled';
    const url = r.url || r.metadata?.sourceURL || '';
    const snippet = truncate(r.markdown || r.description || r.metadata?.description || '', MAX_SNIPPET_CHARS);
    return `### ${i + 1}. ${title}\n**URL:** ${url}\n\n${snippet}`;
  });
  if (results.length === 0) return `No results found for: "${query}"`;
  return `## Search Results for: "${query}"\n\n${results.join('\n\n---\n\n')}`;
}

async function webScrape(args, apiKey) {
  const url = typeof args.url === 'string' ? args.url : '';
  if (!url) return 'ERROR: URL is required.';
  const onlyMainContent = args.onlyMainContent !== false;
  const { status, data } = await apiRequest('POST', '/scrape', apiKey, { url, formats: ['markdown'], onlyMainContent });
  if (status === 401) return 'ERROR: API key invalid.';
  if (status === 429) return 'ERROR: Rate limit exceeded.';
  if (status !== 200 || !data.success) return `ERROR: Scrape failed (${status}): ${data.error || ''}`;
  const pageData = data.data || {};
  const title = pageData.metadata?.title || 'Untitled';
  const sourceUrl = pageData.metadata?.sourceURL || url;
  const markdown = truncate(pageData.markdown || '(no content)', MAX_CONTENT_CHARS);
  return `## ${title}\n**URL:** ${sourceUrl}\n\n${markdown}`;
}

async function webCrawl(args, apiKey) {
  const url = typeof args.url === 'string' ? args.url : '';
  if (!url) return 'ERROR: URL is required.';
  const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 20);
  const startResult = await apiRequest('POST', '/crawl', apiKey, {
    url, limit, scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
  });
  if (startResult.status !== 200 || !startResult.data.success) return `ERROR: Crawl failed (${startResult.status}): ${startResult.data.error || ''}`;
  const jobId = startResult.data.id;
  if (!jobId) return 'ERROR: No crawl job ID returned.';

  const startTime = Date.now();
  while (Date.now() - startTime < CRAWL_MAX_WAIT_MS) {
    await new Promise(r => setTimeout(r, CRAWL_POLL_INTERVAL_MS));
    const pollResult = await apiRequest('GET', `/crawl/${jobId}`, apiKey);
    if (pollResult.data.status === 'completed') {
      const pages = pollResult.data.data || [];
      if (!Array.isArray(pages) || pages.length === 0) return `Crawl completed but no pages extracted from: ${url}`;
      const formatted = pages.map((page, i) => {
        const title = page.metadata?.title || `Page ${i + 1}`;
        const pageUrl = page.metadata?.sourceURL || '';
        return `### ${i + 1}. ${title}\n**URL:** ${pageUrl}\n\n${truncate(page.markdown || '', MAX_SNIPPET_CHARS * 2)}`;
      });
      return `## Crawl Results for: ${url}\n**Pages crawled:** ${pages.length}\n\n${formatted.join('\n\n---\n\n')}`;
    }
    if (pollResult.data.status === 'failed') return `ERROR: Crawl failed: ${pollResult.data.error || 'Unknown'}`;
  }
  return `Crawl job ${jobId} still running after ${CRAWL_MAX_WAIT_MS / 1000}s.`;
}

// -- Exports --

export function getTools() {
  return [
    { name: 'web_search', description: 'Search the internet for information, news, docs', params: { query: 'string', limit: 'number (1-20)' }, safety_level: 'read_only', category: 'research' },
    { name: 'web_scrape', description: 'Extract web page content as clean markdown', params: { url: 'string', onlyMainContent: 'boolean' }, safety_level: 'read_only', category: 'research' },
    { name: 'web_crawl', description: 'Crawl a website starting from a URL (async, up to 2 min)', params: { url: 'string', limit: 'number (1-20)' }, safety_level: 'read_only', category: 'research' },
  ];
}

export async function execute(toolName, args, vault) {
  const apiKey = getApiKey(vault);
  try {
    switch (toolName) {
      case 'web_search': return ok(await webSearch(args, apiKey));
      case 'web_scrape': return ok(await webScrape(args, apiKey));
      case 'web_crawl':  return ok(await webCrawl(args, apiKey));
      default: return fail(`Unknown firecrawl tool: ${toolName}`);
    }
  } catch (err) { return fail(`firecrawl "${toolName}" failed: ${err.message}`); }
}

export async function detect(vault) {
  const key = getApiKey(vault);
  return !!key && key.length > 0;
}

export const name = 'firecrawl';
export const description = 'Web search, page scraping, and site crawling via Firecrawl API';
