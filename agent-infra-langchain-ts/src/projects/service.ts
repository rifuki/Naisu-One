import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import { createLogger } from "../utils/logger.js";
import type { Project, CreateProjectInput, UpdateProjectInput } from "./types.js";

const log = createLogger("Projects");

const PROJECTS_DIR = resolve(process.cwd(), "projects");
const PROJECTS_JSON_PATH = resolve(process.cwd(), "src/data/projects.json");

// Default character template
const DEFAULT_CHARACTER = `# {name}

You are a helpful AI assistant for {name}.

## Personality

- Professional and friendly
- Clear and concise in responses
- Helpful and informative

## Capabilities

- Answer questions
- Assist with tasks
- Provide information

## Guidelines

- Be helpful and accurate
- Admit when you don't know something
- Keep responses concise unless asked for detail
`;

export class ProjectService {
  private projects: Map<string, Project> = new Map();

  async init(): Promise<void> {
    // Ensure projects directory exists
    if (!existsSync(PROJECTS_DIR)) {
      mkdirSync(PROJECTS_DIR, { recursive: true });
      log.info("Created projects directory", { path: PROJECTS_DIR });
    }

    // Load existing projects from JSON
    await this.loadProjects();

    // Scan projects directory for any markdown files not in registry
    await this.scanProjectsDirectory();

    log.info("Project service initialized", { projectCount: this.projects.size });
  }

  private async loadProjects(): Promise<void> {
    try {
      if (existsSync(PROJECTS_JSON_PATH)) {
        const data = readFileSync(PROJECTS_JSON_PATH, "utf8");
        const projects: Project[] = JSON.parse(data);
        for (const project of projects) {
          this.projects.set(project.id, project);
        }
        log.info("Loaded projects from registry", { count: projects.length });
      }
    } catch (error) {
      log.error("Failed to load projects registry", error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async saveProjects(): Promise<void> {
    try {
      const projects = Array.from(this.projects.values());
      writeFileSync(PROJECTS_JSON_PATH, JSON.stringify(projects, null, 2));
    } catch (error) {
      log.error("Failed to save projects registry", error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  private async scanProjectsDirectory(): Promise<void> {
    try {
      const files = readdirSync(PROJECTS_DIR);
      const mdFiles = files.filter((f) => f.endsWith(".md"));

      for (const file of mdFiles) {
        const projectId = file.replace(".md", "");
        
        // Skip if already in registry
        if (Array.from(this.projects.values()).some((p) => p.id === projectId)) {
          continue;
        }

        // Read character file
        const characterPath = join(PROJECTS_DIR, file);
        const character = readFileSync(characterPath, "utf8");

        // Create project entry
        const project: Project = {
          id: projectId,
          name: this.formatProjectName(projectId),
          apiKeyId: "", // Will be linked later
          keyPrefix: "",
          character,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          isActive: true,
        };

        this.projects.set(projectId, project);
        log.info("Discovered project from file", { projectId });
      }

      // Save updated registry
      await this.saveProjects();
    } catch (error) {
      log.error("Failed to scan projects directory", error instanceof Error ? error : new Error(String(error)));
    }
  }

  private formatProjectName(id: string): string {
    // Convert kebab-case or snake_case to Title Case
    return id
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  private getCharacterPath(projectId: string): string {
    return join(PROJECTS_DIR, `${projectId}.md`);
  }

  private saveCharacterFile(projectId: string, content: string): void {
    const characterPath = this.getCharacterPath(projectId);
    writeFileSync(characterPath, content, "utf8");
  }

  private readCharacterFile(projectId: string): string {
    try {
      const characterPath = this.getCharacterPath(projectId);
      return readFileSync(characterPath, "utf8");
    } catch {
      return "";
    }
  }

  private deleteCharacterFile(projectId: string): void {
    try {
      const characterPath = this.getCharacterPath(projectId);
      if (existsSync(characterPath)) {
        unlinkSync(characterPath);
      }
    } catch (error) {
      log.error("Failed to delete character file", error instanceof Error ? error : new Error(String(error)));
    }
  }

  // Create a new project
  async createProject(
    input: CreateProjectInput,
    apiKeyId: string,
    keyPrefix: string
  ): Promise<{ project: Project; apiKey: string }> {
    const projectId = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    
    if (this.projects.has(projectId)) {
      throw new Error(`Project with name "${input.name}" already exists`);
    }

    const now = new Date().toISOString();
    const character = input.character || DEFAULT_CHARACTER.replace(/{name}/g, input.name);

    const project: Project = {
      id: projectId,
      name: input.name,
      apiKeyId,
      keyPrefix,
      description: input.description,
      character,
      createdAt: now,
      updatedAt: now,
      isActive: true,
    };

    // Save character file
    this.saveCharacterFile(projectId, character);

    // Save to registry
    this.projects.set(projectId, project);
    await this.saveProjects();

    log.info("Project created", { projectId, name: input.name });
    return { project, apiKey: keyPrefix }; // Note: apiKey should be the full key from apiKeyService
  }

  // Get project by ID
  getProject(projectId: string): Project | null {
    const project = this.projects.get(projectId);
    if (!project) return null;
    
    // Always read latest character from file
    const character = this.readCharacterFile(projectId);
    if (character) {
      project.character = character;
    }
    
    return project;
  }

  // Get project character (for agent runtime)
  getProjectCharacter(projectId: string): string | null {
    const character = this.readCharacterFile(projectId);
    if (character) return character;
    
    // Fallback to default character
    const project = this.projects.get(projectId);
    if (project) {
      return project.character;
    }
    
    return null;
  }

  // List all projects
  listProjects(): Project[] {
    return Array.from(this.projects.values()).map((p) => ({
      ...p,
      character: this.readCharacterFile(p.id) || p.character,
    }));
  }

  // Update project
  async updateProject(projectId: string, input: UpdateProjectInput): Promise<Project | null> {
    const project = this.projects.get(projectId);
    if (!project) return null;

    // Update character file if provided
    if (input.character !== undefined) {
      this.saveCharacterFile(projectId, input.character);
    }

    // Update project data
    const updated: Project = {
      ...project,
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
      updatedAt: new Date().toISOString(),
    };

    this.projects.set(projectId, updated);
    await this.saveProjects();

    log.info("Project updated", { projectId });
    return updated;
  }

  // Delete project
  async deleteProject(projectId: string): Promise<boolean> {
    const project = this.projects.get(projectId);
    if (!project) return false;

    // Delete character file
    this.deleteCharacterFile(projectId);

    // Remove from registry
    this.projects.delete(projectId);
    await this.saveProjects();

    log.info("Project deleted", { projectId });
    return true;
  }

  // Check if project exists
  hasProject(projectId: string): boolean {
    return this.projects.has(projectId);
  }

  // Get project count
  getProjectCount(): number {
    return this.projects.size;
  }
}
