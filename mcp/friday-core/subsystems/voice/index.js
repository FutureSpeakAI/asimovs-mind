/**
 * Voice Subsystem -- Voice pipeline state management and fallback coordination.
 *
 * Tools (3):
 *   voice_state           -- Query/transition the voice state machine
 *   voice_health          -- Report and query health check status
 *   voice_fallback_status -- Manage fallback paths and priorities
 *
 * Ported from nexus-os: voice-state-machine.ts, voice-fallback-manager.ts,
 *   voice-health-monitor.ts. Stripped: Electron, audio hardware, WebSocket,
 *   Whisper, Ollama, TTS, Gemini, AudioCapture.
 *
 * This does NOT capture audio or synthesize speech. It manages the state
 * machine that friday-voice (the Express server) uses. The actual audio
 * goes through friday-voice.
 */

import { z } from 'zod';
import { Subsystem } from '../../core/subsystem.js';
import { VoiceStateMachine } from './state-machine.js';
import { VoiceFallbackManager } from './fallback.js';

const VOICE_STATES = ['IDLE', 'CONNECTING', 'ACTIVE', 'PAUSED', 'ERROR', 'RECOVERING'];
const VOICE_PATHS = ['cloud', 'local', 'personaplex', 'text'];

export class VoiceSubsystem extends Subsystem {
  #stateMachine;
  #fallback;

  constructor(deps) {
    super('voice', deps);
    this.#stateMachine = new VoiceStateMachine();
    this.#fallback = new VoiceFallbackManager();
  }

  async start() {
    this.#stateMachine.initialize(this.eventBus);
    this.#fallback.initialize(this.eventBus);
    await super.start();
    this.log.info('Voice subsystem started (state tracking only, no audio hardware)');
  }

  async stop() {
    this.#stateMachine.reset();
    this.#fallback.reset();
    await super.stop();
  }

  registerEvents() {
    // friday-voice can emit these events to drive state transitions
    this.eventBus.on('voice:request-transition', ({ to, reason }) => {
      try {
        this.#stateMachine.transition(to, reason);
      } catch (err) {
        process.stderr.write(`[friday:voice] voice:request-transition failed: ${err.message}\n`);
      }
    });

    this.eventBus.on('voice:path-availability', ({ path, available, reason }) => {
      try {
        this.#fallback.setPathAvailability(path, available, reason);
      } catch (err) {
        process.stderr.write(`[friday:voice] voice:path-availability failed: ${err.message}\n`);
      }
    });
  }

  /** Expose internals for other subsystems */
  get stateMachine() { return this.#stateMachine; }
  get fallback() { return this.#fallback; }

  registerTools(server) {
    const sm = this.#stateMachine;
    const fb = this.#fallback;

    // -- voice_state ----------------------------------------------------------

    server.tool(
      'voice_state',
      'Query or transition the voice pipeline state machine. Actions: "get" returns current state and recent transitions, "transition" attempts a state change, "reset" returns to IDLE.',
      {
        action: z.enum(['get', 'transition', 'reset']).describe('Action to perform'),
        target_state: z.enum(VOICE_STATES).optional().describe('Target state (for transition)'),
        reason: z.string().optional().describe('Reason for transition'),
      },
      async ({ action, target_state, reason }) => {
        switch (action) {
          case 'get': {
            const snapshot = sm.getSnapshot();
            return {
              content: [{ type: 'text', text: JSON.stringify(snapshot, null, 2) }],
            };
          }

          case 'transition': {
            if (!target_state) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'target_state required' }) }] };
            }
            const canTransition = sm.canTransition(target_state);
            if (!canTransition) {
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    transitioned: false,
                    currentState: sm.getState(),
                    targetState: target_state,
                    reason: `Illegal transition from ${sm.getState()} to ${target_state}`,
                  }, null, 2),
                }],
              };
            }

            const success = sm.transition(target_state, reason || 'MCP tool request');
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  transitioned: success,
                  currentState: sm.getState(),
                  uptimeMs: sm.getUptime(),
                }, null, 2),
              }],
            };
          }

          case 'reset': {
            sm.reset();
            return {
              content: [{ type: 'text', text: JSON.stringify({ reset: true, state: sm.getState() }) }],
            };
          }

          default:
            return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown action: ${action}` }) }] };
        }
      },
    );

    // -- voice_health ---------------------------------------------------------

    server.tool(
      'voice_health',
      'Report or query voice pipeline health. Actions: "report" records a health check result, "status" returns the full health report with escalation levels.',
      {
        action: z.enum(['report', 'status']).describe('Action'),
        check_name: z.string().optional().describe('Health check name (for report)'),
        healthy: z.boolean().optional().describe('Whether the check passed (for report)'),
      },
      async ({ action, check_name, healthy }) => {
        switch (action) {
          case 'report': {
            if (!check_name || healthy === undefined) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'check_name and healthy required' }) }] };
            }
            fb.recordHealthCheck(check_name, healthy);
            sm.reportHealth(healthy);

            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  recorded: true,
                  checkName: check_name,
                  healthy,
                  stateHealth: sm.getHealth(),
                }, null, 2),
              }],
            };
          }

          case 'status': {
            const healthReport = fb.getHealthReport();
            const stateHealth = sm.getHealth();

            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  voiceState: stateHealth,
                  checks: healthReport,
                }, null, 2),
              }],
            };
          }

          default:
            return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown action: ${action}` }) }] };
        }
      },
    );

    // -- voice_fallback_status ------------------------------------------------

    server.tool(
      'voice_fallback_status',
      'Query and manage voice fallback paths. Actions: "status" returns full fallback state, "set_availability" declares a path available/unavailable, "set_priority" changes path priority, "record_failure" records a path failure and gets next fallback, "start_path" activates a path.',
      {
        action: z.enum(['status', 'set_availability', 'set_priority', 'record_failure', 'start_path']).describe('Action'),
        path: z.enum(VOICE_PATHS).optional().describe('Voice path'),
        available: z.boolean().optional().describe('Availability (for set_availability)'),
        reason: z.string().optional().describe('Reason for unavailability or failure'),
        priority: z.number().int().min(0).max(99).optional().describe('Priority (for set_priority; lower = tried first)'),
      },
      async ({ action, path, available, reason, priority }) => {
        switch (action) {
          case 'status': {
            const snapshot = fb.getSnapshot();
            return {
              content: [{ type: 'text', text: JSON.stringify(snapshot, null, 2) }],
            };
          }

          case 'set_availability': {
            if (!path || available === undefined) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'path and available required' }) }] };
            }
            fb.setPathAvailability(path, available, reason);
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({ set: true, path, available, reason }, null, 2),
              }],
            };
          }

          case 'set_priority': {
            if (!path || priority === undefined) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'path and priority required' }) }] };
            }
            fb.setPathPriority(path, priority);
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({ set: true, path, priority, priorities: fb.getPriorities() }, null, 2),
              }],
            };
          }

          case 'record_failure': {
            if (!path) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'path required' }) }] };
            }
            const result = fb.recordPathFailure(path, reason || 'Unknown failure');
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  failedPath: path,
                  nextPath: result.nextPath,
                  exhausted: result.exhausted,
                  allErrors: fb.getPathErrors(),
                }, null, 2),
              }],
            };
          }

          case 'start_path': {
            if (!path) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'path required' }) }] };
            }
            fb.startPath(path);
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({ started: true, currentPath: fb.getCurrentPath() }, null, 2),
              }],
            };
          }

          default:
            return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown action: ${action}` }) }] };
        }
      },
    );
  }
}
