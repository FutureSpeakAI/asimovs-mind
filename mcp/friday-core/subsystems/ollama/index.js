/**
 * Ollama Subsystem — Local LLM health monitoring
 *
 * Tools: ollama_status
 */

import { Subsystem } from '../../core/subsystem.js';
import { OllamaMonitor } from '../../core/vault.js';

export class OllamaSubsystem extends Subsystem {
  #ollama;

  constructor(deps) {
    super('ollama', deps);
    this.#ollama = new OllamaMonitor();
  }

  registerTools(server) {
    const ollama = this.#ollama;

    server.tool('ollama_status',
      'Check Ollama health and available models.',
      {},
      async () => {
        const status = await ollama.checkHealth();
        return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
      }
    );
  }
}
