/**
 * Identity Subsystem — Ed25519 signing + cLaw attestation tools
 *
 * Tools: identity_generate, identity_status, identity_sign, identity_verify,
 *        attestation_generate, attestation_verify
 */

import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Subsystem } from '../../core/subsystem.js';

export class IdentitySubsystem extends Subsystem {
  constructor(deps) {
    super('identity', deps);
  }

  registerTools(server) {
    const vault = this.vault;

    server.tool('identity_generate',
      'Generate Ed25519 signing + X25519 exchange keypairs. Stored encrypted in vault.',
      { name: z.string().max(200).describe('Agent/node name for this identity') },
      async ({ name }) => {
        const result = await vault.generateIdentity(name);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
    );

    server.tool('identity_status',
      'Check if a cryptographic identity exists and is loaded.',
      {},
      async () => {
        const result = await vault.getIdentity();
        const exists = result.success && result.data != null;
        return {
          content: [{ type: 'text', text: JSON.stringify({
            exists,
            name: exists ? result.data.name : null,
            publicKeys: exists ? {
              signing: result.data.signing.publicKey,
              exchange: result.data.exchange.publicKey
            } : null
          }, null, 2) }]
        };
      }
    );

    server.tool('identity_sign',
      'Sign a message with the Ed25519 private key.',
      { message: z.string().max(100_000).describe('Message to sign') },
      async ({ message }) => {
        const result = await vault.signMessage(message);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
    );

    server.tool('identity_verify',
      'Verify an Ed25519 signature.',
      {
        message: z.string(),
        signature: z.string().max(500).describe('Base64-encoded signature'),
        publicKey: z.string().max(500).describe('Base64-encoded Ed25519 public key')
      },
      async ({ message, signature, publicKey }) => {
        const valid = vault.verifySignature(message, signature, publicKey);
        return { content: [{ type: 'text', text: JSON.stringify({ valid }, null, 2) }] };
      }
    );

    server.tool('attestation_generate',
      'Generate a cLaw attestation (laws hash + timestamp + Ed25519 signature).',
      { laws_text: z.string().max(100_000).describe('Full text of the Fundamental Laws') },
      async ({ laws_text }) => {
        const result = await vault.generateAttestation(laws_text);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
    );

    server.tool('attestation_verify',
      'Verify a peer\'s cLaw attestation.',
      {
        attestation: z.object({
          lawsHash: z.string(),
          timestamp: z.number(),
          signature: z.string(),
          signerPublicKey: z.string()
        }),
        laws_text: z.string().max(100_000).describe('Expected laws text to verify hash against')
      },
      async ({ attestation, laws_text }) => {
        const result = vault.verifyAttestation(attestation, laws_text);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
    );
  }
}

/**
 * Read the canonical laws.json from the governance directory.
 * Used by identity and p2p subsystems for attestation generation.
 */
export async function getCanonicalLaws() {
  try {
    const PROJECT_ROOT = process.env.CLAUDE_PROJECT_ROOT || process.cwd();
    const lawsPath = path.join(PROJECT_ROOT, '.asimovs-mind', 'governance', 'laws.json');
    return await fs.readFile(lawsPath, 'utf-8');
  } catch {
    return '{"error": "laws.json not found"}';
  }
}
