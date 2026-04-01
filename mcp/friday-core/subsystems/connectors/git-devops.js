/**
 * Git & DevOps Connector -- Git, Docker, npm/yarn/pnpm, and Cloud CLI tools
 *
 * Ported from nexus-os: connectors/git-devops.ts (1,152 lines)
 * Stripped of: TypeScript types, Electron imports.
 * Kept: All git ops, docker ops, npm ops, cloud CLI with safety guards.
 * All commands use execFileSync (no shell) to prevent injection.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const MAX_OUTPUT_CHARS = 8000;
const EXEC_TIMEOUT_MS = 30_000;
const DIFF_CHAR_LIMIT = 5000;

const DANGEROUS_CLOUD_PATTERNS = [
  /\bdelete\b/i, /\bdestroy\b/i, /\bterminate\b/i,
  /\bremove\b/i, /\bpurge\b/i, /\bformat\b/i, /\bdrop\b/i,
];

const DANGEROUS_DOCKER_PATTERNS = [
  /docker\s+rm\s+-f\s+\$\(/i,
  /docker\s+rmi\s+-f\s+\$\(/i,
  /docker\s+system\s+prune\s+-a/i,
  /docker\s+volume\s+prune/i,
];

// -- Helpers --

function runArgs(cmd, args, opts = {}) {
  const { cwd, timeout = EXEC_TIMEOUT_MS } = opts;
  try {
    return execFileSync(cmd, args, {
      cwd,
      timeout,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    const stderr = err.stderr?.toString?.() ?? '';
    const stdout = err.stdout?.toString?.() ?? '';
    throw new Error(stderr || stdout || err.message);
  }
}

function truncate(text, limit = MAX_OUTPUT_CHARS) {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + `\n\n--- Output truncated (${text.length} chars total, showing first ${limit}) ---`;
}

function detectPackageManager(cwd) {
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

function ok(text, limit) { return { result: truncate(text.trim(), limit) }; }
function fail(msg) { return { error: msg }; }

// -- Git Tools --

function gitStatus(args) {
  const repoPath = args.repo_path;
  try {
    const porcelain = runArgs('git', ['status', '--porcelain'], { cwd: repoPath });
    const branch = runArgs('git', ['branch', '--show-current'], { cwd: repoPath }).trim();
    const staged = [], modified = [], untracked = [];
    for (const line of porcelain.split('\n')) {
      if (!line.trim()) continue;
      const idx = line[0], wt = line[1], file = line.slice(3);
      if (idx && idx !== ' ' && idx !== '?') staged.push(`${idx} ${file}`);
      if (wt && wt !== ' ' && wt !== '?') modified.push(file);
      if (idx === '?' && wt === '?') untracked.push(file);
    }
    const sections = [`Branch: ${branch || '(detached HEAD)'}`];
    if (staged.length > 0) sections.push(`\nStaged (${staged.length}):\n  ${staged.join('\n  ')}`);
    if (modified.length > 0) sections.push(`\nModified (${modified.length}):\n  ${modified.join('\n  ')}`);
    if (untracked.length > 0) sections.push(`\nUntracked (${untracked.length}):\n  ${untracked.join('\n  ')}`);
    if (staged.length === 0 && modified.length === 0 && untracked.length === 0) sections.push('\nWorking tree clean.');
    return ok(sections.join('\n'));
  } catch (err) { return fail(`git status failed: ${err.message}`); }
}

function gitLog(args) {
  const repoPath = args.repo_path;
  const count = args.count ?? 20;
  const oneline = args.oneline ?? true;
  try {
    const gitArgs = ['log', `--max-count=${count}`];
    if (oneline) gitArgs.push('--oneline', '--decorate');
    else gitArgs.push('--format=medium');
    if (args.author) gitArgs.push(`--author=${args.author}`);
    if (args.since) gitArgs.push(`--since=${args.since}`);
    const output = runArgs('git', gitArgs, { cwd: repoPath });
    return ok(output || 'No commits found matching the criteria.');
  } catch (err) { return fail(`git log failed: ${err.message}`); }
}

function gitDiff(args) {
  const repoPath = args.repo_path;
  try {
    const gitArgs = ['diff'];
    if (args.staged) gitArgs.push('--cached');
    if (args.file) gitArgs.push('--', args.file);
    const output = runArgs('git', gitArgs, { cwd: repoPath });
    if (!output.trim()) return ok(args.staged ? 'No staged changes.' : 'No unstaged changes.');
    return ok(output, DIFF_CHAR_LIMIT);
  } catch (err) { return fail(`git diff failed: ${err.message}`); }
}

function gitCommit(args) {
  const repoPath = args.repo_path;
  try {
    if (args.files?.length > 0) {
      for (const f of args.files) runArgs('git', ['add', '--', f], { cwd: repoPath });
    } else if (args.all) {
      runArgs('git', ['add', '-A'], { cwd: repoPath });
    }
    const output = runArgs('git', ['commit', '-m', args.message], { cwd: repoPath });
    return ok(output);
  } catch (err) { return fail(`git commit failed: ${err.message}`); }
}

function gitBranch(args) {
  const repoPath = args.repo_path;
  const action = args.action;
  const branchName = args.branch_name;
  try {
    switch (action) {
      case 'list': return ok(runArgs('git', ['branch', '-a', '--no-color'], { cwd: repoPath }) || 'No branches found.');
      case 'create':
        if (!branchName) return fail('branch_name is required for create');
        return ok(runArgs('git', ['branch', branchName], { cwd: repoPath }) || `Branch "${branchName}" created.`);
      case 'switch':
        if (!branchName) return fail('branch_name is required for switch');
        return ok(runArgs('git', ['checkout', branchName], { cwd: repoPath }) || `Switched to "${branchName}".`);
      case 'delete':
        if (!branchName) return fail('branch_name is required for delete');
        return ok(runArgs('git', ['branch', '-d', branchName], { cwd: repoPath }) || `Branch "${branchName}" deleted.`);
      default: return fail(`Unknown branch action: ${action}`);
    }
  } catch (err) { return fail(`git branch ${action} failed: ${err.message}`); }
}

function gitStash(args) {
  const repoPath = args.repo_path;
  try {
    switch (args.action) {
      case 'push': {
        const ga = ['stash', 'push'];
        if (args.message) ga.push('-m', args.message);
        return ok(runArgs('git', ga, { cwd: repoPath }) || 'Changes stashed.');
      }
      case 'pop': return ok(runArgs('git', ['stash', 'pop'], { cwd: repoPath }) || 'Stash applied and dropped.');
      case 'list': return ok(runArgs('git', ['stash', 'list'], { cwd: repoPath }) || 'No stashes found.');
      case 'drop': return ok(runArgs('git', ['stash', 'drop'], { cwd: repoPath }) || 'Most recent stash dropped.');
      default: return fail(`Unknown stash action: ${args.action}`);
    }
  } catch (err) { return fail(`git stash ${args.action} failed: ${err.message}`); }
}

function gitPull(args) {
  try {
    const ga = args.rebase ? ['pull', '--rebase'] : ['pull'];
    return ok(runArgs('git', ga, { cwd: args.repo_path }) || 'Already up to date.');
  } catch (err) { return fail(`git pull failed: ${err.message}`); }
}

function gitPush(args) {
  const repoPath = args.repo_path;
  try {
    if (args.force) {
      const currentBranch = args.branch || runArgs('git', ['branch', '--show-current'], { cwd: repoPath }).trim();
      if (['main', 'master'].includes(currentBranch)) {
        return fail(`SAFETY BLOCK: Refusing to force-push to "${currentBranch}".`);
      }
    }
    const ga = ['push'];
    if (args.force) ga.push('--force');
    if (args.set_upstream) ga.push('-u', 'origin');
    if (args.branch) ga.push(args.branch);
    return ok(runArgs('git', ga, { cwd: repoPath }) || 'Push completed.');
  } catch (err) { return fail(`git push failed: ${err.message}`); }
}

function gitClone(args) {
  try {
    const ga = ['clone'];
    if (args.depth > 0) ga.push('--depth', String(args.depth));
    ga.push(args.url);
    if (args.destination) ga.push(args.destination);
    return ok(runArgs('git', ga, { timeout: 120_000 }) || `Cloned from ${args.url}`);
  } catch (err) { return fail(`git clone failed: ${err.message}`); }
}

function gitBlame(args) {
  try {
    const ga = ['blame'];
    if (args.lines) {
      const [start, end] = args.lines.split(',').map(s => s.trim());
      if (start && end) ga.push('-L', `${start},${end}`);
    }
    ga.push('--', args.file);
    return ok(runArgs('git', ga, { cwd: args.repo_path }) || 'No blame output.');
  } catch (err) { return fail(`git blame failed: ${err.message}`); }
}

// -- Docker Tools --

function dockerPs(args) {
  try {
    const format = 'table {{.ID}}\\t{{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}';
    const da = ['ps'];
    if (args.all) da.push('-a');
    da.push('--format', format);
    return ok(runArgs('docker', da) || 'No containers found.');
  } catch (err) { return fail(`docker ps failed: ${err.message}`); }
}

function dockerImages() {
  try {
    const format = 'table {{.Repository}}\\t{{.Tag}}\\t{{.ID}}\\t{{.Size}}\\t{{.CreatedSince}}';
    return ok(runArgs('docker', ['images', '--format', format]) || 'No images found.');
  } catch (err) { return fail(`docker images failed: ${err.message}`); }
}

function dockerRun(args) {
  const detach = args.detach ?? true;
  try {
    const da = ['run'];
    if (detach) da.push('-d');
    if (args.name) da.push('--name', args.name);
    if (args.ports) for (const p of args.ports) da.push('-p', p);
    if (args.volumes) for (const v of args.volumes) da.push('-v', v);
    if (args.env) for (const [k, v] of Object.entries(args.env)) da.push('-e', `${k}=${v}`);
    da.push(args.image);
    if (args.command) da.push(args.command);

    const fullCmd = ['docker', ...da].join(' ');
    for (const pattern of DANGEROUS_DOCKER_PATTERNS) {
      if (pattern.test(fullCmd)) return fail('SAFETY BLOCK: Dangerous docker pattern detected.');
    }
    return ok(runArgs('docker', da) || 'Container started.');
  } catch (err) { return fail(`docker run failed: ${err.message}`); }
}

function dockerCompose(args) {
  try {
    const da = ['compose'];
    if (args.compose_file) da.push('-f', args.compose_file);
    switch (args.action) {
      case 'up': da.push('up'); if (args.detach) da.push('-d'); if (args.service) da.push(args.service); break;
      case 'down': da.push('down'); break;
      case 'logs': da.push('logs'); if (args.service) da.push(args.service); da.push('--tail=100'); break;
      case 'ps': da.push('ps'); break;
      case 'build': da.push('build'); if (args.service) da.push(args.service); break;
      default: return fail(`Unknown compose action: ${args.action}`);
    }
    const timeout = ['up', 'build'].includes(args.action) ? 120_000 : EXEC_TIMEOUT_MS;
    return ok(runArgs('docker', da, { timeout }) || `docker compose ${args.action} completed.`);
  } catch (err) { return fail(`docker compose ${args.action} failed: ${err.message}`); }
}

function dockerExec(args) {
  try {
    const da = ['exec', '-i', args.container, ...args.command.split(/\s+/).filter(Boolean)];
    return ok(runArgs('docker', da) || 'Command executed.');
  } catch (err) { return fail(`docker exec failed: ${err.message}`); }
}

function dockerLogs(args) {
  const tail = args.tail ?? 100;
  try {
    return ok(runArgs('docker', ['logs', '--tail', String(tail), args.container]) || 'No logs.');
  } catch (err) { return fail(`docker logs failed: ${err.message}`); }
}

// -- npm Tools --

function npmRun(args) {
  const pm = args.package_manager ?? detectPackageManager(args.cwd);
  try {
    let bin, pmArgs = [];
    switch (pm) {
      case 'yarn': bin = 'yarn'; pmArgs.push(args.script); break;
      case 'pnpm': bin = 'pnpm'; pmArgs.push('run', args.script); break;
      default: bin = 'npm'; pmArgs.push('run', args.script); break;
    }
    return ok(runArgs(bin, pmArgs, { cwd: args.cwd, timeout: 60_000 }) || `Script "${args.script}" completed.`);
  } catch (err) { return fail(`${pm} run ${args.script} failed: ${err.message}`); }
}

function npmInstall(args) {
  const pm = args.package_manager ?? detectPackageManager(args.cwd);
  try {
    let bin, pmArgs = [];
    if (args.packages?.length > 0) {
      switch (pm) {
        case 'yarn': bin = 'yarn'; pmArgs.push('add'); if (args.dev) pmArgs.push('--dev'); pmArgs.push(...args.packages); break;
        case 'pnpm': bin = 'pnpm'; pmArgs.push('add'); if (args.dev) pmArgs.push('-D'); pmArgs.push(...args.packages); break;
        default: bin = 'npm'; pmArgs.push('install'); if (args.dev) pmArgs.push('--save-dev'); pmArgs.push(...args.packages); break;
      }
    } else {
      bin = pm; pmArgs.push('install');
    }
    return ok(runArgs(bin, pmArgs, { cwd: args.cwd, timeout: 120_000 }) || 'Install completed.');
  } catch (err) { return fail(`${pm} install failed: ${err.message}`); }
}

function npmSearch(args) {
  try {
    const output = runArgs('npm', ['search', args.query, '--json'], { timeout: 15_000 });
    let results;
    try { results = JSON.parse(output); } catch { return ok(output); }
    const top10 = results.slice(0, 10);
    if (top10.length === 0) return ok(`No packages found for "${args.query}".`);
    const formatted = top10.map((pkg, i) =>
      `${i + 1}. ${pkg.name}@${pkg.version}\n   ${pkg.description || '(no description)'}`
    );
    return ok(`Search results for "${args.query}":\n\n${formatted.join('\n\n')}`);
  } catch (err) { return fail(`npm search failed: ${err.message}`); }
}

// -- Cloud CLI --

function cloudCli(args) {
  for (const pattern of DANGEROUS_CLOUD_PATTERNS) {
    if (pattern.test(args.command)) {
      return fail(`SAFETY BLOCK: Command contains destructive keyword ("${pattern.source}").`);
    }
  }
  try {
    const cmdParts = args.command.split(/\s+/).filter(Boolean);
    return ok(runArgs(args.provider, cmdParts, { timeout: 60_000 }) || 'Command completed.');
  } catch (err) { return fail(`${args.provider} CLI failed: ${err.message}`); }
}

// -- Tool Declarations --

export function getTools() {
  return [
    // Git
    { name: 'git_status', description: 'Get Git repo status (branch, staged, modified, untracked)', params: { repo_path: 'string (required)' }, safety_level: 'read_only', category: 'code' },
    { name: 'git_log', description: 'View commit history with optional filtering', params: { repo_path: 'string', count: 'number', oneline: 'boolean', author: 'string', since: 'string' }, safety_level: 'read_only', category: 'code' },
    { name: 'git_diff', description: 'Show file changes (working tree or staging area)', params: { repo_path: 'string', staged: 'boolean', file: 'string' }, safety_level: 'read_only', category: 'code' },
    { name: 'git_commit', description: 'Stage files and create a commit', params: { repo_path: 'string', message: 'string', files: 'string[]', all: 'boolean' }, safety_level: 'write', category: 'code' },
    { name: 'git_branch', description: 'List, create, switch, or delete branches', params: { repo_path: 'string', action: 'list|create|switch|delete', branch_name: 'string' }, safety_level: 'write', category: 'code' },
    { name: 'git_stash', description: 'Stash or restore uncommitted changes', params: { repo_path: 'string', action: 'push|pop|list|drop', message: 'string' }, safety_level: 'write', category: 'code' },
    { name: 'git_pull', description: 'Pull latest changes from remote', params: { repo_path: 'string', rebase: 'boolean' }, safety_level: 'write', category: 'code' },
    { name: 'git_push', description: 'Push local commits to remote', params: { repo_path: 'string', force: 'boolean', set_upstream: 'boolean', branch: 'string' }, safety_level: 'write', category: 'code' },
    { name: 'git_clone', description: 'Clone a remote Git repository', params: { url: 'string', destination: 'string', depth: 'number' }, safety_level: 'write', category: 'code' },
    { name: 'git_blame', description: 'Show line-by-line authorship for a file', params: { repo_path: 'string', file: 'string', lines: 'string (start,end)' }, safety_level: 'read_only', category: 'code' },
    // Docker
    { name: 'docker_ps', description: 'List Docker containers', params: { all: 'boolean' }, safety_level: 'read_only', category: 'system' },
    { name: 'docker_images', description: 'List local Docker images', params: {}, safety_level: 'read_only', category: 'system' },
    { name: 'docker_run', description: 'Create and start a Docker container', params: { image: 'string', name: 'string', ports: 'string[]', volumes: 'string[]', env: 'object', detach: 'boolean', command: 'string' }, safety_level: 'write', category: 'system' },
    { name: 'docker_compose', description: 'Run Docker Compose operations', params: { action: 'up|down|logs|ps|build', compose_file: 'string', service: 'string', detach: 'boolean' }, safety_level: 'write', category: 'system' },
    { name: 'docker_exec', description: 'Execute a command inside a running container', params: { container: 'string', command: 'string' }, safety_level: 'write', category: 'system' },
    { name: 'docker_logs', description: 'Retrieve logs from a container', params: { container: 'string', tail: 'number' }, safety_level: 'read_only', category: 'system' },
    // npm
    { name: 'npm_run', description: 'Run a package.json script (auto-detects npm/yarn/pnpm)', params: { script: 'string', cwd: 'string', package_manager: 'npm|yarn|pnpm' }, safety_level: 'write', category: 'code' },
    { name: 'npm_install', description: 'Install dependencies', params: { packages: 'string[]', cwd: 'string', dev: 'boolean', package_manager: 'string' }, safety_level: 'write', category: 'code' },
    { name: 'npm_search', description: 'Search npm registry for packages', params: { query: 'string' }, safety_level: 'read_only', category: 'code' },
    // Cloud CLI
    { name: 'cloud_cli', description: 'Run a cloud provider CLI command (AWS/Azure/GCloud). Destructive commands blocked.', params: { provider: 'aws|az|gcloud', command: 'string' }, safety_level: 'write', category: 'system' },
  ];
}

// -- Execute Dispatcher --

export async function execute(toolName, args) {
  switch (toolName) {
    case 'git_status':    return gitStatus(args);
    case 'git_log':       return gitLog(args);
    case 'git_diff':      return gitDiff(args);
    case 'git_commit':    return gitCommit(args);
    case 'git_branch':    return gitBranch(args);
    case 'git_stash':     return gitStash(args);
    case 'git_pull':      return gitPull(args);
    case 'git_push':      return gitPush(args);
    case 'git_clone':     return gitClone(args);
    case 'git_blame':     return gitBlame(args);
    case 'docker_ps':     return dockerPs(args);
    case 'docker_images': return dockerImages();
    case 'docker_run':    return dockerRun(args);
    case 'docker_compose':return dockerCompose(args);
    case 'docker_exec':   return dockerExec(args);
    case 'docker_logs':   return dockerLogs(args);
    case 'npm_run':       return npmRun(args);
    case 'npm_install':   return npmInstall(args);
    case 'npm_search':    return npmSearch(args);
    case 'cloud_cli':     return cloudCli(args);
    default:              return fail(`Unknown tool: ${toolName}`);
  }
}

// -- Detection --

export async function detect() {
  try {
    execFileSync('git', ['--version'], { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' });
    return true;
  } catch { return false; }
}

export const name = 'git-devops';
export const description = 'Git workflows, Docker, npm/yarn/pnpm, cloud CLIs (AWS/Azure/GCP)';
