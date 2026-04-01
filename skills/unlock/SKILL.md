---
name: unlock
description: "Unlock Agent Friday's encrypted vault. Handles first-time setup, browser-based passphrase entry, and vault status checks."
user_invocable: true
---

# /friday unlock -- Vault Unlock

Manage the encrypted vault that protects Friday's state. Handles first-time initialization, unlocking, and status checks.

## Usage

```
/friday unlock              # Unlock the vault (or initialize if first time)
/friday unlock status       # Check vault lock state
```

This skill is also triggered automatically when the personality-loader hook detects the vault is locked at session start.

## Instructions

### Determine Vault State

First, call the `vault_status` MCP tool to determine the current state. The vault will be in one of three states:

1. **Uninitialized** -- No vault exists yet. First-time setup needed.
2. **Locked** -- Vault exists but is locked. Passphrase required.
3. **Unlocked** -- Vault is already open. Nothing to do.

Branch based on the state:

---

### State: Uninitialized (First-Time Setup)

This is Friday's first run with the vault. Guide the user through setup with Friday's voice -- warm, direct, no corporate tone.

**Explain what's happening:**

```
This is the first time the vault has been set up on this machine.

The vault encrypts Friday's state at rest -- trust scores, memory,
routing config, identity keys, everything that makes Friday yours.
It uses AES-256-GCM encryption with an Argon2id-derived key. That
means your data is encrypted on disk, always, and only your passphrase
can unlock it.

No one else can read it. Not FutureSpeak. Not Anthropic. Not anyone
with access to this machine's filesystem unless they have your passphrase.
That is the sovereignty guarantee, and it is enforced by math, not policy.
```

**Explain passphrase requirements:**

```
The passphrase needs to be at least 8 words. Not a password -- a passphrase.
Something like "correct horse battery staple morning coffee river stone"
but actually meaningful to you so you remember it.

Why 8 words? Because passphrases derive the encryption key through Argon2id.
Shorter passphrases weaken the key. 8 words gives you strong entropy without
being a burden to remember.
```

**Collect the passphrase:**

Offer two paths:

1. **Browser entry (recommended):** Call `vault_status` to get the vault server's current state. The HTTP bridge port is written to `.asimovs-mind/vault/port`. Read this file to get the actual port number, then tell the user: "Open http://localhost:{port}/unlock in your browser to enter your passphrase securely." The passphrase never appears in the API transcript this way.

```
Recommended: Open http://localhost:{port}/unlock in your browser.
The browser form sends the passphrase directly to the local vault server.
It never passes through the conversation, so it stays out of API transcripts.
```

2. **Conversation entry (with warning):** If the user prefers to enter the passphrase in the conversation, warn them clearly.

```
You can also type your passphrase here, but fair warning: anything in this
conversation may appear in API transcripts or session logs. The browser
method is safer. Your call.
```

**Initialize the vault:**

Once the passphrase is provided (via either path):
1. Call `vault_initialize` MCP tool with the passphrase
2. Confirm success:

```
Vault initialized. Your state is encrypted at rest.

From now on, you'll unlock the vault at the start of each session.
The browser unlock page is always at http://localhost:{port}/unlock
```

---

### State: Locked

The vault exists but needs unlocking. Keep it brief.

**Offer unlock options:**

```
Vault is locked. Two ways to unlock:

1. Open http://localhost:{port}/unlock in your browser (passphrase stays
   out of the conversation transcript)

2. Type your passphrase here (it will be visible in the conversation)

Option 1 is safer. Your call.
```

Call `vault_status` to get the vault server's current state. The HTTP bridge port is written to `.asimovs-mind/vault/port`. Read this file to get the actual port number, then use it in the URL shown above.

**If the user provides the passphrase in conversation:**

1. Call `vault_unlock` MCP tool with the passphrase
2. On success: `Vault unlocked. Friday is fully operational.`
3. On failure: `Wrong passphrase. Try again, or use the browser at http://localhost:{port}/unlock`

**If the user uses the browser:**

The vault server handles the unlock directly. After the user says they've done it, call `vault_status` to confirm:
- If unlocked: `Vault unlocked. Good to go.`
- If still locked: `Still showing locked on my end. Try the browser again, or type the passphrase here.`

---

### State: Unlocked

Vault is already open. Confirm and move on.

```
Vault is already unlocked. Friday is fully operational.
```

If invoked with `/friday unlock status`, show more detail:

```
Vault Status: unlocked
Encrypted keys: N
Last unlocked: [timestamp]
Encryption: AES-256-GCM with Argon2id key derivation
```

---

## Automatic Trigger

The personality-loader hook checks vault status at session start. If the vault is locked or uninitialized, it injects a system prompt instructing Friday to run this skill before doing anything else. The user sees Friday naturally say something like:

```
Hey -- vault's locked. Need to unlock it before we can get going.
Open http://localhost:{port}/unlock in your browser, or type your passphrase here.
```

(Read the actual port from `.asimovs-mind/vault/port` at runtime.)

This keeps the unlock flow conversational, not mechanical.

## Governance

- The vault enforces the `encryption_at_rest` safety floor. It cannot be disabled.
- The `passphrase_min_words` floor (8 words) is enforced by the `vault_initialize` tool.
- The passphrase is never stored -- only the Argon2id-derived key hash is kept for verification.
- Private keys (Ed25519 identity, etc.) are stored inside the vault, never on disk in plaintext.
