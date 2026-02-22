export interface Project {
  id: string;
  name: string;
  apiKeyId: string;
  keyPrefix: string;
  description?: string;
  character: string; // The markdown content
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  character?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  character?: string;
  isActive?: boolean;
}

export interface ProjectWithApiKey extends Project {
  apiKey?: string; // Only returned on creation
}
