# Contributing to Asimov's Mind

## Code Style

- Plain JavaScript ESM (import/export). No TypeScript.
- No external test framework. Tests use Node's built-in `node:test` and `node:assert`.
- `npm test` must pass before any PR is submitted.
- Review the security invariants in `CLAUDE.md` before touching vault, hooks, or governance files. Changes to any invariant listed there require explicit reviewer sign-off.

## How to Add a Connector

Connectors let the discovery subsystem detect and interact with external tools and services.

1. Create a new file in `mcp/friday-core/connectors/` named after the tool (e.g., `docker-connector.js`).
2. Export a class that implements three methods:
   - `detect()` -- returns `true` if the tool is available on this machine.
   - `getTools()` -- returns an array of MCP tool definitions this connector provides.
   - `execute(toolName, args)` -- runs the requested tool and returns the result.
3. Register the connector in the connector registry (`mcp/friday-core/connectors/index.js`).
4. Add the connector to the appropriate subsystem so its tools are exposed through MCP.
5. Write at least one test that verifies `detect()` and `getTools()` behave correctly.

## How to Add a Subsystem

Subsystems are the major functional blocks of Agent Friday.

1. Create a new directory under `mcp/friday-core/subsystems/` with an `index.js` entry point.
2. Export a class that extends `Subsystem` (from the framework).
3. Implement `registerTools()` to expose MCP tools.
4. Implement `registerEvents()` to hook into lifecycle events if needed.
5. Register the subsystem in `mcp/friday-core/index.js` using the tier registration syntax:
   ```js
   registry.register(new MySubsystem(deps), { tier: 2 });
   ```
   Choose the tier based on your dependencies: Tier 0 (no deps), Tier 1 (needs identity), Tier 2 (needs vault/ollama/event bus), Tier 3 (needs llm/memory/trust).
6. When constructing namespaced state keys, use `:` as the separator (not `/`). The `vault.js` key validator rejects keys containing forward slashes. Access state via `this.state.read('key')` and `this.state.write('key', value)` — the namespace prefix is added automatically.
7. Update the subsystem count and tool count in `CLAUDE.md`, `docs/API_REFERENCE.md`, `ROADMAP.md`, and `governance/conformance-report.md`.
8. Add tests.

## How to Add a Skill

Skills are slash commands that users invoke in Claude Code (e.g., `/help`, `/discover`).

1. Create a directory under `skills/` named after your skill (e.g., `skills/my-skill/`).
2. Add a `SKILL.md` file with YAML frontmatter:
   ```yaml
   ---
   name: my-skill
   description: "One-line description of what this skill does."
   user_invocable: true
   ---
   ```
3. Write the skill's instructions in the body of the Markdown file. These instructions tell Claude how to behave when the user invokes the skill.

## Testing

Run the full test suite:

```bash
cd mcp/friday-core
npm test
```

All tests must pass before opening a pull request. If you add a new connector or subsystem, include tests that cover at least the basic contract (detection, tool listing, simple execution).

## Pull Request Process

1. Fork the repo and create a feature branch.
2. Make your changes following the patterns above.
3. Run `npm test` and confirm all tests pass.
4. If you added a subsystem or changed tool counts, update `CLAUDE.md`, `docs/API_REFERENCE.md`, `ROADMAP.md`, and `governance/conformance-report.md`.
5. Open a PR using the provided template.
6. Describe any safety implications in the cLaw Review section. Reference the security invariants table in `CLAUDE.md` for any change that touches vault, hooks, the event bus, or governance files.
