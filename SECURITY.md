# Security Policy

## Security Model

Asimov's Mind employs a layered security architecture:

- **Sovereign Vault**: AES-256-GCM encrypted storage for API keys, tokens, and sensitive credentials. The vault is unlocked per-session with a user passphrase and never writes decrypted secrets to disk.
- **Privacy Shield**: All outbound data passes through a privacy filter that strips personally identifiable information before it reaches external APIs. Users can configure protected zones that are never transmitted.
- **cLaw Governance**: A set of inviolable rules (cLaws) that constrain agent behavior. cLaws cannot be overridden by prompts, plugins, or external instructions. They enforce safety floors on destructive operations, data exfiltration, and unauthorized access.

## Security Hardening (v2.2.0 -- v2.3.0)

The v2.2.0 release was a full security audit. v2.3.0 continued with 50 improvement cycles. The following vulnerabilities were identified and closed.

### Vault

| ID | Vulnerability | Fix |
|----|--------------|-----|
| SEC-007 | Path traversal via crafted vault keys | Key validation rejects `/`, `\`, `..`, and any character outside `[a-zA-Z0-9_\-:.]`; keys capped at 128 characters |
| SEC-NS | Namespace separator collision | Vault key namespace separator changed from `/` to `:`; vault now rejects any key containing `/` |

### HTTP Bridge

| ID | Vulnerability | Fix |
|----|--------------|-----|
| SEC-005 | Unauthenticated write endpoints | Write endpoints (`/write`, `/append`) and `/tool/:name` require `Authorization: Bearer <token>`; 64-hex-char token generated at startup, written to `.asimovs-mind/vault/bridge-token` (mode 0o600) |
| SEC-006 | Unrestricted tool execution via HTTP | `/tool/:name` restricted to four read-only tools: `vault_status`, `ollama_status`, `session_status`, `personality_status`; all others return HTTP 403 |
| SEC-009 | Unbounded POST bodies | Request bodies capped at 4 MB; requests exceeding this are rejected before reading |
| SEC-HOOK | Hook bearer token not sent on writes | `vault_bridge.py` corrected to include `Authorization: Bearer <token>` on all POST/PUT requests, not only GET |

### P2P

| ID | Vulnerability | Fix |
|----|--------------|-----|
| SEC-002 | WebSocket server bound to 0.0.0.0 | `subsystems/p2p/transport.js` now binds to `127.0.0.1`; direct network exposure was unintended |
| SEC-003 | Decryption before signature verification | `subsystems/p2p/protocol.js` verifies Ed25519 signature before decrypting ciphertext |
| SEC-P2P | HKDF not applied to shared secret | Proper RFC 5869 HKDF added to channel setup; raw shared-secret truncation replaced |
| SEC-P2P2 | Signature not bound to authenticated peer key | Signature verification now checks against the stored peer public key from the pairing record |

### Input Validation

| ID | Vulnerability | Fix |
|----|--------------|-----|
| SEC-001 | Absolute-path bypass in protected-zone enforcement | `hooks/first-law.py` strips `CLAUDE_PLUGIN_ROOT` prefix before comparing against protected-zone patterns |
| SEC-011 | Provenance markers bypassing safety scanner | `hooks/safety-scanner-hook.py` always runs AST scanner on writes to `hooks/` and `governance/` regardless of provenance markers; `hooks/**` added to `custom_zones` in `governance/protected-zones.json` |

### Dashboard

| ID | Vulnerability | Fix |
|----|--------------|-----|
| SEC-XSS | Stored XSS via memory entries and peer IDs | All user-supplied values rendered through `escHtml()` before DOM insertion |
| SEC-CSP | No Content Security Policy | Dashboard HTTP response includes `Content-Security-Policy` header blocking inline scripts |

### Governance

The dead-code `mcp/vault-server/` directory (160 KB, precursor to friday-core) was removed in v2.2.0. All surviving references cleaned up in v2.3.0.

---

## Current Security Invariants

These invariants must not be broken. Any change that touches one requires explicit review.

| Invariant | Where enforced |
|-----------|---------------|
| Vault keys cannot contain path separators or `..` | `core/vault.js` `validateKey()` |
| Vault key namespace separator is `:`; `/` is rejected | `core/vault.js` `validateKey()` |
| Protected zones checked against both relative and absolute paths | `hooks/first-law.py` (CLAUDE_PLUGIN_ROOT stripped before comparison) |
| HTTP bridge only accepts 127.0.0.1 connections | `index.js` remoteAddress check at the top of every request handler |
| Write endpoints require bearer token | `index.js` `requiresAuth` check before route matching |
| `/tool/:name` restricted to 4 read-only tools | `index.js` `HTTP_TOOL_WHITELIST` |
| POST bodies capped at 4 MB | `index.js` `readBody()` |
| P2P WebSocket binds to 127.0.0.1 only | `subsystems/p2p/transport.js` |
| P2P: signature verified before decryption | `subsystems/p2p/protocol.js` |
| Safety scanner always runs on hooks/ and governance/ writes | `hooks/safety-scanner-hook.py` |

---

## Known Limitations

- **Passphrase in transcript (mitigated)**: If you run `/friday unlock` in the conversation, the passphrase appears in the Claude Code transcript. The browser-based passphrase gate (the URL shown at startup) avoids this entirely -- the passphrase is POSTed directly to the local HTTP bridge and never touches the API channel. Browser entry is the recommended path.
- **Claude API channel**: Communication between the local MCP server and the Claude API is encrypted in transit (TLS), but the content is processed by Anthropic's servers. Do not store information in the conversation that you would not share with Anthropic.
- **Local-only encryption**: The vault protects secrets at rest on the local filesystem. It does not protect against an attacker with full access to the running process's memory.
- **Federation trust**: Federated peer connections rely on mutual authentication, but the protocol is under active development. Treat federation as experimental.
- **Dashboard CSP inline styles**: The dashboard CSP permits `unsafe-inline` for styles due to Three.js dynamic style injection. Script execution is fully restricted.

## Reporting Vulnerabilities

If you discover a security vulnerability, please report it responsibly:

1. **Email**: Send details to the repository maintainer (see the project README for contact information).
2. **GitHub Security Advisory**: Use the "Report a vulnerability" button on the repository's Security tab to file a private advisory.

Please include:
- A description of the vulnerability and its potential impact.
- Steps to reproduce.
- Any suggested fix or mitigation.

Do not open a public issue for security vulnerabilities.

## Response Timeline

- **Acknowledgment**: Within 48 hours of report receipt.
- **Initial assessment**: Within 7 days. We will confirm whether the report is accepted and provide a severity estimate.
- **Fix or mitigation**: Critical vulnerabilities will be patched within 14 days. Lower-severity issues will be addressed in the next scheduled release.
- **Disclosure**: We will coordinate disclosure timing with the reporter. We aim to publish advisories within 30 days of a fix being available.
