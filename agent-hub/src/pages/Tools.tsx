import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Wrench, Plus, Trash2, MoreHorizontal, Code, Globe, Database, Mail, CreditCard, FileSearch, Webhook, Settings, X, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  useTools,
  useCreateTool,
  useToggleToolStatus,
  useDeleteTool,
} from "@/hooks/api";
import { AdminAPI, CustomTool, ToolParameter, BuiltinTool } from "@/services/adminApi";

// Category mapping for UI display
const categoryMeta: Record<string, { icon: typeof Code; label: string }> = {
  api: { icon: Code, label: "API" },
  database: { icon: Database, label: "Database" },
  email: { icon: Mail, label: "Email" },
  payment: { icon: CreditCard, label: "Payment" },
  search: { icon: FileSearch, label: "Search" },
  webhook: { icon: Webhook, label: "Webhook" },
  custom: { icon: Wrench, label: "Custom" },
  http: { icon: Globe, label: "HTTP" },
  code: { icon: Code, label: "Code" },
};

// Extended tool type for UI
interface UITool extends CustomTool {
  isBuiltin?: boolean;
}

// Map execution type to category for display
function getCategoryFromTool(tool: UITool): string {
  if (tool.execution.type === "http") return "api";
  if (tool.execution.type === "code") return "custom";
  return "custom";
}

