/**
 * Terminal Sessions Connector -- Persistent terminal session management
 *
 * Ported from nexus-os: connectors/terminal-sessions.ts (788 lines)
 * Stripped of: Electron imports, getSanitizedEnv (env passed clean).
 * Kept: Full session lifecycle, output buffering, signal handling, wait-for.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import * as os from 'node:os';

const MAX_SESSIONS = 10;
const MAX_OUTPUT_LINES = 10_000;
const MAX_RESPONSE_CHARS = 5_000;
const DEAD_SESSION_TTL_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;
const DEFAULT_WAIT_MS = 2_000;
const DEFAULT_READ_LINES = 50;
const DEFAULT_WAIT_FOR_TIMEOUT_MS = 30_000;
const WAIT_FOR_POLL_INTERVAL_MS = 200;

const sessions = new Map();
let cleanupTimer = null;

function ensureCleanupTimer() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (session.exitedAt && now - session.exitedAt > DEAD_SESSION_TTL_MS) {
        sessions.delete(id);
      }
    }
    if (sessions.size === 0 && cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  }, CLEANUP_INTERVAL_MS);
  if (cleanupTimer && typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) {
    cleanupTimer.unref();
  }
}

function resolveShellCommand(shell) {
  switch (shell) {
    case 'powershell': return { command: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-Command', '-'] };
    case 'cmd': return { command: 'cmd.exe', args: ['/Q'] };
    case 'bash': return { command: 'bash', args: ['--norc'] };
    case 'wsl': return { command: 'wsl.exe', args: ['bash', '--norc'] };
    default: return { command: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-Command', '-'] };
  }
}

function isoNow() { return new Date().toISOString(); }

function truncate(text, maxChars) {
  if (text.length <= maxChars) return text;
  const half = Math.floor((maxChars - 30) / 2);
  return text.slice(0, half) + `\n\n--- truncated (${text.length} chars total) ---\n\n` + text.slice(text.length - half);
}

function sanitizeOutput(text) {
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`No terminal session found with id: ${sessionId}`);
  return session;
}

function appendOutput(session, data) {
  const lines = data.split('\n');
  session.outputBuffer.push(...lines);
  if (session.outputBuffer.length > MAX_OUTPUT_LINES) {
    session.outputBuffer.splice(0, session.outputBuffer.length - MAX_OUTPUT_LINES);
    if (session.readCursor > session.outputBuffer.length) {
      session.readCursor = session.outputBuffer.length;
    }
  }
  session.lastActivity = isoNow();
}

// -- Tool Implementations --

async function terminalCreate(args) {
  const activeSessions = [...sessions.values()].filter(s => s.running);
  if (activeSessions.length >= MAX_SESSIONS) {
    return { error: `Maximum concurrent sessions reached (${MAX_SESSIONS}).` };
  }

  const shell = args.shell || 'powershell';
  const validShells = ['powershell', 'cmd', 'bash', 'wsl'];
  if (!validShells.includes(shell)) {
    return { error: `Invalid shell: ${shell}. Must be one of: ${validShells.join(', ')}` };
  }

  const name = typeof args.name === 'string' && args.name.trim() ? args.name.trim().slice(0, 64) : `${shell}-session`;
  const cwd = typeof args.cwd === 'string' && args.cwd.trim() ? path.resolve(args.cwd.trim()) : os.homedir();

  const { command, args: shellArgs } = resolveShellCommand(shell);
  const id = randomUUID();

  let proc;
  try {
    proc = spawn(command, shellArgs, {
      stdio: 'pipe', shell: false, cwd,
      env: { ...process.env, TERM: 'dumb', COLUMNS: '120', LINES: '30' },
      windowsHide: true,
    });
  } catch (err) {
    return { error: `Failed to spawn ${shell}: ${err.message}` };
  }

  if (!proc.pid) return { error: `Failed to start ${shell} -- no PID assigned.` };

  const session = {
    id, name, shell, process: proc,
    outputBuffer: [], createdAt: isoNow(), lastActivity: isoNow(),
    cwd, cols: 120, rows: 30, running: true, exitedAt: null, readCursor: 0,
  };

  proc.stdout?.on('data', (chunk) => appendOutput(session, sanitizeOutput(chunk.toString('utf-8'))));
  proc.stderr?.on('data', (chunk) => appendOutput(session, sanitizeOutput(chunk.toString('utf-8'))));
  proc.on('exit', (code, signal) => {
    session.running = false;
    session.exitedAt = Date.now();
    appendOutput(session, `\n[Process exited with code ${code ?? 'null'}, signal ${signal ?? 'none'}]\n`);
  });
  proc.on('error', (err) => {
    session.running = false;
    session.exitedAt = Date.now();
    appendOutput(session, `\n[Process error: ${err.message}]\n`);
  });

  sessions.set(id, session);
  ensureCleanupTimer();

  return { result: JSON.stringify({ session_id: id, name, shell, pid: proc.pid, cwd }) };
}

async function terminalSend(args) {
  if (!args.session_id) return { error: 'Missing: session_id' };
  if (typeof args.input !== 'string') return { error: 'Missing: input' };

  const waitMs = typeof args.wait_ms === 'number' && args.wait_ms >= 0 ? Math.min(args.wait_ms, 60_000) : DEFAULT_WAIT_MS;

  let session;
  try { session = getSession(args.session_id); } catch (err) { return { error: err.message }; }
  if (!session.running) return { error: 'Terminal session has exited.' };
  if (!session.process.stdin || session.process.stdin.destroyed) return { error: 'stdin is not writable.' };

  const cursorBefore = session.outputBuffer.length;
  try { session.process.stdin.write(args.input + '\n'); } catch (err) { return { error: `Write failed: ${err.message}` }; }
  session.lastActivity = isoNow();

  if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));

  const newLines = session.outputBuffer.slice(cursorBefore);
  session.readCursor = session.outputBuffer.length;
  return { result: truncate(newLines.join('\n'), MAX_RESPONSE_CHARS) || '(no output)' };
}

async function terminalRead(args) {
  if (!args.session_id) return { error: 'Missing: session_id' };
  let session;
  try { session = getSession(args.session_id); } catch (err) { return { error: err.message }; }
  const lineCount = typeof args.lines === 'number' && args.lines > 0 ? Math.min(args.lines, MAX_OUTPUT_LINES) : DEFAULT_READ_LINES;
  const buf = session.outputBuffer;
  const startIdx = Math.max(0, buf.length - lineCount);
  return { result: truncate(buf.slice(startIdx).join('\n'), MAX_RESPONSE_CHARS) || '(no output)' };
}

async function terminalList() {
  const list = [...sessions.values()].map(s => ({
    id: s.id, name: s.name, shell: s.shell, pid: s.process.pid ?? null,
    cwd: s.cwd, running: s.running, created_at: s.createdAt, last_activity: s.lastActivity,
  }));
  return { result: JSON.stringify(list, null, 2) };
}

async function terminalKill(args) {
  if (!args.session_id) return { error: 'Missing: session_id' };
  let session;
  try { session = getSession(args.session_id); } catch (err) { return { error: err.message }; }
  if (session.running) {
    try {
      if (process.platform === 'win32' && session.process.pid) {
        spawn('taskkill', ['/PID', String(session.process.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      } else {
        session.process.kill('SIGKILL');
      }
    } catch {}
    session.running = false;
    session.exitedAt = Date.now();
  }
  sessions.delete(args.session_id);
  return { result: `Session ${args.session_id} terminated.` };
}

async function terminalSendSignal(args) {
  if (!args.session_id) return { error: 'Missing: session_id' };
  const validSignals = ['SIGINT', 'SIGTERM', 'SIGKILL'];
  if (!validSignals.includes(args.signal)) return { error: `Invalid signal. Must be one of: ${validSignals.join(', ')}` };
  let session;
  try { session = getSession(args.session_id); } catch (err) { return { error: err.message }; }
  if (!session.running) return { error: 'Session has already exited.' };
  const pid = session.process.pid;
  if (!pid) return { error: 'No PID.' };

  try {
    if (process.platform === 'win32' && args.signal === 'SIGINT') {
      if (session.process.stdin && !session.process.stdin.destroyed) session.process.stdin.write('\x03');
    } else if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(pid, args.signal);
    }
  } catch (err) { return { error: `Failed to send ${args.signal}: ${err.message}` }; }
  session.lastActivity = isoNow();
  return { result: `Signal ${args.signal} sent to session ${args.session_id} (pid ${pid}).` };
}

async function terminalWaitFor(args) {
  if (!args.session_id) return { error: 'Missing: session_id' };
  if (!args.pattern) return { error: 'Missing: pattern' };

  const timeoutMs = typeof args.timeout_ms === 'number' && args.timeout_ms > 0
    ? Math.min(args.timeout_ms, 120_000) : DEFAULT_WAIT_FOR_TIMEOUT_MS;

  let session;
  try { session = getSession(args.session_id); } catch (err) { return { error: err.message }; }

  let regex;
  try {
    if (/(\+|\*|\?|\{)\s*\)(\+|\*|\?|\{)/.test(args.pattern) || /(\(.*\|.*\))(\+|\*|\{)/.test(args.pattern)) {
      regex = new RegExp(args.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'm');
    } else {
      regex = new RegExp(args.pattern, 'm');
    }
  } catch (err) { return { error: `Invalid regex: ${err.message}` }; }

  const startTime = Date.now();
  const searchFrom = session.outputBuffer.length;

  while (Date.now() - startTime < timeoutMs) {
    const windowStart = Math.max(0, searchFrom - 10);
    const recentOutput = session.outputBuffer.slice(windowStart).join('\n');
    const match = regex.exec(recentOutput);

    if (match) {
      const matchIdx = recentOutput.indexOf(match[0]);
      const contextStart = Math.max(0, matchIdx - 200);
      const contextEnd = Math.min(recentOutput.length, matchIdx + match[0].length + 200);
      return { result: JSON.stringify({ matched: true, match: match[0].slice(0, 500), context: recentOutput.slice(contextStart, contextEnd), elapsed_ms: Date.now() - startTime }) };
    }
    if (!session.running) return { error: `Session exited before pattern matched. Waited ${Date.now() - startTime}ms.` };
    await new Promise(r => setTimeout(r, WAIT_FOR_POLL_INTERVAL_MS));
  }
  return { error: `Timeout after ${timeoutMs}ms waiting for pattern: ${args.pattern}` };
}

// -- Exports --

export function getTools() {
  return [
    { name: 'terminal_create', description: 'Create a persistent terminal session (powershell, cmd, bash, wsl)', params: { shell: 'string', name: 'string', cwd: 'string' }, safety_level: 'write', category: 'system' },
    { name: 'terminal_send', description: 'Send a command to a terminal session and get output', params: { session_id: 'string', input: 'string', wait_ms: 'number' }, safety_level: 'write', category: 'system' },
    { name: 'terminal_read', description: 'Read latest output from a terminal session', params: { session_id: 'string', lines: 'number' }, safety_level: 'read_only', category: 'system' },
    { name: 'terminal_list', description: 'List all terminal sessions with status', params: {}, safety_level: 'read_only', category: 'system' },
    { name: 'terminal_kill', description: 'Kill a terminal session and its child processes', params: { session_id: 'string' }, safety_level: 'destructive', category: 'system' },
    { name: 'terminal_send_signal', description: 'Send a signal (SIGINT/SIGTERM/SIGKILL) to a terminal session', params: { session_id: 'string', signal: 'SIGINT|SIGTERM|SIGKILL' }, safety_level: 'write', category: 'system' },
    { name: 'terminal_wait_for', description: 'Wait for a regex pattern to appear in terminal output', params: { session_id: 'string', pattern: 'string (regex)', timeout_ms: 'number' }, safety_level: 'read_only', category: 'system' },
  ];
}

export async function execute(toolName, args) {
  try {
    switch (toolName) {
      case 'terminal_create':      return await terminalCreate(args);
      case 'terminal_send':        return await terminalSend(args);
      case 'terminal_read':        return await terminalRead(args);
      case 'terminal_list':        return await terminalList();
      case 'terminal_kill':        return await terminalKill(args);
      case 'terminal_send_signal': return await terminalSendSignal(args);
      case 'terminal_wait_for':    return await terminalWaitFor(args);
      default: return { error: `Unknown tool: ${toolName}` };
    }
  } catch (err) { return { error: `terminal error: ${err.message}` }; }
}

export async function detect() {
  if (process.platform === 'win32') return true;
  try {
    const { execFileSync } = await import('node:child_process');
    execFileSync('bash', ['--version'], { stdio: 'ignore', timeout: 3000 });
    return true;
  } catch { return false; }
}

export const name = 'terminal-sessions';
export const description = 'Persistent terminal sessions: shells, build watchers, REPLs, dev servers';
