/**
 * Agent Subsystem — Delegation, awareness mesh, and team coordination
 *
 * Tools: agent_delegate, agent_spawn, agent_halt, agent_status,
 *        agent_list_capabilities, agent_team_create, agent_team_status
 *
 * Combines:
 *   - Delegation engine: recursive task delegation with trust-tier inheritance
 *   - Awareness mesh: cross-agent coordination, dependency tracking, deadlock detection
 *   - Teams: parallel agent execution with shared goals and result aggregation
 *
 * Agent types: research, coding, analysis, creative, security
 *
 * Ported from nexus-os: delegation-engine.ts, awareness-mesh.ts,
 * orchestrator.ts, agent-teams.ts. Stripped Electron, agent-runner coupling,
 * office-manager, integrity-manager.
 */

import crypto from 'node:crypto';
import { z } from 'zod';
import { Subsystem } from '../../core/subsystem.js';
import { DelegationEngine } from './delegation.js';
import { AwarenessMesh } from './awareness.js';
import { AgentTeamManager } from './teams.js';

const AGENT_TYPES = [
  { name: 'research', description: 'Research and fact-finding across web and documents' },
  { name: 'coding', description: 'Code generation, review, debugging, architecture' },
  { name: 'analysis', description: 'Data analysis, pattern recognition, strategic thinking' },
  { name: 'creative', description: 'Creative writing, brainstorming, ideation' },
  { name: 'security', description: 'Security review, threat analysis, privacy assessment' },
  { name: 'summarize', description: 'Summarize and distill information into key points' },
  { name: 'draft-email', description: 'Draft emails, messages, and communications' },
  { name: 'orchestrate', description: 'Decompose complex goals into sub-tasks and coordinate agents' },
];

const TRUST_TIERS = ['local', 'owner-dm', 'approved-dm', 'group', 'public'];

export class AgentSubsystem extends Subsystem {
  #delegation;
  #mesh;
  #teams;
  #cleanupInterval = null;

  constructor(deps) {
    super('agents', deps);
    this.#delegation = new DelegationEngine();
    this.#mesh = new AwarenessMesh();
    this.#teams = new AgentTeamManager();
  }

  async start() {
    this.#delegation.initialize(this.eventBus);
    this.#mesh.initialize(this.eventBus);
    await super.start();
    this.log.info('Agent subsystem started');
  }

