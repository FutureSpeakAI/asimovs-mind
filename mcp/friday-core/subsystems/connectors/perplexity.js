/**
 * Perplexity Connector -- AI-powered search, research, and reasoning
 *
 * Ported from nexus-os: connectors/perplexity.ts (396 lines)
 * Stripped of: settingsManager, privacyShield, Electron imports.
 * Adapted to: vault-based API key retrieval, no privacy scrubbing.
 *
 * Four tools across intelligence tiers:
 *   - perplexity_search:        Fast web search (Sonar)
 *   - perplexity_research:      Deep research (Sonar Pro)
 *   - perplexity_deep_research: Multi-step investigation (Sonar Deep Research)
 *   - perplexity_reason:        Search-augmented reasoning (Sonar Reasoning Pro)
 */

import * as https from 'node:https';

const API_HOST = 'api.perplexity.ai';
const REQUEST_TIMEOUT_MS = 90_000;
const DEEP_RESEARCH_TIMEOUT_MS = 300_000;
const MAX_RESPONSE_CHARS = 20_000;

const MODELS = {
  search: 'sonar',
  research: 'sonar-pro',
  deepResearch: 'sonar-deep-research',
  reasoning: 'sonar-reasoning-pro',
};

function truncate(text, maxLen) {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + `\n\n...[truncated, ${text.length} chars total]`;
}

function ok(text) { return { result: text.trim() || '(no output)' }; }
function fail(msg) { return { error: msg }; }

async function getApiKey(vault) {
  if (!vault) return null;
  try {
    const keys = await vault.read('api-keys');
    return keys?.perplexity || null;
  } catch { return null; }
}

