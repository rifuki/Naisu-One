import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { createLogger } from "../utils/logger.js";
import type { Agent, CreateAgentInput, UpdateAgentInput, AgentRole, getRoleTemplate } from "./types.js";
import { ROLE_TEMPLATES } from "./types.js";

const log = createLogger("Agents");

const AGENTS_DIR = resolve(process.cwd(), "agents");
const AGENTS_JSON_PATH = resolve(process.cwd(), "src/data/agents.json");

export class AgentService {
  private agents: Map<string, Agent> = new Map();

  async init(): Promise<void> {
    // Ensure agents directory exists
    if (!existsSync(AGENTS_DIR)) {
      mkdirSync(AGENTS_DIR, { recursive: true });
      log.info("Created agents directory", { path: AGENTS_DIR });
    }

    // Load existing agents
    await this.loadAgents();

    log.info("Agent service initialized", { agentCount: this.agents.size });
  }

  private async loadAgents(): Promise<void> {
    try {
      if (existsSync(AGENTS_JSON_PATH)) {
        const data = readFileSync(AGENTS_JSON_PATH, "utf8");
        const agents: Agent[] = JSON.parse(data);
        for (const agent of agents) {
          // Load character from file if exists
          const characterFromFile = this.readCharacterFile(agent.id);
          if (characterFromFile) {
            agent.character = characterFromFile;
          }
          this.agents.set(agent.id, agent);
        }
        log.info("Loaded agents from registry", { count: agents.length });
      }
    } catch (error) {
      log.error("Failed to load agents registry", error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async saveAgents(): Promise<void> {
    try {
      const agents = Array.from(this.agents.values()).map(a => ({
        ...a,
        character: undefined // Don't store character in JSON, keep in file
      }));
      writeFileSync(AGENTS_JSON_PATH, JSON.stringify(agents, null, 2));
    } catch (error) {
      log.error("Failed to save agents registry", error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  private getCharacterPath(agentId: string): string {
    return join(AGENTS_DIR, `${agentId}.md`);
  }

  private saveCharacterFile(agentId: string, content: string): void {
    const characterPath = this.getCharacterPath(agentId);
    writeFileSync(characterPath, content, "utf8");
  }

  private readCharacterFile(agentId: string): string | null {
    try {
      const characterPath = this.getCharacterPath(agentId);
      return readFileSync(characterPath, "utf8");
    } catch {
      return null;
    }
  }

  private deleteCharacterFile(agentId: string): void {
    try {
      const characterPath = this.getCharacterPath(agentId);
      if (existsSync(characterPath)) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("fs").unlinkSync(characterPath);
      }
    } catch (error) {
      log.error("Failed to delete character file", error instanceof Error ? error : new Error(String(error)));
    }
  }

  // Create a new agent
  async createAgent(input: CreateAgentInput): Promise<Agent> {
    const agentId = randomUUID();
    const now = new Date().toISOString();
    
    const role = input.role || "custom";
    const character = input.character || ROLE_TEMPLATES[role].character.replace(/{name}/g, input.name);

    const agent: Agent = {
      id: agentId,
      name: input.name,
      description: input.description || ROLE_TEMPLATES[role].description,
      projectId: input.projectId,
      role,
      character,
      model: input.model,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    // Save character file
    this.saveCharacterFile(agentId, character);

    // Save to registry
    this.agents.set(agentId, agent);
    await this.saveAgents();

    log.info("Agent created", { agentId, name: input.name, projectId: input.projectId, role });
    return agent;
  }

  // Get agent by ID
  getAgent(agentId: string): Agent | null {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    
    // Always read latest character from file
    const characterFromFile = this.readCharacterFile(agentId);
    if (characterFromFile) {
      agent.character = characterFromFile;
    }
    
    return agent;
  }

  // Get agent character
  getAgentCharacter(agentId: string): string | null {
    const agent = this.getAgent(agentId);
    if (!agent) return null;
    return agent.character;
  }

  // List all agents (optionally filtered by project)
  listAgents(projectId?: string): Agent[] {
    let agents = Array.from(this.agents.values());
    
    if (projectId) {
      agents = agents.filter(a => a.projectId === projectId);
    }
    
    return agents.map(a => {
      const characterFromFile = this.readCharacterFile(a.id);
      return {
        ...a,
        character: characterFromFile || a.character
      };
    });
  }

  // Get agents for a project
  getAgentsByProject(projectId: string): Agent[] {
    return this.listAgents(projectId);
  }

  // Update agent
  async updateAgent(agentId: string, input: UpdateAgentInput): Promise<Agent | null> {
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    // Update character file if provided
    if (input.character !== undefined) {
      this.saveCharacterFile(agentId, input.character);
    }

    // Update agent data
    const updated: Agent = {
      ...agent,
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.role !== undefined && { role: input.role }),
      ...(input.model !== undefined && { model: input.model }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
      updatedAt: new Date().toISOString(),
    };

    this.agents.set(agentId, updated);
    await this.saveAgents();

    // Return with character
    const characterFromFile = this.readCharacterFile(agentId);
    if (characterFromFile) {
      updated.character = characterFromFile;
    }

    log.info("Agent updated", { agentId, name: updated.name });
    return updated;
  }

  // Delete agent
  async deleteAgent(agentId: string): Promise<boolean> {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    // Delete character file
    this.deleteCharacterFile(agentId);

    // Remove from registry
    this.agents.delete(agentId);
    await this.saveAgents();

    log.info("Agent deleted", { agentId, name: agent.name });
    return true;
  }

  // Delete all agents for a project (when project is deleted)
  async deleteAgentsByProject(projectId: string): Promise<number> {
    const agentsToDelete = this.listAgents(projectId);
    let count = 0;
    
    for (const agent of agentsToDelete) {
      await this.deleteAgent(agent.id);
      count++;
    }
    
    log.info("Deleted agents for project", { projectId, count });
    return count;
  }

  // Check if agent exists
  hasAgent(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  // Get agent count (optionally by project)
  getAgentCount(projectId?: string): number {
    if (projectId) {
      return this.listAgents(projectId).length;
    }
    return this.agents.size;
  }

  // Get available roles
  getAvailableRoles(): { id: string; name: string; description: string }[] {
    return Object.entries(ROLE_TEMPLATES).map(([id, template]) => ({
      id,
      name: template.name,
      description: template.description
    }));
  }
}
