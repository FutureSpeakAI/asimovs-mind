---
name: peer
description: Encrypted P2P communication with other Asimov Agents. Connect, message, send files, exchange trust scores — all end-to-end encrypted with cLaw attestation verification.
user_invocable: true
---

# /peer — Encrypted Agent-to-Agent Communication

## Usage

```
/peer                      # Show connected peers and P2P status
/peer listen               # Start listening for incoming connections
/peer connect <address>    # Connect to a remote agent (ws://host:port)
/peer pair                 # Generate a pairing code for a peer
/peer send <peer_id> <msg> # Send encrypted message
/peer file <peer_id> <path> # Send encrypted file
/peer trust <peer_id>      # Exchange trust scores with peer
/peer attest <peer_id>     # Request fresh cLaw attestation from peer
/peer disconnect <peer_id> # Close channel, destroy session keys
```

## How It Works

Every Asimov Agent has an Ed25519 signing keypair and an X25519 exchange keypair, stored encrypted in the Sovereign Vault. When two agents connect, they perform a cryptographic handshake:

1. **Attestation exchange**: Each agent proves its cLaws are intact by sending a signed hash of its Fundamental Laws. If attestation fails, the connection is refused. An ungoverned agent cannot participate.

2. **Key agreement**: X25519 ECDH derives a shared secret. Neither agent's private key ever leaves its vault. The shared secret is used to derive session keys via HKDF with domain separation.

3. **Session keys**: Two AES-256-GCM keys are derived — one for each direction. Alice's encrypt key equals Bob's decrypt key, and vice versa. A 6-digit safety number is computed for manual MITM verification.

4. **Encrypted channel**: Every message is AES-256-GCM encrypted with sequence numbers (AAD) to prevent reordering. Every ciphertext is Ed25519 signed for authentication and non-repudiation.

## Instructions

When the user runs `/peer` with no arguments, call `peer_list` to show connected peers.

When the user runs `/peer listen`:
1. Call `peer_listen` to start the WebSocket server
2. Report the port and address
3. Suggest: "Share this address with a peer: ws://YOUR_IP:{port}"

When the user runs `/peer connect <address>`:
1. Verify identity exists (call `identity_status`). If not, tell user to run `/federate init` first.
2. Call `peer_connect` with the address
3. Report connection status, safety number for verification

When the user runs `/peer pair`:
1. Call `peer_pairing_code` to generate an 8-character code
2. Tell user to share the code verbally or via secure channel
3. The peer enters this code to verify they connected to the right agent

When the user runs `/peer send <peer_id> <message>`:
1. Call `peer_send` with the peer_id and message
2. Report success and sequence number

When the user runs `/peer file <peer_id> <path>`:
1. Call `peer_send_file` with peer_id and file path
2. Report file transfer progress (chunks sent, checksum)

When the user runs `/peer trust <peer_id>`:
1. Read local trust scores from vault via `vault_read("trust-scores")`
2. Call `peer_send` with type "trust" and the scores
3. Explain: trust scores are shared voluntarily; the peer can factor them into their own trust calculations but is not obligated to

When the user runs `/peer attest <peer_id>`:
1. Call `peer_send` with type "attestation"
2. This sends a fresh cLaw attestation to the peer, proving governance is still intact mid-session

When the user runs `/peer disconnect <peer_id>`:
1. Call `peer_disconnect`
2. Confirm: "Channel closed. Session keys destroyed."

## Security Properties

- **End-to-end encryption**: Only the two peers can read messages. No intermediary (including Claude Code, Anthropic, or any network observer) can decrypt.
- **Forward secrecy**: Each session derives fresh keys from an ephemeral ECDH exchange. Compromising a long-term key does not reveal past sessions.
- **Attestation-gated**: Connection requires valid cLaw attestation. An agent whose governance has been tampered with cannot establish channels.
- **Sequence integrity**: Reordered or replayed messages are rejected via AAD-bound sequence numbers.
- **Non-repudiation**: Ed25519 signatures on ciphertext prove authorship.
- **Safety numbers**: 6-digit code for manual MITM detection, displayed to both users.

## What Flows Over This Channel

- **Text**: Agent-to-agent conversation, instructions, status updates
- **Files**: Source code, documents, configuration — encrypted and chunked
- **Transactions**: Structured data with type + payload + dual signatures
- **Trust scores**: Reputation data shared voluntarily between federation nodes
- **Attestations**: Proof of governance integrity, requestable at any time

This is the encrypted communication layer described in the cLaw Specification Section 7. Every piece of electronic thought an Asimov Agent produces or receives can flow through this channel.
