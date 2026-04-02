/**
 * Plugin Validation Suite
 *
 * Validates the entire Asimov's Mind plugin structure:
 * - plugin.json references existing files
 * - All hook scripts compile (Python syntax)
 * - All governance JSONs are valid
 * - All skill/agent markdown has content
 * - MCP server files exist and are importable
 * - Federation directory structure is correct
 * - .gitignore is correct
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';

const PLUGIN_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

function pluginPath(...segments) {
  return path.join(PLUGIN_ROOT, ...segments);
}

async function fileExists(filePath) {
  try { await fs.access(filePath); return true; } catch { return false; }
}

// ============================================================
// TIER A: plugin.json Validity
// ============================================================

describe('TIER A: plugin.json Structure', () => {
  let plugin;

  it('plugin.json is valid JSON', async () => {
    const raw = await fs.readFile(pluginPath('plugin.json'), 'utf-8');
    plugin = JSON.parse(raw);
    assert.ok(plugin.name);
    assert.ok(plugin.version);
  });

  it('version matches package.json', async () => {
    const raw = await fs.readFile(pluginPath('plugin.json'), 'utf-8');
    const p = JSON.parse(raw);
    const pkgRaw = await fs.readFile(pluginPath('mcp', 'friday-core', 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgRaw);
    assert.equal(p.version, pkg.version, 'plugin.json version should match package.json version');
  });

  it('all hook commands reference existing Python files', async () => {
    const raw = await fs.readFile(pluginPath('plugin.json'), 'utf-8');
    const p = JSON.parse(raw);
    const hookFiles = new Set();
    for (const [, entries] of Object.entries(p.hooks)) {
      for (const entry of entries) {
        const hooks = entry.hooks || [];
        for (const hook of hooks) {
          if (hook.command) {
            // Extract filename from command like "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/foo.py"
            const match = hook.command.match(/hooks\/([a-z0-9_-]+\.py)/);
            if (match) hookFiles.add(match[1]);
          }
        }
      }
    }
    for (const file of hookFiles) {
      const exists = await fileExists(pluginPath('hooks', file));
      assert.ok(exists, `Hook file missing: hooks/${file}`);
    }
  });

  it('MCP server entry references existing files', async () => {
    const raw = await fs.readFile(pluginPath('plugin.json'), 'utf-8');
    const p = JSON.parse(raw);
    if (p.mcpServers) {
      for (const [name, config] of Object.entries(p.mcpServers)) {
        if (config.args) {
          for (const arg of config.args) {
            const resolved = arg.replace('${CLAUDE_PLUGIN_ROOT}', PLUGIN_ROOT);
            const exists = await fileExists(resolved);
            assert.ok(exists, `MCP server file missing for ${name}: ${resolved}`);
          }
        }
      }
    }
  });
});

// ============================================================
// TIER B: Hook Compilation
// ============================================================

describe('TIER B: Python Hook Compilation', () => {
  it('all .py files in hooks/ compile without syntax errors', async () => {
    const hookDir = pluginPath('hooks');
    const files = await fs.readdir(hookDir);
    const pyFiles = files.filter(f => f.endsWith('.py'));
    assert.ok(pyFiles.length >= 8, `Expected >= 8 hook files, found ${pyFiles.length}`);

    // Try python3 first, fall back to python (Windows compatibility)
    let pythonCmd = 'python3';
    try {
      execSync(`${pythonCmd} --version`, { stdio: 'pipe', timeout: 5000 });
    } catch {
      pythonCmd = 'python';
    }

    for (const file of pyFiles) {
      const fullPath = path.join(hookDir, file);
      try {
        execSync(`${pythonCmd} -c "import py_compile; py_compile.compile('${fullPath.replace(/\\/g, '/')}', doraise=True)"`, {
          timeout: 10000,
          stdio: 'pipe'
        });
      } catch (err) {
        assert.fail(`Hook ${file} has syntax errors: ${err.stderr?.toString() || err.message}`);
      }
    }
  });

  it('vault_bridge.py exists and compiles', async () => {
    const bridgePath = pluginPath('hooks', 'vault_bridge.py');
    assert.ok(await fileExists(bridgePath), 'vault_bridge.py missing');
  });

  it('privacy-shield-scrub.py exists and compiles', async () => {
    assert.ok(await fileExists(pluginPath('hooks', 'privacy-shield-scrub.py')));
  });

  it('privacy-shield-rehydrate.py exists and compiles', async () => {
    assert.ok(await fileExists(pluginPath('hooks', 'privacy-shield-rehydrate.py')));
  });
});

// ============================================================
// TIER C: Governance File Validation
// ============================================================

describe('TIER C: Governance JSON Files', () => {
  const governanceFiles = [
    'governance/laws.json',
    'governance/protected-zones.json',
    'governance/safety-floors.json',
    'governance/discovery-rules.json'
  ];

  for (const file of governanceFiles) {
    it(`${file} is valid JSON`, async () => {
      const raw = await fs.readFile(pluginPath(file), 'utf-8');
      const parsed = JSON.parse(raw);
      assert.ok(parsed, `${file} parsed to falsy value`);
    });
  }

  it('safety-floors.json has encryption_at_rest floor', async () => {
    const raw = await fs.readFile(pluginPath('governance', 'safety-floors.json'), 'utf-8');
    const floors = JSON.parse(raw);
    const _floorNames = Array.isArray(floors) ? floors.map(f => f.name || f.id) : Object.keys(floors);
    const allText = JSON.stringify(floors);
    assert.ok(allText.includes('encryption_at_rest'), 'Missing encryption_at_rest safety floor');
  });

  it('safety-floors.json has privacy_shield_on_cloud floor', async () => {
    const raw = await fs.readFile(pluginPath('governance', 'safety-floors.json'), 'utf-8');
    const allText = raw;
    assert.ok(allText.includes('privacy_shield_on_cloud'), 'Missing privacy_shield_on_cloud safety floor');
  });

  it('protected-zones.json includes vault pattern', async () => {
    const raw = await fs.readFile(pluginPath('governance', 'protected-zones.json'), 'utf-8');
    assert.ok(raw.includes('vault'), 'Protected zones should include vault directory');
  });

  it('conformance-report.md exists', async () => {
    assert.ok(await fileExists(pluginPath('governance', 'conformance-report.md')));
  });

  it('website-alignment.md exists', async () => {
    assert.ok(await fileExists(pluginPath('governance', 'website-alignment.md')));
  });
});

// ============================================================
// TIER D: Agent Definitions
// ============================================================

describe('TIER D: Agent Definitions', () => {
  const expectedAgents = [
    'swarm-coordinator', 'git-scout', 'git-loader', 'sentinel',
    'meta-improver', 'debugger', 'optimizer', 'architect',
    'auditor', 'evolver', 'breeder', 'librarian', 'scout',
    'creative', 'documenter', 'workflow-observer'
  ];

  for (const agent of expectedAgents) {
    it(`agents/${agent}.md exists and has content`, async () => {
      const filePath = pluginPath('agents', `${agent}.md`);
      assert.ok(await fileExists(filePath), `Missing: agents/${agent}.md`);
      const content = await fs.readFile(filePath, 'utf-8');
      assert.ok(content.length > 100, `agents/${agent}.md is too short (${content.length} chars)`);
    });
  }

  it('vault-aware agents mention vault', async () => {
    const vaultAwareAgents = ['swarm-coordinator', 'git-scout', 'git-loader', 'meta-improver', 'sentinel', 'workflow-observer'];
    for (const agent of vaultAwareAgents) {
      const content = await fs.readFile(pluginPath('agents', `${agent}.md`), 'utf-8');
      assert.ok(
        content.toLowerCase().includes('vault'),
        `agents/${agent}.md should mention vault (vault-awareness not added?)`
      );
    }
  });
});

// ============================================================
// TIER E: Skill Definitions
// ============================================================

describe('TIER E: Skill Definitions', () => {
  const expectedSkills = [
    'breed', 'create-agent', 'diagnose', 'discover', 'evolve',
    'federate', 'friday', 'govern', 'iterate', 'onboard',
    'remember', 'route', 'status', 'unleash', 'unlock', 'peer'
  ];

  for (const skill of expectedSkills) {
    it(`skills/${skill}/ exists with SKILL.md`, async () => {
      const filePath = pluginPath('skills', skill, 'SKILL.md');
      assert.ok(await fileExists(filePath), `Missing: skills/${skill}/SKILL.md`);
      const content = await fs.readFile(filePath, 'utf-8');
      assert.ok(content.length > 50, `skills/${skill}/SKILL.md is too short`);
    });
  }
});

// ============================================================
// TIER F: Directive Definitions
// ============================================================

describe('TIER F: Directive Definitions', () => {
  const expectedDirectives = [
    'discover', 'fix-tests', 'fix-types', 'full-sweep',
    'optimize-startup', 'security-hardening', 'local-sovereignty'
  ];

  for (const dir of expectedDirectives) {
    it(`directives/${dir}.md exists`, async () => {
      const filePath = pluginPath('directives', `${dir}.md`);
      assert.ok(await fileExists(filePath), `Missing: directives/${dir}.md`);
    });
  }
});

// ============================================================
// TIER G: MCP Vault Server Files
// ============================================================

describe('TIER G: MCP Friday Core Files', () => {
  const serverFiles = [
    'mcp/friday-core/package.json',
    'mcp/friday-core/bootstrap.js',
    'mcp/friday-core/index.js',
    'mcp/friday-core/core/crypto.js',
    'mcp/friday-core/core/vault.js',
    'mcp/friday-core/core/event-bus.js',
    'mcp/friday-core/core/subsystem.js',
    'mcp/friday-core/core/state-manager.js',
    'mcp/friday-core/subsystems/p2p/protocol.js',
    'mcp/friday-core/subsystems/p2p/transport.js',
    'mcp/friday-core/dashboard.html'
  ];

  for (const file of serverFiles) {
    it(`${file} exists`, async () => {
      assert.ok(await fileExists(pluginPath(file)), `Missing: ${file}`);
    });
  }

  it('package.json has correct dependencies', async () => {
    const raw = await fs.readFile(pluginPath('mcp', 'friday-core', 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw);
    assert.ok(pkg.dependencies['@modelcontextprotocol/sdk'], 'Missing MCP SDK dependency');
    assert.ok(pkg.dependencies['libsodium-wrappers-sumo'], 'Missing libsodium dependency');
    assert.ok(pkg.dependencies['ws'], 'Missing ws dependency');
  });

  it('node_modules exists (deps installed)', async () => {
    assert.ok(await fileExists(pluginPath('mcp', 'friday-core', 'node_modules')));
  });

  it('all 17 subsystem directories exist with index.js', async () => {
    const subsystems = [
      'vault', 'identity', 'privacy', 'p2p', 'ollama',
      'llm', 'memory', 'context', 'trust', 'personality',
      'agents', 'tools', 'connectors', 'gateway', 'briefing',
      'voice', 'enterprise'
    ];
    for (const sub of subsystems) {
      const indexPath = pluginPath('mcp', 'friday-core', 'subsystems', sub, 'index.js');
      assert.ok(await fileExists(indexPath), `Missing: subsystems/${sub}/index.js`);
    }
  });
});

// ============================================================
// TIER G2: MCP Protocol Safety
// ============================================================

describe('TIER G2: MCP Protocol Safety', () => {
  it('no console.log in production source (would corrupt MCP stdout)', async () => {
    const srcDir = pluginPath('mcp', 'friday-core');
    const violations = [];

    async function scanDir(dir) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === 'test') continue;
          await scanDir(fullPath);
        } else if (entry.name.endsWith('.js')) {
          const content = await fs.readFile(fullPath, 'utf-8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('console.log(')) {
              violations.push(`${path.relative(srcDir, fullPath)}:${i + 1}`);
            }
          }
        }
      }
    }

    await scanDir(srcDir);
    assert.equal(
      violations.length, 0,
      `console.log found in production code (use process.stderr.write instead):\n  ${violations.join('\n  ')}`
    );
  });
});

// ============================================================
// TIER H: Personality + Federation + Discovery
// ============================================================

describe('TIER H: Personality, Federation, Discovery', () => {
  it('personality/friday.md exists and mentions vault', async () => {
    const content = await fs.readFile(pluginPath('personality', 'friday.md'), 'utf-8');
    assert.ok(content.length > 500, 'friday.md too short');
    assert.ok(content.toLowerCase().includes('vault') || content.toLowerCase().includes('encrypt'),
      'friday.md should mention vault or encryption (sovereignty section updated?)');
  });

  it('discovery/memory.py exists and mentions vault', async () => {
    const content = await fs.readFile(pluginPath('discovery', 'memory.py'), 'utf-8');
    assert.ok(content.includes('vault'), 'memory.py should mention vault (vault integration added?)');
  });

  it('discovery/safety_scanner.py exists', async () => {
    assert.ok(await fileExists(pluginPath('discovery', 'safety_scanner.py')));
  });

  it('discovery/provenance.py exists', async () => {
    assert.ok(await fileExists(pluginPath('discovery', 'provenance.py')));
  });

  it('.asimovs-mind/federation/ directory exists', async () => {
    assert.ok(await fileExists(pluginPath('.asimovs-mind', 'federation')));
  });

  it('.asimovs-mind/.gitignore exists and ignores vault/', async () => {
    const gitignorePath = pluginPath('.asimovs-mind', '.gitignore');
    assert.ok(await fileExists(gitignorePath), '.asimovs-mind/.gitignore missing');
    const content = await fs.readFile(gitignorePath, 'utf-8');
    assert.ok(content.includes('vault'), '.gitignore should ignore vault/ directory');
  });

  it('framework/spec.json exists', async () => {
    assert.ok(await fileExists(pluginPath('framework', 'spec.json')));
  });
});

// ============================================================
// TIER I: Documentation
// ============================================================

describe('TIER I: Documentation', () => {
  it('README.md exists and mentions Sovereign Vault', async () => {
    const content = await fs.readFile(pluginPath('README.md'), 'utf-8');
    assert.ok(content.includes('Sovereign Vault') || content.includes('sovereign vault') || content.includes('AES-256-GCM'),
      'README should mention the Sovereign Vault');
  });

  it('README.md mentions Privacy Shield', async () => {
    const content = await fs.readFile(pluginPath('README.md'), 'utf-8');
    assert.ok(content.includes('Privacy Shield'), 'README should mention Privacy Shield');
  });

  it('README.md mentions P2P or encrypted communication', async () => {
    const content = await fs.readFile(pluginPath('README.md'), 'utf-8');
    assert.ok(content.includes('P2P') || content.includes('peer') || content.includes('encrypted communication') || content.includes('agent-to-agent'),
      'README should mention P2P encrypted communication');
  });

  it('ROADMAP.md exists and has future milestones', async () => {
    const content = await fs.readFile(pluginPath('ROADMAP.md'), 'utf-8');
    assert.ok(content.includes('2.0.0') || content.includes('2.1.0') || content.includes('Agent Friday'),
      'ROADMAP should mention v2.0.0 or future milestones');
  });

  it('LICENSE file exists', async () => {
    assert.ok(await fileExists(pluginPath('LICENSE')), 'LICENSE file missing');
  });
});
