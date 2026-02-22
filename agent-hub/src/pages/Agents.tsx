import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, Plus, Trash2, MoreHorizontal, Settings, AlertCircle, RefreshCw, X, Edit2, Sparkles, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  useAgents,
  useProjects,
  useAgentRoles,
  useCreateAgent,
  useUpdateAgent,
  useDeleteAgent,
  useToggleAgentStatus,
} from "@/hooks/api";
import { AdminAPI, Agent, AgentRole } from "@/services/adminApi";

// Role badge colors
const roleColors: Record<AgentRole, string> = {
  custom: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  defi_expert: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  support: "bg-green-500/10 text-green-500 border-green-500/20",
  teacher: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
  analyst: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  creative: "bg-pink-500/10 text-pink-500 border-pink-500/20",
  coder: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
  sales: "bg-orange-500/10 text-orange-500 border-orange-500/20",
};

// Role display names
const roleNames: Record<AgentRole, string> = {
  custom: "Custom",
  defi_expert: "DeFi Expert",
  support: "Support",
  teacher: "Teacher",
  analyst: "Analyst",
  creative: "Creative",
  coder: "Coder",
  sales: "Sales",
};

export default function Agents() {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [showEditCharacter, setShowEditCharacter] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string>("all");

  // Form state
  const [newAgent, setNewAgent] = useState({
    name: "",
    description: "",
    projectId: "",
    role: "custom" as AgentRole,
    character: "",
    model: "",
  });

  const [editCharacter, setEditCharacter] = useState("");

  const isConfigured = AdminAPI.isConfigured();

  // Fetch data
  const { data: projects = [], isLoading: isLoadingProjects } = useProjects({
    enabled: isConfigured,
  });

  const { data: agents = [], isLoading, error, refetch } = useAgents({
    projectId: selectedProjectId === "all" ? undefined : selectedProjectId,
    enabled: isConfigured,
  });

  const { data: roles = [] } = useAgentRoles({
    enabled: isConfigured,
  });

  // Filter agents by search
  const filteredAgents = useMemo(() => {
    if (!searchQuery) return agents;
    const query = searchQuery.toLowerCase();
    return agents.filter(
      (a) =>
        a.name.toLowerCase().includes(query) ||
        a.description?.toLowerCase().includes(query) ||
        roleNames[a.role].toLowerCase().includes(query)
    );
  }, [agents, searchQuery]);

  // Get project name by ID
  const getProjectName = (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    return project?.name || projectId;
  };

  // Mutations
  const createAgent = useCreateAgent({
    onSuccess: (data) => {
      toast({
        title: "Agent Created",
        description: `${data.agent.name} has been created successfully.`,
      });
      resetForm();
      setShowCreate(false);
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to create agent",
      });
    },
  });

  const updateAgent = useUpdateAgent({
    onSuccess: (data) => {
      toast({
        title: "Agent Updated",
        description: `${data.agent.name} has been updated successfully.`,
      });
      setShowEditCharacter(false);
      setSelectedAgent(null);
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to update agent",
      });
    },
  });

  const deleteAgent = useDeleteAgent({
    onSuccess: () => {
      toast({
        title: "Agent Deleted",
        description: "The agent has been permanently deleted.",
      });
      setSelectedAgent(null);
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to delete agent",
      });
    },
  });

  const toggleStatus = useToggleAgentStatus({
    onSuccess: (_, variables) => {
      toast({
        title: variables.isActive ? "Agent Enabled" : "Agent Disabled",
        description: `The agent has been ${variables.isActive ? "enabled" : "disabled"}.`,
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to update agent status",
      });
    },
  });

  const resetForm = () => {
    setNewAgent({
      name: "",
      description: "",
      projectId: projects[0]?.id || "",
      role: "custom",
      character: "",
      model: "",
    });
  };

  const handleCreateAgent = () => {
    if (!newAgent.name) {
      toast({
        variant: "destructive",
        title: "Validation Error",
        description: "Agent name is required.",
      });
      return;
    }

    if (!newAgent.projectId) {
      toast({
        variant: "destructive",
        title: "Validation Error",
        description: "Please select a project.",
      });
      return;
    }

    createAgent.mutate({
      name: newAgent.name,
      description: newAgent.description,
      projectId: newAgent.projectId,
      role: newAgent.role,
      character: newAgent.character || undefined,
      model: newAgent.model || undefined,
    });
  };

  const handleUpdateCharacter = () => {
    if (!selectedAgent) return;

    updateAgent.mutate({
      agentId: selectedAgent.id,
      request: {
        character: editCharacter,
      },
    });
  };

  const handleDeleteAgent = (agent: Agent) => {
    if (confirm(`Are you sure you want to permanently delete "${agent.name}"?`)) {
      deleteAgent.mutate(agent.id);
    }
  };

  const openEditCharacter = (agent: Agent) => {
    setSelectedAgent(agent);
    setEditCharacter(agent.character || "");
    setShowEditCharacter(true);
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  // Set default project when projects load
  useMemo(() => {
    if (projects.length > 0 && !newAgent.projectId) {
      setNewAgent((prev) => ({ ...prev, projectId: projects[0].id }));
    }
  }, [projects, newAgent.projectId]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">AI Agents</h1>
          <p className="text-muted-foreground mt-1">
            Create and manage AI agents with different roles and characters
            {!isConfigured && <span className="text-destructive ml-2">(API key not configured)</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => refetch()} disabled={!isConfigured || isLoading}>
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
          <Button onClick={() => setShowCreate(true)} className="gap-2" disabled={!isConfigured || projects.length === 0}>
            <Plus className="w-4 h-4" /> New Agent
          </Button>
        </div>
      </div>

      {!isConfigured && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Please configure <code className="font-mono text-xs">VITE_MASTER_API_KEY</code> in your .env file to manage agents.
          </AlertDescription>
        </Alert>
      )}

      {projects.length === 0 && isConfigured && !isLoadingProjects && (
        <Alert className="bg-warning/10 border-warning/20">
          <AlertCircle className="h-4 w-4 text-warning" />
          <AlertDescription className="flex items-center justify-between">
            <span>You need to create a project first before creating agents.</span>
            <Button size="sm" variant="outline" onClick={() => window.location.href = "/projects"}>
              <FolderOpen className="w-4 h-4 mr-2" /> Go to Projects
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error.message || "Failed to load agents"}</AlertDescription>
        </Alert>
      )}

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="flex-1 relative">
          <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search agents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filter by project" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Projects</SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Agents list */}
      <div className="grid gap-4">
        {isLoading && (
          <>
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </>
        )}

        <AnimatePresence>
          {!isLoading &&
            filteredAgents.map((agent, i) => (
              <motion.div
                key={agent.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ delay: i * 0.03 }}
                className={`bg-card border rounded-xl p-5 transition-colors ${
                  agent.isActive ? "border-border hover:border-primary/20" : "border-border opacity-60"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4 flex-1 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
                      <Bot className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="font-semibold text-card-foreground">{agent.name}</h3>
                        <Badge variant="outline" className={`text-[10px] ${roleColors[agent.role]}`}>
                          {roleNames[agent.role]}
                        </Badge>
                        {agent.isActive ? (
                          <Badge variant="outline" className="text-[10px] bg-success/10 text-success border-success/20">
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-destructive/20">
                            Disabled
                          </Badge>
                        )}
                      </div>
                      {agent.description && (
                        <p className="text-sm text-muted-foreground mt-1">{agent.description}</p>
                      )}
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <FolderOpen className="w-3 h-3" />
                          {getProjectName(agent.projectId)}
                        </span>
                        {agent.model && (
                          <span className="font-mono bg-muted px-1.5 py-0.5 rounded">
                            {agent.model}
                          </span>
                        )}
                        <span>Created: {formatDate(agent.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <Switch
                      checked={agent.isActive}
                      onCheckedChange={() => toggleStatus.mutate({ agentId: agent.id, isActive: !agent.isActive })}
                      disabled={toggleStatus.isPending}
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="text-muted-foreground">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEditCharacter(agent)}>
                          <Edit2 className="w-4 h-4 mr-2" /> Edit Character
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleDeleteAgent(agent)}
                          className="text-destructive"
                          disabled={deleteAgent.isPending}
                        >
                          <Trash2 className="w-4 h-4 mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </motion.div>
            ))}
        </AnimatePresence>

        {!isLoading && filteredAgents.length === 0 && !error && (
          <div className="text-center p-8">
            <Bot className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-card-foreground">
              {searchQuery ? "No Agents Found" : "No Agents Yet"}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              {searchQuery
                ? "Try a different search query."
                : "Create your first AI agent to get started."}
            </p>
          </div>
        )}
      </div>

      {/* Create Agent Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New AI Agent</DialogTitle>
          </DialogHeader>
          <Tabs defaultValue="basic" className="mt-2">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="basic">Basic Info</TabsTrigger>
              <TabsTrigger value="character">Character (Optional)</TabsTrigger>
            </TabsList>

            <TabsContent value="basic" className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">Agent Name</label>
                <Input
                  placeholder="e.g. DeFi Expert Bot"
                  value={newAgent.name}
                  onChange={(e) => setNewAgent((p) => ({ ...p, name: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">Project</label>
                <Select
                  value={newAgent.projectId}
                  onValueChange={(v) => setNewAgent((p) => ({ ...p, projectId: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a project" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  The agent will be associated with this project
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">Role</label>
                <Select
                  value={newAgent.role}
                  onValueChange={(v) => setNewAgent((p) => ({ ...p, role: v as AgentRole }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((role) => (
                      <SelectItem key={role.id} value={role.id}>
                        {role.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  {roles.find((r) => r.id === newAgent.role)?.description}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">Description</label>
                <Input
                  placeholder="What does this agent do?"
                  value={newAgent.description}
                  onChange={(e) => setNewAgent((p) => ({ ...p, description: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">Model (Optional)</label>
                <Input
                  placeholder="e.g. gpt-4, kimi-k2-turbo-preview"
                  value={newAgent.model}
                  onChange={(e) => setNewAgent((p) => ({ ...p, model: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Leave empty to use the default model
                </p>
              </div>
            </TabsContent>

            <TabsContent value="character" className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">
                  Character Markdown (Optional)
                </label>
                <Textarea
                  placeholder={`# My Agent

You are an AI assistant.

## Personality
- Professional and friendly

## Capabilities
- Answer questions
- Assist with tasks`}
                  className="font-mono text-xs"
                  value={newAgent.character}
                  onChange={(e) => setNewAgent((p) => ({ ...p, character: e.target.value }))}
                  rows={12}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Define the AI&apos;s personality and behavior. If left empty, a role template will be used.
                </p>
              </div>
            </TabsContent>
          </Tabs>

          <div className="flex justify-end gap-2 pt-4 border-t mt-4">
            <Button
              variant="outline"
              onClick={() => {
                resetForm();
                setShowCreate(false);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateAgent}
              disabled={createAgent.isPending || !newAgent.name || !newAgent.projectId}
            >
              {createAgent.isPending ? "Creating..." : "Create Agent"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Character Dialog */}
      <Dialog open={showEditCharacter} onOpenChange={setShowEditCharacter}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Character: {selectedAgent?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Character Markdown</label>
              <Textarea
                className="font-mono text-xs"
                value={editCharacter}
                onChange={(e) => setEditCharacter(e.target.value)}
                rows={20}
              />
              <p className="text-xs text-muted-foreground mt-2">
                This defines how the AI agent behaves. Changes take effect immediately for new chats.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowEditCharacter(false)}>
                Cancel
              </Button>
              <Button onClick={handleUpdateCharacter} disabled={updateAgent.isPending}>
                {updateAgent.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
