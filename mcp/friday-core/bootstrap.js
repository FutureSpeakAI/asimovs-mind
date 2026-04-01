#!/usr/bin/env node
/**
 * Sovereign Vault — Bootstrap Script
 *
 * This is the entry point that plugin.json references.
 * It ensures npm dependencies are installed BEFORE importing
 * the actual server (which uses ESM imports that would fail
 * without node_modules).
 *
 * On first run after install: runs `npm install`, then starts the server.
 * On subsequent runs: skips install, starts the server directly.
 */

import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const nodeModulesPath = join(__dirname, 'node_modules');

// Step 0: Node version check
const [major] = process.versions.node.split('.').map(Number);
if (major < 18) {
  process.stderr.write(`[friday] FATAL: Node.js 18+ required (found ${process.version})\n`);
  process.stderr.write(`[friday] Install from https://nodejs.org/\n`);
  process.exit(1);
}

// Step 1: Install dependencies if missing
if (!existsSync(nodeModulesPath)) {
  process.stderr.write('[friday] First run detected. Installing dependencies...\n');

  // Progress dots so the user knows something is happening
  const dotInterval = setInterval(() => {
    process.stderr.write('.');
  }, 3000);

  try {
    execSync('npm install --production', {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120000
    });
    clearInterval(dotInterval);
    process.stderr.write('\n[friday] Dependencies installed.\n');
  } catch (err) {
    clearInterval(dotInterval);
    process.stderr.write('\n');
    process.stderr.write(`[friday] FATAL: npm install failed.\n`);
    process.stderr.write(`[friday] Please run manually:\n`);
    process.stderr.write(`[friday]   cd ${__dirname} && npm install\n`);
    process.stderr.write(`[friday] Error: ${err.message}\n`);
    process.exit(1);
  }
}

// Step 1.5: Stale port file detection (from crashed previous session)
const portPath = join(__dirname, '..', '..', '.asimovs-mind', 'vault', 'port');
if (existsSync(portPath)) {
  try {
    const port = parseInt(readFileSync(portPath, 'utf-8').trim(), 10);
    if (!isNaN(port)) {
      try {
        const resp = await fetch(`http://127.0.0.1:${port}/status`, {
          signal: AbortSignal.timeout(1000),
        });
        // If we get here, another instance is already running
        process.stderr.write(`[friday] Another instance detected on port ${port}\n`);
      } catch {
        // Stale port file — remove it
        unlinkSync(portPath);
        process.stderr.write(`[friday] Cleaned stale port file (port ${port})\n`);
      }
    }
  } catch {
    // Port file unreadable — remove it
    try { unlinkSync(portPath); } catch { /* already gone */ }
  }
}

// Step 2: Import and run the actual server
// Dynamic import so that node_modules exists by the time we resolve deps
try {
  await import('./index.js');
} catch (err) {
  process.stderr.write(`[friday] FATAL: Server failed to start.\n`);
  process.stderr.write(`[friday] ${err.message}\n`);
  if (err.code === 'ERR_MODULE_NOT_FOUND') {
    process.stderr.write(`[friday] Try: cd ${__dirname} && npm install\n`);
  }
  process.exit(1);
}
