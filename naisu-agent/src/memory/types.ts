export type MemoryItem = {
  id: string;
  projectId: string;
  userId: string;
  text: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  embedding: number[] | undefined;
};

export type MemorySearchResult = MemoryItem & { score: number };
