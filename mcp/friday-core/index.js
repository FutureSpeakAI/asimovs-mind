#!/usr/bin/env node
/**
 * Friday Core — Modular MCP Server
 *
 * Full Agent Friday runtime — 17 subsystems:
 *
 *   Tier 0 (no deps):
 *     vault      — Encrypted state storage (AES-256-GCM)
 *     identity   — Ed25519 signing + cLaw attestation
 *     privacy    — PII scrubbing / rehydration engine
 *     ollama     — Local LLM health monitoring
 *   Tier 1:
 *     p2p        — Peer-to-peer encrypted communication (needs identity)
 *   Tier 2:
 *     llm        — Multi-provider LLM routing (needs vault, ollama)
 *     memory     — Unified memory + embeddings (needs llm)
 *     context    — Conversation context management (needs event bus)
 *     trust      — Trust scoring engine (needs vault)
 *     personality— Personality state + expression (needs vault, memory)
 *   Tier 3:
 *     agents     — Agent spawning + orchestration (needs llm, memory, trust)
 *     tools      — Dynamic tool registry (needs event bus)
 *     connectors — External service connectors (needs tools, vault)
 *     gateway    — API gateway + auth (needs trust, vault)
 *     briefing   — Daily briefing engine (needs memory, trust, context)
 *     voice      — Voice I/O pipeline (needs event bus)
 *     enterprise — Enterprise features (needs vault, event bus)
 *
 * HTTP bridge preserved for Python hook compatibility.
 * Generic /tool/:toolName endpoint lets hooks call any MCP tool via HTTP.
 * Unlock HTML page served at GET /unlock.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';

// Core modules
import { SovereignVault } from './core/vault.js';
import { initCrypto } from './core/crypto.js';
import { FridayEventBus } from './core/event-bus.js';
import { SubsystemRegistry } from './core/subsystem.js';
import { StateManager } from './core/state-manager.js';
import { Logger } from './core/logger.js';

// Subsystems — Tier 0 (no deps)
import { VaultSubsystem } from './subsystems/vault/index.js';
import { IdentitySubsystem } from './subsystems/identity/index.js';
import { PrivacySubsystem, scrubPii, rehydratePii } from './subsystems/privacy/index.js';
import { OllamaSubsystem } from './subsystems/ollama/index.js';
// Tier 1
import { P2PSubsystem } from './subsystems/p2p/index.js';
// Tier 2
import { LLMSubsystem } from './subsystems/llm/index.js';
import { MemorySubsystem } from './subsystems/memory/index.js';
import { ContextSubsystem } from './subsystems/context/index.js';
import { TrustSubsystem } from './subsystems/trust/index.js';
import { PersonalitySubsystem } from './subsystems/personality/index.js';
// Tier 3
import { AgentSubsystem } from './subsystems/agents/index.js';
import { ToolsSubsystem } from './subsystems/tools/index.js';
import { ConnectorSubsystem } from './subsystems/connectors/index.js';
import { GatewaySubsystem } from './subsystems/gateway/index.js';
import { BriefingSubsystem } from './subsystems/briefing/index.js';
import { VoiceSubsystem } from './subsystems/voice/index.js';
import { EnterpriseSubsystem } from './subsystems/enterprise/index.js';

// --- Resolve paths ---

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_ROOT || process.cwd();
const ASIMOV_DIR = path.join(PROJECT_ROOT, '.asimovs-mind');
const VAULT_DIR = path.join(ASIMOV_DIR, 'vault');

// --- Core instances ---

const vault = new SovereignVault(VAULT_DIR);
const eventBus = new FridayEventBus();
const stateManager = new StateManager(vault);
const logger = new Logger('friday');

// Shared deps object passed to every subsystem
const deps = { vault, eventBus, stateManager, logger };

// --- Subsystem registry ---

const registry = new SubsystemRegistry();

// Tier 0 — no dependencies
registry.register(new VaultSubsystem(deps));
registry.register(new IdentitySubsystem(deps));
registry.register(new PrivacySubsystem(deps));
registry.register(new OllamaSubsystem(deps));
// Tier 1
registry.register(new P2PSubsystem(deps));           // needs identity
// Tier 2
registry.register(new LLMSubsystem(deps));            // needs vault, ollama
registry.register(new MemorySubsystem(deps));          // needs llm
registry.register(new ContextSubsystem(deps));         // needs event bus
registry.register(new TrustSubsystem(deps));           // needs vault
registry.register(new PersonalitySubsystem(deps));     // needs vault, memory
// Tier 3
registry.register(new AgentSubsystem(deps));           // needs llm, memory, trust
registry.register(new ToolsSubsystem(deps));           // needs event bus
registry.register(new ConnectorSubsystem(deps));       // needs tools, vault
registry.register(new GatewaySubsystem(deps));         // needs trust, vault
registry.register(new BriefingSubsystem(deps));        // needs memory, trust, context
registry.register(new VoiceSubsystem(deps));           // needs event bus
registry.register(new EnterpriseSubsystem(deps));      // needs vault, event bus

// Inject registry reference into vault subsystem for status reporting
registry.get('vault').setRegistry(registry);

// --- MCP Server ---

const server = new McpServer({
  name: 'friday-core',
  version: '1.0.0'
});

// Register all subsystem tools on the MCP server
registry.registerAllTools(server);

// --- HTTP Bridge for Python hooks ---

let httpServer = null;
let httpPort = 0;

async function startHttpBridge() {
  return new Promise((resolve) => {
    httpServer = http.createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json');

      // Only accept localhost
      const remoteAddr = req.socket.remoteAddress;
      if (remoteAddr !== '127.0.0.1' && remoteAddr !== '::1' && remoteAddr !== '::ffff:127.0.0.1') {
        res.writeHead(403);
        res.end(JSON.stringify({ error: 'Localhost only' }));
        return;
      }

      const url = new URL(req.url, `http://localhost`);
      const route = url.pathname;

      try {
        if (route === '/status' && req.method === 'GET') {
          res.end(JSON.stringify({ vault: vault.status, meta: vault.meta }));

        } else if (route === '/read' && req.method === 'GET') {
          const key = url.searchParams.get('key');
          if (!key) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing key' })); return; }
          const result = await vault.read(key);
          res.end(JSON.stringify(result));

        } else if (route === '/write' && req.method === 'POST') {
          const body = await readBody(req);
          const { key, data } = JSON.parse(body);
          const result = await vault.write(key, data);
          res.end(JSON.stringify(result));

        } else if (route === '/append' && req.method === 'POST') {
          const body = await readBody(req);
          const { key, entry } = JSON.parse(body);
          const result = await vault.append(key, entry);
          res.end(JSON.stringify(result));

        } else if (route === '/list' && req.method === 'GET') {
          const result = await vault.listKeys();
          res.end(JSON.stringify(result));

        } else if (route === '/scrub' && req.method === 'POST') {
          const body = await readBody(req);
          const { text } = JSON.parse(body);
          const shield = vault.privacyShield;
          const scrubbed = scrubPii(text, shield.getNonce(), shield);
          res.end(JSON.stringify({ scrubbed }));

        } else if (route === '/rehydrate' && req.method === 'POST') {
          const body = await readBody(req);
          const { text } = JSON.parse(body);
          const shield = vault.privacyShield;
          const restored = rehydratePii(text, shield);
          res.end(JSON.stringify({ restored }));

        } else if (route === '/unlock' && req.method === 'GET') {
          // Serve HTML form for passphrase entry (avoids API transcript leakage)
          res.setHeader('Content-Type', 'text/html');
          res.end(UNLOCK_HTML);

        } else if (route === '/unlock' && req.method === 'POST') {
          const body = await readBody(req);
          const { passphrase } = JSON.parse(body);
          const result = await vault.unlock(passphrase);
          res.end(JSON.stringify(result));

        } else if (route === '/initialize' && req.method === 'POST') {
          const body = await readBody(req);
          const { passphrase } = JSON.parse(body);
          const result = await vault.initialize(passphrase);
          res.end(JSON.stringify(result));

        } else if (route.startsWith('/tool/') && req.method === 'POST') {
          // Generic MCP tool endpoint: POST /tool/:toolName { args: {} }
          const toolName = route.slice('/tool/'.length);
          if (!toolName) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing tool name' })); return; }
          const body = await readBody(req);
          const { args = {} } = JSON.parse(body);
          // Find the tool in the registry and invoke it via the MCP server
          const result = await server.callTool(toolName, args);
          res.end(JSON.stringify(result));

        } else if (route === '/' && req.method === 'GET') {
          // Serve the Friday Dashboard
          res.setHeader('Content-Type', 'text/html');
          try {
            const dashboardPath = path.join(import.meta.dirname, 'dashboard.html');
            const html = await fs.readFile(dashboardPath, 'utf-8');
            res.end(html);
          } catch {
            res.end('<html><body style="background:#030303;color:#00f0ff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><h1>Agent Friday</h1></body></html>');
          }

        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Not found' }));
        }
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    });

    httpServer.listen(0, '127.0.0.1', async () => {
      httpPort = httpServer.address().port;
      // Write port file so hooks can find us
      try {
        await fs.mkdir(VAULT_DIR, { recursive: true });
        await fs.writeFile(path.join(VAULT_DIR, 'port'), String(httpPort), 'utf-8');
      } catch {
        // Vault dir may not exist yet before initialization
      }
      resolve(httpPort);
    });
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

// HTML form for secure passphrase entry (never touches Claude API)
const UNLOCK_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Sovereign Vault</title>
  <style>
    body { background: #0a0a0a; color: #e0e0e0; font-family: 'Segoe UI', system-ui, sans-serif;
           display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
    .vault { background: #1a1a2e; border: 1px solid #00f0ff33; border-radius: 12px;
             padding: 40px; max-width: 420px; width: 100%; }
    h1 { color: #00f0ff; font-size: 1.4em; margin: 0 0 8px 0; }
    .subtitle { color: #888; font-size: 0.85em; margin-bottom: 24px; }
    input { width: 100%; padding: 12px; background: #0a0a0a; border: 1px solid #333;
            border-radius: 6px; color: #e0e0e0; font-size: 1em; margin-bottom: 16px;
            box-sizing: border-box; }
    input:focus { outline: none; border-color: #00f0ff; }
    button { width: 100%; padding: 12px; background: #00f0ff22; border: 1px solid #00f0ff;
             border-radius: 6px; color: #00f0ff; font-size: 1em; cursor: pointer; }
    button:hover { background: #00f0ff33; }
    .result { margin-top: 16px; padding: 12px; border-radius: 6px; font-size: 0.9em; }
    .success { background: #0f3d0f; border: 1px solid #2f7f2f; }
    .error { background: #3d0f0f; border: 1px solid #7f2f2f; }
  </style>
</head>
<body>
  <div class="vault">
    <h1>Sovereign Vault</h1>
    <div class="subtitle">Your passphrase never leaves this machine.</div>
    <form onsubmit="return unlock(event)">
      <input type="password" id="passphrase" placeholder="Enter your passphrase..." autofocus>
      <button type="submit" id="btn">Unlock Vault</button>
    </form>
    <div id="result"></div>
  </div>
  <script>
    async function unlock(e) {
      e.preventDefault();
      const pp = document.getElementById('passphrase').value;
      const btn = document.getElementById('btn');
      const res = document.getElementById('result');
      btn.disabled = true; btn.textContent = 'Deriving keys...';
      try {
        const resp = await fetch('/unlock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passphrase: pp })
        });
        const data = await resp.json();
        if (data.success) {
          res.className = 'result success';
          res.textContent = 'Vault unlocked. You can close this tab.';
        } else {
          res.className = 'result error';
          res.textContent = data.error || 'Failed to unlock';
          btn.disabled = false; btn.textContent = 'Unlock Vault';
        }
      } catch (err) {
        res.className = 'result error';
        res.textContent = err.message;
        btn.disabled = false; btn.textContent = 'Unlock Vault';
      }
      document.getElementById('passphrase').value = '';
    }
  </script>
</body>
</html>`;

// --- Main ---
// NOTE: Dependency bootstrapping is handled by bootstrap.js, which is the
// actual entry point referenced in plugin.json. It runs npm install before
// importing this file. Do NOT add ensureDependencies() here -- ESM imports
// at the top of this file would fail before it could execute.

async function main() {
  await initCrypto();

  // Ensure .asimovs-mind/vault/ directory exists for port file
  await fs.mkdir(VAULT_DIR, { recursive: true });

  await vault.init();

  // Start all subsystems (lifecycle init + event subscriptions)
  await registry.startAll();

  // Start HTTP bridge
  const port = await startHttpBridge();
  logger.info(`HTTP bridge on http://127.0.0.1:${port}`);
  logger.info(`Vault status: ${vault.status}`);
  logger.info(`Subsystems: ${registry.names.join(', ')}`);

  // Start MCP server on stdio
  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);
  logger.info('MCP server connected');

  // Cleanup on exit
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('exit', cleanup);
}

async function cleanup() {
  // Stop all subsystems in reverse order (p2p.stop() closes peers + transport)
  await registry.stopAll().catch(() => {});
  vault.lock();
  if (httpServer) httpServer.close();
  // Remove port file
  try { await fs.unlink(path.join(VAULT_DIR, 'port')).catch(() => {}); } catch {}
  logger.info('Vault locked, subsystems stopped, keys destroyed');
}

main().catch((err) => {
  process.stderr.write(`[friday-core] Fatal: ${err.message}\n`);
  process.exit(1);
});
