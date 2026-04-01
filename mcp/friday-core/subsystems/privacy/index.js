/**
 * Privacy Subsystem — PII scrubbing, rehydration, and stats
 *
 * Ported from nexus-os privacy-shield.ts. Contains the PII pattern engine,
 * FNV-1a hashing, scrub/rehydrate functions, and MCP tool registrations.
 *
 * Tools: privacy_scrub, privacy_rehydrate, privacy_stats, privacy_reset
 */

import { z } from 'zod';
import { Subsystem } from '../../core/subsystem.js';

// --- PII Pattern Definitions ---

const PII_PATTERNS = {
  SECRET: [
    /AKIA[0-9A-Z]{16}/g,                                    // AWS access key
    /ghp_[a-zA-Z0-9]{36}/g,                                 // GitHub PAT
    /sk-[a-zA-Z0-9]{20,}/g,                                 // OpenAI / Stripe secret
    /sk-ant-[a-zA-Z0-9-]{20,}/g,                            // Anthropic key
    /xoxb-[0-9]+-[0-9]+-[a-zA-Z0-9]+/g,                    // Slack bot token
    /AIza[0-9A-Za-z_-]{35}/g,                               // Google API key
    /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, // JWT
    /(?:api[_-]?key|apikey|token|secret|password|passwd|credential)[\s]*[=:]\s*['"]?([a-zA-Z0-9_\-./+=]{16,})['"]?/gi
  ],
  CREDIT_CARD: [
    /\b4[0-9]{12}(?:[0-9]{3})?\b/g,       // Visa
    /\b5[1-5][0-9]{14}\b/g,               // Mastercard
    /\b3[47][0-9]{13}\b/g,                // Amex
    /\b6(?:011|5[0-9]{2})[0-9]{12}\b/g    // Discover
  ],
  SSN: [
    /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g
  ],
  EMAIL: [
    /\b[a-zA-Z0-9._%+-]{1,64}@[a-zA-Z0-9.-]{1,253}\.[a-zA-Z]{2,}\b/g
  ],
  PHONE: [
    /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g
  ],
  IP: [
    /\b(?!127\.0\.0\.1|192\.168\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.)(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g
  ],
  PATH: [] // Populated dynamically with username
};

// --- FNV-1a hash for deterministic session-scoped placeholders ---

function fnv1a(str, seed) {
  let hash = 2166136261 ^ seed;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- Scrub / Rehydrate ---

export function scrubPii(text, nonce, shield) {
  let result = text;
  const nonceSeed = parseInt(nonce.slice(0, 8), 16);

  // Add username-based path patterns
  const username = process.env.USERNAME || process.env.USER || '';
  if (username) {
    PII_PATTERNS.PATH = [
      new RegExp(`[A-Za-z]:\\\\(?:Users|users)\\\\${escapeRegex(username)}\\\\[^\\s"']+`, 'g'),
      new RegExp(`/(?:home|Users)/${escapeRegex(username)}/[^\\s"']+`, 'g')
    ];
  }

  // Process in order: specific to broad (secrets first, names last)
  const categoryOrder = ['SECRET', 'CREDIT_CARD', 'SSN', 'EMAIL', 'PHONE', 'IP', 'PATH'];

  for (const category of categoryOrder) {
    const patterns = PII_PATTERNS[category] || [];
    for (const pattern of patterns) {
      // Reset regex lastIndex
      pattern.lastIndex = 0;
      result = result.replace(pattern, (match) => {
        const hash = fnv1a(match, nonceSeed);
        const placeholder = `\u00abPII:${category}:${hash}\u00bb`;
        shield.storePiiMapping(placeholder, match, category);
        return placeholder;
      });
    }
  }

  return result;
}

export function rehydratePii(text, shield) {
  return text.replace(/\u00abPII:[A-Z_]+:[0-9a-f]+\u00bb/g, (placeholder) => {
    const mapping = shield.getPiiMapping(placeholder);
    return mapping ? mapping.original : placeholder;
  });
}

// --- Subsystem ---

export class PrivacySubsystem extends Subsystem {
  constructor(deps) {
    super('privacy', deps);
  }

  registerTools(server) {
    const vault = this.vault;

    server.tool('privacy_scrub',
      'Scrub PII from text using the Privacy Shield. Returns scrubbed text.',
      { text: z.string().describe('Text to scrub for PII') },
      async ({ text }) => {
        const shield = vault.privacyShield;
        const nonce = shield.getNonce();
        const scrubbed = scrubPii(text, nonce, shield);
        return { content: [{ type: 'text', text: JSON.stringify({ scrubbed, stats: shield.getStats() }, null, 2) }] };
      }
    );

    server.tool('privacy_rehydrate',
      'Restore PII in text using stored mappings.',
      { text: z.string().describe('Text with PII placeholders to restore') },
      async ({ text }) => {
        const shield = vault.privacyShield;
        const restored = rehydratePii(text, shield);
        return { content: [{ type: 'text', text: JSON.stringify({ restored }, null, 2) }] };
      }
    );

    server.tool('privacy_stats',
      'Get Privacy Shield statistics for this session.',
      {},
      async () => {
        const stats = vault.privacyShield.getStats();
        return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
      }
    );

    server.tool('privacy_reset',
      'Reset Privacy Shield state (destroy all PII mappings).',
      {},
      async () => {
        vault.privacyShield.reset();
        return { content: [{ type: 'text', text: '{"success": true}' }] };
      }
    );
  }
}
