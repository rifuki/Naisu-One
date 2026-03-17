export interface Project {
  id: string;
  name: string;
  apiKeyId: string;
  keyPrefix: string;
  description?: string | undefined;
  character: string; // The markdown content
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
}

export interface CreateProjectInput {
  name: string;
  description?: string | undefined;
  character?: string | undefined;
}

export interface UpdateProjectInput {
  name?: string | undefined;
  description?: string | undefined;
  character?: string | undefined;
  isActive?: boolean | undefined;
}

export interface ProjectWithApiKey extends Project {
  apiKey?: string | undefined; // Only returned on creation
}
