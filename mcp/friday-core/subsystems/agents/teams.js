/**
 * Agent Teams — Collaborative multi-agent team coordination
 *
 * Teams are groups of agents that share:
 *   - A common goal
 *   - A shared task list (visible to all members)
 *   - A shared context channel (members can post messages)
 *   - Awareness of what each member is doing
 *
 * Teams can be created by the orchestrator, by delegation, or manually.
 *
 * Ported from nexus-os: agent-teams.ts. Stripped Electron, crypto.randomUUID.
 * Pure in-memory team management.
 */

import { randomUUID } from 'node:crypto';

function generateId() {
  return randomUUID();
}

export class AgentTeamManager {
  #teams = new Map();

  /** Create a new agent team */
  create(name, goal) {
    const team = {
      id: generateId(),
      name,
      goal,
      members: [],
      taskList: [],
      sharedContext: [],
      createdAt: Date.now(),
      status: 'active',
    };
    this.#teams.set(team.id, team);
    return team;
  }

  /** Add an agent to a team */
  addMember(teamId, agentTaskId) {
    const team = this.#teams.get(teamId);
    if (!team || team.status !== 'active') return false;
    if (!team.members.includes(agentTaskId)) {
      team.members.push(agentTaskId);
    }
    return true;
  }

  /** Remove an agent from a team */
  removeMember(teamId, agentTaskId) {
    const team = this.#teams.get(teamId);
    if (!team) return false;
    team.members = team.members.filter((m) => m !== agentTaskId);
    return true;
  }

  /** Add a task to the team's shared task list */
  addTask(teamId, description, priority = 'medium') {
    const team = this.#teams.get(teamId);
    if (!team || team.status !== 'active') return null;

    const task = {
      id: generateId(),
      description,
      status: 'pending',
      priority,
      assignedTo: undefined,
      result: undefined,
      createdAt: Date.now(),
      completedAt: undefined,
    };

    team.taskList.push(task);
    return task;
  }

  /** Claim a task from the team list */
  claimTask(teamId, taskId, agentTaskId) {
    const team = this.#teams.get(teamId);
    if (!team) return false;

    const task = team.taskList.find((t) => t.id === taskId);
    if (!task || task.status !== 'pending') return false;

    task.assignedTo = agentTaskId;
    task.status = 'in-progress';
    return true;
  }

  /** Complete a team task */
  completeTask(teamId, taskId, result) {
    const team = this.#teams.get(teamId);
    if (!team) return false;

    const task = team.taskList.find((t) => t.id === taskId);
    if (!task) return false;

    task.status = 'done';
    task.result = result;
    task.completedAt = Date.now();

    // Check if all tasks are done
    const allDone = team.taskList.every((t) => t.status === 'done');
    if (allDone && team.taskList.length > 0) {
      team.status = 'completed';
    }

    return true;
  }

  /** Post a message to the team's shared context */
  postMessage(teamId, agentName, message) {
    const team = this.#teams.get(teamId);
    if (!team) return;

    const entry = `[${new Date().toLocaleTimeString('en-GB')}] ${agentName}: ${message}`;
    team.sharedContext.push(entry);

    if (team.sharedContext.length > 100) {
      team.sharedContext = team.sharedContext.slice(-100);
    }
  }

  /** Get the team's shared context as a formatted string */
  getContext(teamId) {
    const team = this.#teams.get(teamId);
    if (!team) return '';

    const taskSummary = team.taskList
      .map((t) => `  [${t.status.toUpperCase()}] ${t.description}${t.assignedTo ? ' (assigned)' : ''}`)
      .join('\n');

    const recentMessages = team.sharedContext.slice(-20).join('\n');

    return `TEAM: ${team.name}\nGOAL: ${team.goal}\n\nTASK LIST:\n${taskSummary || '  (empty)'}\n\nRECENT MESSAGES:\n${recentMessages || '  (none)'}`;
  }

  /** Get a team by ID */
  get(teamId) {
    return this.#teams.get(teamId);
  }

  /** List all active teams */
  listActive() {
    return [...this.#teams.values()].filter((t) => t.status === 'active');
  }

  /** List all teams */
  listAll() {
    return [...this.#teams.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Disband a team */
  disband(teamId) {
    const team = this.#teams.get(teamId);
    if (team) {
      team.status = 'disbanded';
    }
  }

  /** Clean up old completed/disbanded teams (keep last 20) */
  cleanup() {
    const inactive = [...this.#teams.values()]
      .filter((t) => t.status !== 'active')
      .sort((a, b) => b.createdAt - a.createdAt);

    for (const team of inactive.slice(20)) {
      this.#teams.delete(team.id);
    }
  }

  /** Get team status summary */
  getStatus() {
    const all = this.listAll();
    return {
      total: all.length,
      active: all.filter((t) => t.status === 'active').length,
      completed: all.filter((t) => t.status === 'completed').length,
      disbanded: all.filter((t) => t.status === 'disbanded').length,
    };
  }
}
