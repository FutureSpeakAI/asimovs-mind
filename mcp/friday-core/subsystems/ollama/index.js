/**
 * Ollama Subsystem — Local LLM health monitoring
 *
 * Tools: ollama_status
 */

import { Subsystem } from '../../core/subsystem.js';

export class OllamaSubsystem extends Subsystem {
  #ollama;

  constructor(deps) {
    super('ollama', deps);
    this.#ollama = deps.ollamaMonitor;
  }

  registerTools(server) {
    const ollama = this.#ollama;

    server.tool('ollama_status',
      'Check Ollama health and available models.',
      {},
      async () => {
        try {
          const status = await ollama.checkHealth();
          return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
        } catch (err) {
          process.stderr.write(`[friday:ollama] Health check failed: ${err.message}\n`);
          return { content: [{ type: 'text', text: JSON.stringify({ available: false, error: err.message }) }] };
        }
      }
    );
  }
}