// Format date for display
function formatDate(dateString: string): string {
  if (!dateString) return "";
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Get HTTP method from tool
function getMethodFromTool(tool: UITool): string {
  if (tool.execution.type === "http") {
    return tool.execution.method || "GET";
  }
  return "";
}

// Get endpoint from tool
function getEndpointFromTool(tool: UITool): string {
  if (tool.execution.type === "http") {
    return tool.execution.url;
  }
  return "";
}

// Convert BuiltinTool to UITool
function convertBuiltinTool(builtin: BuiltinTool): UITool {
  const properties = builtin.schema.properties || {};
  const required = builtin.schema.required || [];
  
  return {
    id: builtin.name,
    name: builtin.name,
    description: builtin.description,
    parameters: Object.entries(properties).map(([name, prop]) => {
      const propObj = prop as Record<string, unknown>;
      return {
        name,
        type: (propObj.type as ToolParameter["type"]) || "string",
        description: (propObj.description as string) || "",
        required: required.includes(name),
      };
    }),
    execution: { type: "code", code: "" },
    isActive: true,
    createdAt: "",
    updatedAt: "",
    isBuiltin: true,
  };
}

export default function Tools() {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedTool, setSelectedTool] = useState<UITool | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showBuiltin, setShowBuiltin] = useState(false);

  // New tool form state
  const [newTool, setNewTool] = useState({
    name: "",
    description: "",
    category: "custom" as string,
    endpoint: "",
    method: "GET" as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    executionType: "http" as "http" | "code",
    code: "",
    parameters: [{ name: "", type: "string" as const, description: "", required: true }] as ToolParameter[],
  });

  const isConfigured = AdminAPI.isConfigured();

  // Fetch tools
  const { data: toolsData, isLoading, error, refetch } = useTools({
    enabled: isConfigured,
  });

  // Convert tools to UI format
  const builtinTools: UITool[] = (toolsData?.builtin || []).map(convertBuiltinTool);
  const customTools: UITool[] = (toolsData?.custom || []).map((t) => ({ ...t, isBuiltin: false }));
  const allTools: UITool[] = [...builtinTools, ...customTools];

  // Filter tools
  const filtered = allTools.filter(
    (t) =>
      (showBuiltin || !t.isBuiltin) &&
      (t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  // Mutations
  const createToolMutation = useCreateTool({
    onSuccess: () => {
      toast({ title: "Tool Created", description: "Your custom tool has been created successfully." });
      resetForm();
      setShowCreate(false);
    },
    onError: (error) => {
      toast({ variant: "destructive", title: "Error", description: error.message || "Failed to create tool" });
    },
  });

  const toggleStatusMutation = useToggleToolStatus({
    onSuccess: (_, variables) => {
      toast({
        title: variables.isActive ? "Tool Enabled" : "Tool Disabled",
        description: `The tool has been ${variables.isActive ? "enabled" : "disabled"}.`,
      });
    },
    onError: (error) => {
      toast({ variant: "destructive", title: "Error", description: error.message || "Failed to update tool" });
    },
  });

  const deleteToolMutation = useDeleteTool({
    onSuccess: () => {
      toast({ title: "Tool Deleted", description: "The tool has been permanently deleted." });
      if (selectedTool) setSelectedTool(null);
    },
    onError: (error) => {
      toast({ variant: "destructive", title: "Error", description: error.message || "Failed to delete tool" });
    },
  });

  const handleToggleEnabled = (tool: UITool) => {
    if (tool.id && !tool.isBuiltin) {
      toggleStatusMutation.mutate({ toolId: tool.id, isActive: !tool.isActive });
    }
  };

  const handleDeleteTool = (tool: UITool) => {
    if (tool.id && !tool.isBuiltin && confirm("Are you sure you want to permanently delete this tool?")) {
      deleteToolMutation.mutate(tool.id);
    }
  };

  const resetForm = () => {
    setNewTool({
      name: "",
      description: "",
      category: "custom",
      endpoint: "",
      method: "GET",
      executionType: "http",
      code: "",
      parameters: [{ name: "", type: "string", description: "", required: true }],
    });
  };

  const addParam = () => {
    setNewTool((prev) => ({
      ...prev,
      parameters: [...prev.parameters, { name: "", type: "string", description: "", required: false }],
    }));
  };

  const updateParam = (index: number, field: keyof ToolParameter, value: string | boolean) => {
    setNewTool((prev) => ({
      ...prev,
      parameters: prev.parameters.map((p, i) => (i === index ? { ...p, [field]: value } : p)),
    }));
  };

  const removeParam = (index: number) => {
    setNewTool((prev) => ({
      ...prev,
      parameters: prev.parameters.filter((_, i) => i !== index),
    }));
  };

  const handleCreateTool = () => {
    if (!newTool.name || !newTool.description) {
      toast({ variant: "destructive", title: "Validation Error", description: "Name and description are required." });
      return;
    }

    const execution =
      newTool.executionType === "http"
        ? {
            type: "http" as const,
            url: newTool.endpoint,
            method: newTool.method,
            timeoutMs: 30000,
          }
        : {
            type: "code" as const,
            code: newTool.code,
          };

    createToolMutation.mutate({
      name: newTool.name.toLowerCase().replace(/\s+/g, "_"),
      description: newTool.description,
      parameters: newTool.parameters.filter((p) => p.name),
      execution,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Tools</h1>
          <p className="text-muted-foreground mt-1">
            Define callable tools for your AI agents
            {!isConfigured && <span className="text-destructive ml-2">(API key not configured)</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => refetch()} disabled={!isConfigured || isLoading}>
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
          <Button onClick={() => setShowCreate(true)} className="gap-2" disabled={!isConfigured}>
            <Plus className="w-4 h-4" /> New Tool
          </Button>
        </div>
      </div>

      {!isConfigured && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Please configure <code className="font-mono text-xs">VITE_MASTER_API_KEY</code> in your .env file to manage tools.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error.message || "Failed to load tools"}</AlertDescription>
        </Alert>
      )}

      {/* Filter tabs */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 bg-muted rounded-lg p-1">
          <button
            onClick={() => setShowBuiltin(false)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              !showBuiltin ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Custom Tools
          </button>
          <button
            onClick={() => setShowBuiltin(true)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              showBuiltin ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Built-in Tools
          </button>
        </div>
        <div className="flex-1 relative">
          <FileSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search tools..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Tools grid */}
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
            filtered.map((tool, i) => {
              const category = getCategoryFromTool(tool);
              const CatIcon = categoryMeta[category]?.icon || Wrench;
              const isBuiltin = tool.isBuiltin;

              return (
                <motion.div
                  key={tool.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ delay: i * 0.03 }}
                  className={`bg-card border rounded-xl p-5 transition-colors ${
                    tool.isActive ? "border-border hover:border-primary/20" : "border-border opacity-60"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4 flex-1 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
                        <CatIcon className="w-5 h-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-3 flex-wrap">
                          <h3 className="font-semibold text-card-foreground font-mono text-sm">{tool.name}</h3>
                          <Badge variant="outline" className="text-[10px]">
                            {categoryMeta[category]?.label}
                          </Badge>
                          {isBuiltin && (
                            <Badge variant="outline" className="text-[10px] bg-muted">
                              Built-in
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">{tool.description}</p>
                        <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                          <span>{tool.parameters.length} params</span>
                          {!isBuiltin && (
                            <>
                              <span>Created: {formatDate(tool.createdAt)}</span>
                              {getMethodFromTool(tool) && (
                                <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-[10px]">
                                  {getMethodFromTool(tool)} {getEndpointFromTool(tool).slice(0, 30)}
                                  {getEndpointFromTool(tool).length > 30 ? "..." : ""}
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      {!isBuiltin && (
                        <Switch
                          checked={tool.isActive}
                          onCheckedChange={() => handleToggleEnabled(tool)}
                        />
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="text-muted-foreground">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setSelectedTool(tool)}>
                            <Settings className="w-4 h-4 mr-2" /> View Details
                          </DropdownMenuItem>
                          {!isBuiltin && (
                            <DropdownMenuItem
                              onClick={() => handleDeleteTool(tool)}
                              className="text-destructive"
                            >
                              <Trash2 className="w-4 h-4 mr-2" /> Delete
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </motion.div>
              );
            })}
        </AnimatePresence>

        {!isLoading && filtered.length === 0 && (
          <div className="text-center p-8">
            <Wrench className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-card-foreground">No Tools Found</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {showBuiltin ? "No built-in tools available." : "Create your first custom tool to get started."}
            </p>
          </div>
        )}
      </div>

      {/* Detail dialog */}
      <Dialog open={!!selectedTool} onOpenChange={() => setSelectedTool(null)}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
          {selectedTool && (
            <>
              <DialogHeader>
                <DialogTitle className="font-mono">{selectedTool.name}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                <p className="text-sm text-muted-foreground">{selectedTool.description}</p>
                {selectedTool.execution.type === "http" && (
                  <div className="bg-muted rounded-lg p-3">
                    <span className="text-xs text-muted-foreground">Endpoint</span>
                    <p className="font-mono text-sm text-foreground mt-0.5">
                      {(selectedTool.execution as { method?: string }).method || "GET"} {selectedTool.execution.url}
                    </p>
                  </div>
                )}
                {selectedTool.execution.type === "code" && (
                  <div className="bg-muted rounded-lg p-3">
                    <span className="text-xs text-muted-foreground">Execution Type</span>
                    <p className="font-mono text-sm text-foreground mt-0.5">JavaScript Code</p>
                  </div>
                )}
                <div>
                  <h4 className="text-sm font-medium text-foreground mb-2">Parameters</h4>
                  <div className="space-y-2">
                    {selectedTool.parameters.map((p, i) => (
                      <div key={i} className="bg-muted rounded-lg p-3 flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <code className="text-sm font-mono text-foreground">{p.name}</code>
                            <Badge variant="outline" className="text-[10px]">
                              {p.type}
                            </Badge>
                            {p.required && (
                              <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/20">
                                required
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">{p.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Tool</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Function Name</label>
              <Input
                placeholder="e.g. search_documents"
                className="font-mono"
                value={newTool.name}
                onChange={(e) => setNewTool((p) => ({ ...p, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Description</label>
              <Textarea
                placeholder="What does this tool do? Be specific about when the AI should use it."
                value={newTool.description}
                onChange={(e) => setNewTool((p) => ({ ...p, description: e.target.value }))}
                rows={2}
              />
            </div>

            {/* Execution Type */}
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Execution Type</label>
              <Select
                value={newTool.executionType}
                onValueChange={(v: "http" | "code") => setNewTool((p) => ({ ...p, executionType: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="http">HTTP Request</SelectItem>
                  <SelectItem value="code">JavaScript Code</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {newTool.executionType === "http" ? (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-1">
                    <label className="text-sm font-medium text-foreground mb-1.5 block">Method</label>
                    <Select
                      value={newTool.method}
                      onValueChange={(v: typeof newTool.method) => setNewTool((p) => ({ ...p, method: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="GET">GET</SelectItem>
                        <SelectItem value="POST">POST</SelectItem>
                        <SelectItem value="PUT">PUT</SelectItem>
                        <SelectItem value="PATCH">PATCH</SelectItem>
                        <SelectItem value="DELETE">DELETE</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <label className="text-sm font-medium text-foreground mb-1.5 block">URL</label>
                    <Input
                      placeholder="https://api.example.com/endpoint"
                      className="font-mono"
                      value={newTool.endpoint}
                      onChange={(e) => setNewTool((p) => ({ ...p, endpoint: e.target.value }))}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Use {"{{parameterName}}"} placeholders in the URL to insert parameter values.
                </p>
              </>
            ) : (
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">JavaScript Code</label>
                <Textarea
                  placeholder={`// Access parameters via args object\nconst result = {\n  greeting: \`Hello, \${args.name}!\`,\n  timestamp: new Date().toISOString()\n};\nreturn result;`}
                  className="font-mono text-xs"
                  value={newTool.code}
                  onChange={(e) => setNewTool((p) => ({ ...p, code: e.target.value }))}
                  rows={8}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Access parameters via the <code>args</code> object. Return the result.
                </p>
              </div>
            )}

            {/* Parameters */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-foreground">Parameters</label>
                <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={addParam}>
                  <Plus className="w-3 h-3" /> Add
                </Button>
              </div>
              <div className="space-y-3">
                {newTool.parameters.map((param, i) => (
                  <div key={i} className="bg-muted rounded-lg p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="name"
                        className="font-mono text-sm h-8"
                        value={param.name}
                        onChange={(e) => updateParam(i, "name", e.target.value)}
                      />
                      <Select
                        value={param.type}
                        onValueChange={(v: ToolParameter["type"]) => updateParam(i, "type", v)}
                      >
                        <SelectTrigger className="w-28 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="string">string</SelectItem>
                          <SelectItem value="number">number</SelectItem>
                          <SelectItem value="boolean">boolean</SelectItem>
                          <SelectItem value="object">object</SelectItem>
                          <SelectItem value="array">array</SelectItem>
                        </SelectContent>
                      </Select>
                      <div className="flex items-center gap-1">
                        <Switch checked={param.required} onCheckedChange={(v) => updateParam(i, "required", v)} />
                        <span className="text-[10px] text-muted-foreground">req</span>
                      </div>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive shrink-0" onClick={() => removeParam(i)}>
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                    <Input
                      placeholder="Parameter description"
                      className="text-xs h-7"
                      value={param.description}
                      onChange={(e) => updateParam(i, "description", e.target.value)}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  resetForm();
                  setShowCreate(false);
                }}
              >
                Cancel
              </Button>
              <Button onClick={handleCreateTool} disabled={createToolMutation.isPending}>
                {createToolMutation.isPending ? "Creating..." : "Create Tool"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