  async stop() {
    // Cancel the periodic cleanup interval registered in registerEvents()
    if (this.#cleanupInterval) {
      clearInterval(this.#cleanupInterval);
      this.#cleanupInterval = null;
    }
    // Halt all active trees on shutdown
    await this.#delegation.haltAll();
    this.#mesh.cleanup();
    await super.stop();
  }

  registerEvents() {
    // When an agent completes, deregister from mesh and report to delegation
    this.eventBus.on('agent:completed', (data) => {
      this.#mesh.deregisterAgent(data.taskId, data.result);
      this.#delegation.reportCompletion(data.taskId, data.result, null);
    });

    this.eventBus.on('agent:failed', (data) => {
      this.#mesh.deregisterAgent(data.taskId);
      this.#delegation.reportCompletion(data.taskId, null, data.error);
    });

    // Periodic cleanup
    this.#cleanupInterval = setInterval(() => {
      this.#delegation.cleanup();
      this.#teams.cleanup();
    }, 5 * 60 * 1000);
    this.#cleanupInterval.unref();
  }

  /** Expose components for other subsystems */
  get delegation() { return this.#delegation; }
  get mesh() { return this.#mesh; }
  get teams() { return this.#teams; }

  registerTools(server) {
    const delegation = this.#delegation;
    const mesh = this.#mesh;
    const teams = this.#teams;
    const eventBus = this.eventBus;

    // -- agent_delegate -----------------------------------------------------

    server.tool(
      'agent_delegate',
      'Delegate a sub-task to a child agent within a delegation tree. Enforces trust-tier inheritance, depth limits, and circuit breakers.',
      {
        parentTaskId: z.string().describe('Task ID of the parent agent'),
        agentType: z.string().describe('Type of agent to spawn (research, coding, analysis, creative, security, summarize, draft-email)'),
        description: z.string().max(10_000).describe('What this sub-agent should accomplish'),
        input: z.record(z.unknown()).default({}).describe('Input data for the sub-agent'),
        trustTier: z.enum(TRUST_TIERS).optional().describe('Trust tier (can only degrade from parent)'),
        context: z.string().max(50_000).optional().describe('Additional context from parent'),
      },
      async ({ parentTaskId, agentType, description, input, trustTier, context }) => {
        const result = delegation.prepareSubAgent({
          agentType,
          description,
          parentTaskId,
          trustTier,
          parentContext: context,
        });

        if (!result.success) {
          return { content: [{ type: 'text', text: JSON.stringify({ delegated: false, error: result.error }) }] };
        }

        // Register in awareness mesh
        mesh.registerAgent(result.taskId, agentType, description, {
          trustTier: result.node.trustTier,
          treeRoot: delegation.isInTree(parentTaskId) ? parentTaskId : undefined,
          parentId: parentTaskId,
          role: 'sub-agent',
        });

        // Emit spawn event for external runner to pick up
        eventBus.publish('agent:spawn_requested', {
          taskId: result.taskId,
          agentType,
          description,
          input: { ...input, __delegation: result.node },
        });

        delegation.markRunning(result.taskId);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              delegated: true,
              taskId: result.taskId,
              agentType,
              depth: result.node.depth,
              trustTier: result.node.trustTier,
            }, null, 2)
          }]
        };
      }
    );

    // -- agent_spawn --------------------------------------------------------

    server.tool(
      'agent_spawn',
      'Spawn a top-level agent. Creates a new delegation root and registers in the awareness mesh.',
      {
        agentType: z.string().max(50).describe('Agent type (research, coding, analysis, creative, security, summarize, draft-email, orchestrate)'),
        description: z.string().max(10_000).describe('What this agent should accomplish'),
        input: z.record(z.unknown()).default({}).describe('Input data for the agent'),
        trustTier: z.enum(TRUST_TIERS).default('local').describe('Trust tier for this agent'),
      },
      async ({ agentType, description, input, trustTier }) => {
        const taskId = crypto.randomUUID();

        // Register as delegation root
        delegation.registerRoot(taskId, agentType, description, trustTier);

        // Register in mesh
        mesh.registerAgent(taskId, agentType, description, {
          trustTier,
          treeRoot: taskId,
          role: 'solo',
        });

        // Emit spawn event
        eventBus.publish('agent:spawn_requested', {
          taskId,
          agentType,
          description,
          input,
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              spawned: true,
              taskId,
              agentType,
              trustTier,
            }, null, 2)
          }]
        };
      }
    );

    // -- agent_halt ---------------------------------------------------------

    server.tool(
      'agent_halt',
      'Halt an agent and all its descendants. Propagates halt signal through the delegation tree.',
      {
        taskId: z.string().describe('Task ID of the agent to halt (halts entire subtree)'),
      },
      async ({ taskId }) => {
        const result = await delegation.haltTree(taskId);

        // Deregister halted agents from mesh
        for (const pr of result.partialResults) {
          mesh.deregisterAgent(pr.taskId, pr.result);
        }

        // Emit halt events for external runner
        for (const id of result.haltedTaskIds) {
          eventBus.publish('agent:halt_requested', { taskId: id });
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              halted: result.halted,
              elapsedMs: result.elapsedMs,
              partialResults: result.partialResults.map((pr) => ({
                taskId: pr.taskId,
                agentType: pr.agentType,
                hadResult: pr.result !== null,
              })),
            }, null, 2)
          }]
        };
      }
    );

    // -- agent_status -------------------------------------------------------

    server.tool(
      'agent_status',
      'Get detailed status of an agent, its delegation tree, and awareness context.',
      {
        taskId: z.string().describe('Task ID of the agent to check'),
      },
      async ({ taskId }) => {
        const node = delegation.getNode(taskId);
        const meshAgent = mesh.getAgent(taskId);
        const awarenessContext = mesh.getAwarenessContext(taskId);
        const tree = delegation.getTree(taskId);
        const children = delegation.getChildren(taskId);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              delegation: node ? {
                taskId: node.taskId,
                agentType: node.agentType,
                description: node.description,
                state: node.state,
                depth: node.depth,
                trustTier: node.trustTier,
                childCount: node.children.length,
                result: node.result ? node.result.slice(0, 200) : null,
                error: node.error,
              } : null,
              mesh: meshAgent ? {
                phase: meshAgent.phase,
                progress: meshAgent.progress,
                role: meshAgent.role,
                teamId: meshAgent.teamId,
              } : null,
              tree: tree ? {
                rootId: tree.rootId,
                state: tree.state,
                depth: tree.depth,
                nodeCount: tree.nodes.length,
              } : null,
              children: children.map((c) => ({
                taskId: c.taskId,
                agentType: c.agentType,
                state: c.state,
                description: c.description.slice(0, 60),
              })),
              awarenessContext,
            }, null, 2)
          }]
        };
      }
    );

    // -- agent_list_capabilities --------------------------------------------

    server.tool(
      'agent_list_capabilities',
      'List available agent types, active agents, delegation stats, and mesh status.',
      {},
      async () => {
        const delegationStats = delegation.getStats();
        const meshStats = mesh.getStats();
        const activeTrees = delegation.getActiveTrees();
        const activeTeams = teams.listActive();

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              agentTypes: AGENT_TYPES,
              delegation: delegationStats,
              mesh: meshStats,
              activeTrees: activeTrees.map((t) => ({
                rootId: t.rootId,
                depth: t.depth,
                nodeCount: t.nodes.length,
                trustTier: t.trustTier,
              })),
              activeTeams: activeTeams.map((t) => ({
                id: t.id,
                name: t.name,
                goal: t.goal,
                members: t.members.length,
                tasks: t.taskList.length,
              })),
            }, null, 2)
          }]
        };
      }
    );

    // -- agent_team_create ---------------------------------------------------

    server.tool(
      'agent_team_create',
      'Create a new agent team with a shared goal, task list, and communication channel.',
      {
        name: z.string().describe('Team name'),
        goal: z.string().describe('Shared goal for the team'),
        tasks: z.array(z.object({
          description: z.string(),
          priority: z.enum(['high', 'medium', 'low']).default('medium'),
        })).default([]).describe('Initial tasks for the team'),
      },
      async ({ name, goal, tasks: initialTasks }) => {
        const team = teams.create(name, goal);

        for (const task of initialTasks) {
          teams.addTask(team.id, task.description, task.priority);
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              created: true,
              teamId: team.id,
              name: team.name,
              goal: team.goal,
              taskCount: team.taskList.length,
            }, null, 2)
          }]
        };
      }
    );

    // -- agent_team_status --------------------------------------------------

    server.tool(
      'agent_team_status',
      'Get status of a specific team or all teams. Shows members, tasks, and shared context.',
      {
        teamId: z.string().optional().describe('Team ID (omit for overview of all teams)'),
      },
      async ({ teamId }) => {
        if (teamId) {
          const team = teams.get(teamId);
          if (!team) {
            return { content: [{ type: 'text', text: JSON.stringify({ found: false, teamId }) }] };
          }

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                team: {
                  id: team.id,
                  name: team.name,
                  goal: team.goal,
                  status: team.status,
                  members: team.members,
                  tasks: team.taskList.map((t) => ({
                    id: t.id,
                    description: t.description,
                    status: t.status,
                    priority: t.priority,
                    assignedTo: t.assignedTo,
                    result: t.result ? t.result.slice(0, 100) : undefined,
                  })),
                  recentMessages: team.sharedContext.slice(-10),
                },
                context: teams.getContext(teamId),
              }, null, 2)
            }]
          };
        }

        // Overview of all teams
        const allTeams = teams.listAll();
        const status = teams.getStatus();

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ...status,
              teams: allTeams.slice(0, 10).map((t) => ({
                id: t.id,
                name: t.name,
                goal: t.goal.slice(0, 80),
                status: t.status,
                members: t.members.length,
                tasks: t.taskList.length,
                completedTasks: t.taskList.filter((tk) => tk.status === 'done').length,
              })),
            }, null, 2)
          }]
        };
      }
    );
  }
}
