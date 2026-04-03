/**
 * Vault Subsystem — Encrypted state storage tools
 *
 * Tools: vault_status, vault_initialize, vault_unlock, vault_lock,
 *        vault_read, vault_write, vault_append, vault_delete,
 *        vault_list, vault_export
 */

import { z } from 'zod';
import { Subsystem } from '../../core/subsystem.js';

export class VaultSubsystem extends Subsystem {
  #ollama;
  #registryRef;

  constructor(deps) {
    super('vault', deps);
    this.#ollama = deps.ollamaMonitor;
    this.#registryRef = null;
  }

  /** Allow index.js to inject the registry reference for stats reporting */
  setRegistry(registry) {
    this.#registryRef = registry;
  }

  registerTools(server) {
    const vault = this.vault;
    const ollama = this.#ollama;
    const self = this;

    server.tool('vault_status', 'Check vault status, subsystem health, and Ollama connectivity', {}, async () => {
      const ollamaStatus = await ollama.checkHealth();
      const registryStats = self.#registryRef ? self.#registryRef.stats : {};
      const subsystemNames = Object.keys(registryStats);
      const runningCount = subsystemNames.filter(n => registryStats[n].started).length;
      return {
        content: [{ type: 'text', text: JSON.stringify({
          vault: vault.status,
          meta: vault.meta,
          ollama: { healthy: ollamaStatus.healthy, modelCount: ollamaStatus.models.length },
          privacy_shield: { active: vault.status === 'unlocked' },
          subsystems: {
            total: subsystemNames.length,
            running: runningCount,
            registered: subsystemNames,
            details: registryStats
          }
        }, null, 2) }]
      };
    });

    server.tool('vault_initialize',
      'Initialize a new vault with a passphrase (>= 8 words). Creates encrypted storage.',
      { passphrase: z.string().max(1024).describe('Passphrase (minimum 8 words, 24+ characters, max 1KB)') },
      async ({ passphrase }) => {
        const result = await vault.initialize(passphrase);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      }
    );

    server.tool('vault_unlock',
      'Unlock an existing vault with the passphrase. Derives keys, verifies canary.',
      { passphrase: z.string().max(1024).describe('Vault passphrase') },
      async ({ passphrase }) => {
        const result = await vault.unlock(passphrase);
        if (result.success) {
          self.eventBus.publish('vault:unlocked', { timestamp: Date.now() });
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      }
    );

    server.tool('vault_lock',
      'Lock the vault. Destroys all keys in memory.',
      {},
      async () => {
        self.eventBus.publish('vault:locking', { timestamp: Date.now() });
        vault.lock();
        return { content: [{ type: 'text', text: '{"success": true, "status": "locked"}' }] };
      }
    );

    server.tool('vault_read',
      'Read and decrypt a named state entry from the vault.',
      { key: z.string().max(200).describe('State key (e.g., "user-profile", "trust-scores")') },
      async ({ key }) => {
        const result = await vault.read(key);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
    );

    server.tool('vault_write',
      'Encrypt and persist a named state entry in the vault.',
      {
        key: z.string().max(200).describe('State key'),
        data: z.any().describe('JSON data to encrypt and store')
      },
      async ({ key, data }) => {
        if (JSON.stringify(data).length > 1_048_576) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Data exceeds maximum size of 1 MB' }) }] };
        }
        const result = await vault.write(key, data);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
    );

    server.tool('vault_append',
      'Append an entry to an array stored in the vault.',
      {
        key: z.string().max(200).describe('State key (must be an array)'),
        entry: z.any().describe('Entry to append')
      },
      async ({ key, entry }) => {
        if (JSON.stringify(entry).length > 1_048_576) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Entry exceeds maximum size of 1 MB' }) }] };
        }
        const result = await vault.append(key, entry);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
    );

    server.tool('vault_delete',
      'Remove a named state entry from the vault.',
      { key: z.string().max(200).describe('State key to delete') },
      async ({ key }) => {
        const result = await vault.delete(key);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
    );

    server.tool('vault_list',
      'List all encrypted state keys in the vault.',
      {},
      async () => {
        const result = await vault.listKeys();
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
    );

    server.tool('vault_export',
      'Export all vault state as a JSON object (decrypted, for backup/migration).',
      {},
      async () => {
        const result = await vault.exportAll();
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
    );
  }
}
