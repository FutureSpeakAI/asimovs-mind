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

import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const nodeModulesPath = join(__dirname, 'node_modules');

// Step 1: Install dependencies if missing
if (!existsSync(nodeModulesPath)) {
  process.stderr.write('[sovereign-vault] First run detected. Installing dependencies...\n');
  try {
    execSync('npm install --production', {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120000
    });
    process.stderr.write('[sovereign-vault] Dependencies installed.\n');
  } catch (err) {
    process.stderr.write(`[sovereign-vault] FATAL: npm install failed.\n`);
    process.stderr.write(`[sovereign-vault] Please run manually:\n`);
    process.stderr.write(`[sovereign-vault]   cd ${__dirname} && npm install\n`);
    process.stderr.write(`[sovereign-vault] Error: ${err.message}\n`);
    process.exit(1);
  }
}

// Step 2: Import and run the actual server
// Dynamic import so that node_modules exists by the time we resolve deps
try {
  await import('./index.js');
} catch (err) {
  process.stderr.write(`[sovereign-vault] FATAL: Server failed to start.\n`);
  process.stderr.write(`[sovereign-vault] ${err.message}\n`);
  if (err.code === 'ERR_MODULE_NOT_FOUND') {
    process.stderr.write(`[sovereign-vault] Try: cd ${__dirname} && npm install\n`);
  }
  process.exit(1);
}
