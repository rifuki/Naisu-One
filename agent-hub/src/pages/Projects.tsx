import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FolderOpen, Plus, Trash2, MoreHorizontal, Copy, Check, FileText, Key, AlertCircle, RefreshCw, X, Edit2, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  useProjects,
  useCreateProject,
  useUpdateProject,
  useDeleteProject,
  useToggleProjectStatus,
} from "@/hooks/api";
import { AdminAPI, Project } from "@/services/adminApi";

// Default character template
const DEFAULT_CHARACTER_TEMPLATE = (name: string) => `# ${name}

You are ${name}, an AI assistant.

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

export default function Projects() {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [showEditCharacter, setShowEditCharacter] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Form state
  const [newProject, setNewProject] = useState({
    name: "",
    description: "",
    character: "",
  });

  const [editCharacter, setEditCharacter] = useState("");

  const isConfigured = AdminAPI.isConfigured();

  // Fetch projects
  const { data: projects = [], isLoading, error, refetch } = useProjects({
    enabled: isConfigured,
  });

  // Mutations
  const createProject = useCreateProject({
    onSuccess: (data) => {
      setNewlyCreatedKey(data.apiKey);
      toast({
        title: "Project Created",
        description: `${data.project.name} has been created successfully. Copy the API key now!`,
      });
      resetForm();
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to create project",
      });
    },
  });

  const updateProject = useUpdateProject({
    onSuccess: (data) => {
      toast({
        title: "Project Updated",
        description: `${data.project.name} has been updated successfully.`,
      });
      setShowEditCharacter(false);
      setSelectedProject(null);
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to update project",
      });
    },
  });

  const deleteProject = useDeleteProject({
    onSuccess: () => {
      toast({
        title: "Project Deleted",
        description: "The project has been permanently deleted.",
      });
      setSelectedProject(null);
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to delete project",
      });
    },
  });

  const toggleStatus = useToggleProjectStatus({
    onSuccess: (_, variables) => {
      toast({
        title: variables.isActive ? "Project Enabled" : "Project Disabled",
        description: `The project has been ${variables.isActive ? "enabled" : "disabled"}.`,
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to update project status",
      });
    },
  });

  const resetForm = () => {
    setNewProject({
      name: "",
      description: "",
      character: "",
    });
    setShowCreate(false);
  };

  const handleCreateProject = () => {
    if (!newProject.name) {
      toast({
        variant: "destructive",
        title: "Validation Error",
        description: "Project name is required.",
      });
      return;
    }

    const character = newProject.character || DEFAULT_CHARACTER_TEMPLATE(newProject.name);

    createProject.mutate({
      name: newProject.name,
      description: newProject.description,
      character,
    });
  };

  const handleUpdateCharacter = () => {
    if (!selectedProject) return;

    updateProject.mutate({
      projectId: selectedProject.id,
      request: {
        character: editCharacter,
      },
    });
  };

  const handleDeleteProject = (project: Project) => {
    if (confirm(`Are you sure you want to permanently delete "${project.name}"? This will also delete its API key.`)) {
      deleteProject.mutate(project.id);
    }
  };

  const copyKey = (key: string, id: string) => {
    navigator.clipboard.writeText(key);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
    toast({
      title: "Copied",
      description: "API key copied to clipboard",
    });
  };

  const openEditCharacter = (project: Project) => {
    setSelectedProject(project);
    setEditCharacter(project.character || DEFAULT_CHARACTER_TEMPLATE(project.name));
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Projects</h1>
          <p className="text-muted-foreground mt-1">
            Manage AI agent projects and their characters
            {!isConfigured && <span className="text-destructive ml-2">(API key not configured)</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => refetch()} disabled={!isConfigured || isLoading}>
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
          <Button onClick={() => setShowCreate(true)} className="gap-2" disabled={!isConfigured}>
            <Plus className="w-4 h-4" /> New Project
          </Button>
        </div>
      </div>

      {!isConfigured && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Please configure <code className="font-mono text-xs">VITE_MASTER_API_KEY</code> in your .env file to manage projects.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error.message || "Failed to load projects"}</AlertDescription>
        </Alert>
      )}

      {/* New Key Warning */}
      {newlyCreatedKey && (
        <Alert className="bg-warning/10 border-warning/20">
          <AlertCircle className="h-4 w-4 text-warning" />
          <AlertDescription className="space-y-2">
            <p className="font-medium">New Project API Key Created!</p>
            <p className="text-sm">Copy this key now. You won&apos;t be able to see it again!</p>
            <code className="block bg-background p-2 rounded text-xs font-mono break-all">{newlyCreatedKey}</code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(newlyCreatedKey);
                toast({ title: "Copied", description: "API key copied to clipboard" });
              }}
            >
              <Copy className="w-3 h-3 mr-1" /> Copy
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setNewlyCreatedKey(null)}>
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Projects list */}
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
            projects.map((project, i) => (
              <motion.div
                key={project.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ delay: i * 0.03 }}
                className={`bg-card border rounded-xl p-5 transition-colors ${
                  project.isActive ? "border-border hover:border-primary/20" : "border-border opacity-60"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4 flex-1 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
                      <FolderOpen className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="font-semibold text-card-foreground">{project.name}</h3>
                        <Badge variant="outline" className="text-[10px] font-mono">
                          {project.id}
                        </Badge>
                        {project.isActive ? (
                          <Badge variant="outline" className="text-[10px] bg-success/10 text-success border-success/20">
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-destructive/20">
                            Disabled
                          </Badge>
                        )}
                      </div>
                      {project.description && (
                        <p className="text-sm text-muted-foreground mt-1">{project.description}</p>
                      )}
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Key className="w-3 h-3" />
                          {project.keyPrefix}
                        </span>
                        <span>Created: {formatDate(project.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <Switch
                      checked={project.isActive}
                      onCheckedChange={() => toggleStatus.mutate({ projectId: project.id, isActive: !project.isActive })}
                      disabled={toggleStatus.isPending}
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="text-muted-foreground">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEditCharacter(project)}>
                          <FileText className="w-4 h-4 mr-2" /> Edit Character
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleDeleteProject(project)}
                          className="text-destructive"
                          disabled={deleteProject.isPending}
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

        {!isLoading && projects.length === 0 && !error && (
          <div className="text-center p-8">
            <FolderOpen className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-card-foreground">No Projects Yet</h3>
            <p className="text-sm text-muted-foreground mt-1">Create your first project to get started.</p>
          </div>
        )}
      </div>

      {/* Create Project Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Project</DialogTitle>
          </DialogHeader>
          <Tabs defaultValue="basic" className="mt-2">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="basic">Basic Info</TabsTrigger>
              <TabsTrigger value="character">Character (Optional)</TabsTrigger>
            </TabsList>

            <TabsContent value="basic" className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">Project Name</label>
                <Input
                  placeholder="e.g. Naisu1"
                  value={newProject.name}
                  onChange={(e) => setNewProject((p) => ({ ...p, name: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  This will be used as the project ID (e.g., &quot;Naisu1&quot; → &quot;naisu1&quot;)
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">Description</label>
                <Input
                  placeholder="What is this project for?"
                  value={newProject.description}
                  onChange={(e) => setNewProject((p) => ({ ...p, description: e.target.value }))}
                />
              </div>
            </TabsContent>

            <TabsContent value="character" className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">
                  Character Markdown (Optional)
                </label>
                <Textarea
                  placeholder={`# My Project

You are an AI assistant for My Project.

## Personality
- Professional and friendly
- Clear and concise

## Capabilities
- Answer questions
- Assist with tasks`}
                  className="font-mono text-xs"
                  value={newProject.character}
                  onChange={(e) => setNewProject((p) => ({ ...p, character: e.target.value }))}
                  rows={12}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Define the AI&apos;s personality and behavior. If left empty, a default template will be used.
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
            <Button onClick={handleCreateProject} disabled={createProject.isPending || !newProject.name}>
              {createProject.isPending ? "Creating..." : "Create Project"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Character Dialog */}
      <Dialog open={showEditCharacter} onOpenChange={setShowEditCharacter}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Character: {selectedProject?.name}</DialogTitle>
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
                This defines how the AI agent behaves for this project. Changes take effect immediately for new chats.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowEditCharacter(false)}>
                Cancel
              </Button>
              <Button onClick={handleUpdateCharacter} disabled={updateProject.isPending}>
                {updateProject.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
