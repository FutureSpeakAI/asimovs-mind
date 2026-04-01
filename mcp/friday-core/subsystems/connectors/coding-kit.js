/**
 * Coding Kit Connector -- Language runtime tools for code intelligence
 *
 * Ported from nexus-os: connectors/coding-kit.ts (823 lines)
 * Stripped of: GitLoader dependency, Electron, loaded-repo state.
 * Adapted to: CLI-native code intelligence using filesystem operations.
 *
 * In the CLI context, the coding kit provides:
 *   - Project analysis (language stats, deps, key files, structure)
 *   - Symbol finding (functions, classes, interfaces, types)
 *   - File tree navigation
 *   - Dependency analysis across workspace packages
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const MAX_OUTPUT_CHARS = 12_000;

function truncate(text, limit = MAX_OUTPUT_CHARS) {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + `\n\n--- truncated (${text.length} chars total) ---`;
}

function ok(text) { return { result: truncate(text.trim()) || '(no output)' }; }
function fail(msg) { return { error: msg }; }

// -- Symbol Patterns (TypeScript/JavaScript) --

const SYMBOL_PATTERNS = [
  { kind: 'function',  regex: /^(export\s+)?(export\s+default\s+)?(async\s+)?function\s+(\w+)/ },
  { kind: 'class',     regex: /^(export\s+)?(export\s+default\s+)?class\s+(\w+)/ },
  { kind: 'interface', regex: /^(export\s+)?interface\s+(\w+)/ },
  { kind: 'type',      regex: /^(export\s+)?type\s+(\w+)\s*[=<]/ },
  { kind: 'enum',      regex: /^(export\s+)?(const\s+)?enum\s+(\w+)/ },
  { kind: 'const',     regex: /^(export\s+)?const\s+(\w+)\s*[=:]/ },
];

function extractSymbolName(match) {
  for (let i = match.length - 1; i >= 1; i--) {
    const group = match[i];
    if (group && /^\w+$/.test(group.trim())) return group.trim();
  }
  return match[0];
}

// -- Tool Implementations --

function codeAnalyzeProject(args) {
  const projectPath = args.path;
  if (!projectPath || !fs.existsSync(projectPath)) {
    return fail('Valid project path is required.');
  }

  try {
    const stats = { files: 0, languages: {}, totalSize: 0 };
    const keyFiles = [];

    const walk = (dir, depth = 0) => {
      if (depth > 5) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath, depth + 1);
        } else if (entry.isFile()) {
          stats.files++;
          const ext = path.extname(entry.name).toLowerCase();
          const lang = { '.ts': 'TypeScript', '.tsx': 'TypeScript/React', '.js': 'JavaScript', '.jsx': 'JavaScript/React', '.py': 'Python', '.rs': 'Rust', '.go': 'Go', '.java': 'Java', '.c': 'C', '.cpp': 'C++', '.cs': 'C#', '.rb': 'Ruby', '.php': 'PHP' }[ext];
          if (lang) stats.languages[lang] = (stats.languages[lang] || 0) + 1;
          try { stats.totalSize += fs.statSync(fullPath).size; } catch {}
          if (['package.json', 'tsconfig.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'Makefile', 'Dockerfile'].includes(entry.name)) {
            keyFiles.push(path.relative(projectPath, fullPath));
          }
        }
      }
    };

    walk(projectPath);

    // Check for package.json
    let packageInfo = null;
    const pkgPath = path.join(projectPath, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        packageInfo = { name: pkg.name, version: pkg.version, description: pkg.description };
      } catch {}
    }

    return ok(JSON.stringify({
      path: projectPath,
      files: stats.files,
      totalSizeKB: Math.round(stats.totalSize / 1024),
      languages: stats.languages,
      primaryLanguage: Object.entries(stats.languages).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown',
      keyFiles,
      package: packageInfo,
    }, null, 2));
  } catch (err) { return fail(`Project analysis failed: ${err.message}`); }
}

function codeFindSymbols(args) {
  const projectPath = args.path;
  const query = args.query;
  if (!projectPath || !query) return fail('path and query are required.');

  const kindFilter = args.kind || 'all';
  const maxResults = args.max_results || 30;
  const exportedOnly = args.exported_only === true;
  const results = [];

  const walk = (dir, depth = 0) => {
    if (depth > 8 || results.length >= maxResults) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (results.length >= maxResults) return;
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!['.ts', '.tsx', '.js', '.jsx', '.mjs'].includes(ext)) continue;
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length && results.length < maxResults; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            for (const pattern of SYMBOL_PATTERNS) {
              if (kindFilter !== 'all' && pattern.kind !== kindFilter) continue;
              const match = line.match(pattern.regex);
              if (!match) continue;
              const name = extractSymbolName(match);
              const exported = /^export\s/.test(line);
              if (exportedOnly && !exported) continue;
              if (!name.toLowerCase().includes(query.toLowerCase())) continue;
              results.push({
                name, kind: pattern.kind, exported,
                file: path.relative(projectPath, fullPath),
                line: i + 1, context: line.slice(0, 120),
              });
            }
          }
        } catch {}
      }
    }
  };

  walk(projectPath);
  return ok(JSON.stringify({ query, kind: kindFilter, totalResults: results.length, symbols: results }, null, 2));
}

function codeGetTree(args) {
  const projectPath = args.path;
  if (!projectPath || !fs.existsSync(projectPath)) return fail('Valid path is required.');

  const maxDepth = args.max_depth || 4;
  const filesOnly = args.files_only === true;
  const entries = [];

  const walk = (dir, depth = 0) => {
    if (depth > maxDepth) return;
    let dirEntries;
    try { dirEntries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of dirEntries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(projectPath, fullPath);
      if (entry.isDirectory()) {
        if (!filesOnly) entries.push({ path: relPath, type: 'directory' });
        walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(fullPath);
          entries.push({ path: relPath, type: 'file', sizeBytes: stat.size });
        } catch {
          entries.push({ path: relPath, type: 'file' });
        }
      }
    }
  };

  walk(projectPath);
  return ok(JSON.stringify({ path: projectPath, totalEntries: entries.length, entries: entries.slice(0, 200) }, null, 2));
}

function codeAnalyzeDeps(args) {
  const projectPath = args.path;
  if (!projectPath) return fail('path is required.');

  try {
    const pkgJsonPath = path.join(projectPath, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) return fail('No package.json found at the specified path.');

    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
    const deps = pkg.dependencies || {};
    const devDeps = pkg.devDependencies || {};
    const peerDeps = pkg.peerDependencies || {};

    // Check for workspace packages
    const workspacePackages = [];
    if (pkg.workspaces) {
      const patterns = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces.packages || [];
      for (const pattern of patterns) {
        const globDir = pattern.replace('/*', '').replace('/**', '');
        const wsDir = path.join(projectPath, globDir);
        if (fs.existsSync(wsDir)) {
          try {
            const entries = fs.readdirSync(wsDir, { withFileTypes: true });
            for (const entry of entries) {
              if (!entry.isDirectory()) continue;
              const wsPkgPath = path.join(wsDir, entry.name, 'package.json');
              if (fs.existsSync(wsPkgPath)) {
                try {
                  const wsPkg = JSON.parse(fs.readFileSync(wsPkgPath, 'utf-8'));
                  workspacePackages.push({
                    name: wsPkg.name || entry.name,
                    version: wsPkg.version,
                    deps: Object.keys(wsPkg.dependencies || {}).length,
                    devDeps: Object.keys(wsPkg.devDependencies || {}).length,
                  });
                } catch {}
              }
            }
          } catch {}
        }
      }
    }

    return ok(JSON.stringify({
      package: pkg.name || '(unnamed)',
      version: pkg.version,
      dependencies: deps,
      devDependencies: devDeps,
      peerDependencies: peerDeps,
      dependencyCount: Object.keys(deps).length,
      devDependencyCount: Object.keys(devDeps).length,
      scripts: Object.keys(pkg.scripts || {}),
      workspacePackages,
    }, null, 2));
  } catch (err) { return fail(`Dependency analysis failed: ${err.message}`); }
}

// -- Exports --

export function getTools() {
  return [
    { name: 'code_analyze_project', description: 'Analyze a project: language stats, deps, key files, structure', params: { path: 'string (required)' }, safety_level: 'read_only', category: 'code' },
    { name: 'code_find_symbols', description: 'Find symbol definitions (functions, classes, interfaces, types, enums, consts) in a codebase', params: { path: 'string', query: 'string', kind: 'all|function|class|interface|type|enum|const', exported_only: 'boolean', max_results: 'number' }, safety_level: 'read_only', category: 'code' },
    { name: 'code_get_tree', description: 'Get file/directory tree of a project', params: { path: 'string', max_depth: 'number', files_only: 'boolean' }, safety_level: 'read_only', category: 'code' },
    { name: 'code_analyze_deps', description: 'Analyze package.json dependencies, workspace packages, and scripts', params: { path: 'string (required)' }, safety_level: 'read_only', category: 'code' },
  ];
}

export async function execute(toolName, args) {
  try {
    switch (toolName) {
      case 'code_analyze_project': return codeAnalyzeProject(args);
      case 'code_find_symbols':    return codeFindSymbols(args);
      case 'code_get_tree':        return codeGetTree(args);
      case 'code_analyze_deps':    return codeAnalyzeDeps(args);
      default: return fail(`Unknown coding-kit tool: ${toolName}`);
    }
  } catch (err) { return fail(`Coding kit error: ${err.message}`); }
}

export async function detect() {
  // Coding kit tools use filesystem operations; always available
  // Also check for git (useful but not required)
  try {
    execFileSync('git', ['--version'], { stdio: 'pipe', timeout: 3000 });
    return true;
  } catch { return true; } // Available even without git
}

export const name = 'coding-kit';
export const description = 'Code intelligence: project analysis, symbol search, dependency analysis';
