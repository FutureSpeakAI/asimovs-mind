# Security Policy

## Security Model

Asimov's Mind employs a layered security architecture:

- **Sovereign Vault**: AES-256-GCM encrypted storage for API keys, tokens, and sensitive credentials. The vault is unlocked per-session with a user passphrase and never writes decrypted secrets to disk.
- **Privacy Shield**: All outbound data passes through a privacy filter that strips personally identifiable information before it reaches external APIs. Users can configure protected zones that are never transmitted.
- **cLaw Governance**: A set of inviolable rules (cLaws) that constrain agent behavior. cLaws cannot be overridden by prompts, plugins, or external instructions. They enforce safety floors on destructive operations, data exfiltration, and unauthorized access.

## Known Limitations

- **Passphrase in transcript**: The vault unlock passphrase is entered as plaintext in the Claude Code conversation. It may appear in session logs or transcripts. Use a dedicated passphrase you do not reuse elsewhere.
- **Claude API channel**: Communication between the local MCP server and the Claude API is encrypted in transit (TLS), but the content is processed by Anthropic's servers. Do not store information in the conversation that you would not share with Anthropic.
- **Local-only encryption**: The vault protects secrets at rest on the local filesystem. It does not protect against an attacker with full access to the running process's memory.
- **Federation trust**: Federated peer connections rely on mutual authentication, but the protocol is under active development. Treat federation as experimental.

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