function apiRequest(body, apiKey, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (!apiKey) { reject(new Error('Perplexity API key not configured. Store it in vault under api-keys.perplexity')); return; }
    const postData = JSON.stringify(body);
    const req = https.request({
      hostname: API_HOST, port: 443, path: '/chat/completions', method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
      timeout: timeoutMs,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk.toString(); });
      res.on('end', () => {
        try { resolve({ status: res.statusCode || 0, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode || 0, data: { raw: data } }); }
      });
    });
    req.on('error', (err) => reject(new Error(`Perplexity request failed: ${err.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error('Perplexity request timed out')); });
    req.write(postData);
    req.end();
  });
}

function formatCitations(citations) {
  if (!citations?.length) return '';
  return '\n\n---\n**Sources:**\n' + citations.map((url, i) => `[${i + 1}] ${url}`).join('\n');
}

function formatRelated(questions) {
  if (!questions?.length) return '';
  return '\n\n**Related questions:**\n' + questions.map((q, i) => `${i + 1}. ${q}`).join('\n');
}

// -- Tool Implementations --

async function perplexitySearch(args, apiKey) {
  const query = typeof args.query === 'string' ? args.query : '';
  if (!query) return 'ERROR: search query is required.';
  const body = { model: MODELS.search, messages: [{ role: 'system', content: 'Be precise and concise.' }, { role: 'user', content: query }], return_citations: true, return_related_questions: true };
  if (args.domains && Array.isArray(args.domains)) body.search_domain_filter = args.domains;
  if (typeof args.recency === 'string' && ['month', 'week', 'day', 'hour'].includes(args.recency)) body.search_recency_filter = args.recency;
  const { status, data } = await apiRequest(body, apiKey);
  if (status === 401) return 'ERROR: Perplexity API key is invalid.';
  if (status === 429) return 'ERROR: Perplexity rate limit exceeded.';
  if (status !== 200) return `ERROR: Search failed (${status}): ${data.error?.message || JSON.stringify(data).slice(0, 500)}`;
  const content = data.choices?.[0]?.message?.content || '(no content)';
  return truncate(`## Search: "${query}"\n\n${content}${formatCitations(data.citations)}${formatRelated(data.related_questions)}`, MAX_RESPONSE_CHARS);
}

async function perplexityResearch(args, apiKey) {
  const query = typeof args.query === 'string' ? args.query : '';
  if (!query) return 'ERROR: research query is required.';
  const body = { model: MODELS.research, messages: [{ role: 'system', content: 'Provide thorough, well-structured analysis with multiple perspectives. Cite all sources.' }, { role: 'user', content: query }], return_citations: true, search_context_size: 'high' };
  if (args.domains && Array.isArray(args.domains)) body.search_domain_filter = args.domains;
  if (typeof args.recency === 'string') body.search_recency_filter = args.recency;
  const { status, data } = await apiRequest(body, apiKey);
  if (status === 401) return 'ERROR: API key invalid.';
  if (status === 429) return 'ERROR: Rate limit exceeded.';
  if (status !== 200) return `ERROR: Research failed (${status}): ${data.error?.message || ''}`;
  const content = data.choices?.[0]?.message?.content || '(no content)';
  return truncate(`## Research: "${query}"\n\n${content}${formatCitations(data.citations)}`, MAX_RESPONSE_CHARS);
}

async function perplexityDeepResearch(args, apiKey) {
  const query = typeof args.query === 'string' ? args.query : '';
  if (!query) return 'ERROR: query is required.';
  const body = { model: MODELS.deepResearch, messages: [{ role: 'system', content: 'Conduct a thorough, multi-step investigation. Cross-reference sources and provide confidence levels.' }, { role: 'user', content: query }], return_citations: true };
  const { status, data } = await apiRequest(body, apiKey, DEEP_RESEARCH_TIMEOUT_MS);
  if (status !== 200) return `ERROR: Deep research failed (${status}): ${data.error?.message || ''}`;
  const content = data.choices?.[0]?.message?.content || '(no content)';
  return truncate(`## Deep Research: "${query}"\n\n${content}${formatCitations(data.citations)}`, MAX_RESPONSE_CHARS);
}

async function perplexityReason(args, apiKey) {
  const query = typeof args.query === 'string' ? args.query : '';
  if (!query) return 'ERROR: reasoning query is required.';
  const body = { model: MODELS.reasoning, messages: [{ role: 'system', content: 'Think step by step. Search for information, then reason methodically. Cite sources.' }, { role: 'user', content: query }], return_citations: true };
  const { status, data } = await apiRequest(body, apiKey, DEEP_RESEARCH_TIMEOUT_MS);
  if (status !== 200) return `ERROR: Reasoning failed (${status}): ${data.error?.message || ''}`;
  const content = data.choices?.[0]?.message?.content || '(no content)';
  return truncate(`## Reasoning: "${query}"\n\n${content}${formatCitations(data.citations)}`, MAX_RESPONSE_CHARS);
}

// -- Exports --

export function getTools() {
  return [
    { name: 'perplexity_search', description: 'Fast AI-powered web search with citations (Sonar)', params: { query: 'string', domains: 'string[]', recency: 'hour|day|week|month' }, safety_level: 'read_only', category: 'research' },
    { name: 'perplexity_research', description: 'Comprehensive AI research with deep source analysis (Sonar Pro)', params: { query: 'string', domains: 'string[]', recency: 'string' }, safety_level: 'read_only', category: 'research' },
    { name: 'perplexity_deep_research', description: 'Multi-step deep investigation (up to 5 min, Sonar Deep Research)', params: { query: 'string' }, safety_level: 'read_only', category: 'research' },
    { name: 'perplexity_reason', description: 'Search-augmented step-by-step reasoning (Sonar Reasoning Pro)', params: { query: 'string' }, safety_level: 'read_only', category: 'research' },
  ];
}

export async function execute(toolName, args, vault) {
  const apiKey = await getApiKey(vault);
  try {
    switch (toolName) {
      case 'perplexity_search':        return ok(await perplexitySearch(args, apiKey));
      case 'perplexity_research':      return ok(await perplexityResearch(args, apiKey));
      case 'perplexity_deep_research': return ok(await perplexityDeepResearch(args, apiKey));
      case 'perplexity_reason':        return ok(await perplexityReason(args, apiKey));
      default: return fail(`Unknown perplexity tool: ${toolName}`);
    }
  } catch (err) { return fail(`perplexity "${toolName}" failed: ${err.message}`); }
}

export async function detect(vault) {
  const key = await getApiKey(vault);
  return !!key && key.length > 0;
}

export const name = 'perplexity';
export const description = 'AI-powered search, research, deep investigation, and reasoning via Perplexity API';
