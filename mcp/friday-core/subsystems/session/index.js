/**
 * Session Subsystem — Session lifecycle status and control
 *
 * Tools: session_status
 *
 * Wraps the SessionConductor (wired in index.js after registry.startAll) as
 * a proper subsystem so session_status is registered through the standard
 * tool pipeline rather than directly in main().
 *
 * The conductor is injected after construction via setConductor(), following
 * the same late-injection pattern used by VaultSubsystem.setRegistry().
 */

import { Subsystem } from '../../core/subsystem.js';

export class SessionSubsystem extends Subsystem {
  #conductor = null;

  constructor(deps) {
    super('session', deps);
  }

  /** Called from index.js after the SessionConductor is instantiated */
  setConductor(conductor) {
    this.#conductor = conductor;
  }

  registerTools(server) {
    const self = this;

    server.tool(
      'session_status',
      'Get current session status: uptime, working directory context, greeting, and pending commitments.',
      {},
      async () => {
        const c = self.#conductor;
        if (!c) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ error: 'Session conductor not yet available' }),
            }],
          };
        }
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              uptime: c.uptime,
              uptimeMin: Math.round(c.uptime / 60000),
              cwd: c.cwdContext,
              greeting: c.greeting,
              pendingCommitments: c.pendingCommitments.length,
              commitments: c.pendingCommitments.map(comm => ({
                id: comm.id,
                description: comm.description,
                personName: comm.personName,
                direction: comm.direction,
                deadline: comm.deadline ? new Date(comm.deadline).toISOString() : null,
              })),
            }, null, 2),
          }],
        };
      }
    );
  }
}
