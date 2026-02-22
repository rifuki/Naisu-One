import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Key, Plus, Copy, Eye, EyeOff, Trash2, Check, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  useApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
  useActivateApiKey,
  useDeleteApiKey,
} from "@/hooks/api";
import { AdminAPI } from "@/services/adminApi";

export default function ApiKeys() {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyDescription, setNewKeyDescription] = useState("");
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);

  const isConfigured = AdminAPI.isConfigured();

  // Fetch API keys
  const { data: keys = [], isLoading, error, refetch } = useApiKeys({
    enabled: isConfigured,
  });

  // Mutations
  const createKey = useCreateApiKey({
    onSuccess: (data) => {
      setNewlyCreatedKey(data.key);
      toast({
        title: "API Key Created",
        description: "Make sure to copy your API key now. You won't be able to see it again!",
      });
      setNewKeyName("");
      setNewKeyDescription("");
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to create API key",
      });
    },
  });

  const revokeKey = useRevokeApiKey({
    onSuccess: () => {
      toast({
        title: "API Key Revoked",
        description: "The API key has been revoked successfully.",
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to revoke API key",
      });
    },
  });

  const activateKey = useActivateApiKey({
    onSuccess: () => {
      toast({
        title: "API Key Activated",
        description: "The API key has been activated successfully.",
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to activate API key",
      });
    },
  });

  const deleteKey = useDeleteApiKey({
    onSuccess: () => {
      toast({
        title: "API Key Deleted",
        description: "The API key has been permanently deleted.",
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to delete API key",
      });
    },
  });

  const toggleVisibility = (id: string) => {
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const copyKey = (id: string, key: string) => {
    navigator.clipboard.writeText(key);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
    toast({
      title: "Copied",
      description: "API key copied to clipboard",
    });
  };

  const handleCreateKey = () => {
    if (!newKeyName) return;
    createKey.mutate({
      name: newKeyName,
      description: newKeyDescription,
      permissions: ["chat:write"],
    });
  };

  const handleRevokeKey = (id: string) => {
    revokeKey.mutate(id);
  };

  const handleActivateKey = (id: string) => {
    activateKey.mutate(id);
  };

  const handleDeleteKey = (id: string) => {
    if (confirm("Are you sure you want to permanently delete this API key?")) {
      deleteKey.mutate(id);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const maskKey = (key: string) => key.slice(0, 7) + "•".repeat(16) + key.slice(-4);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">API Keys</h1>
          <p className="text-muted-foreground mt-1">
            Manage your API keys and access tokens
            {!isConfigured && (
              <span className="text-destructive ml-2">(API key not configured)</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => refetch()}
            disabled={!isConfigured || isLoading}
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
          <Button
            onClick={() => setShowCreate(true)}
            className="gap-2"
            disabled={!isConfigured}
          >
            <Plus className="w-4 h-4" /> Create Key
          </Button>
        </div>
      </div>

      {!isConfigured && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Please configure <code className="font-mono text-xs">VITE_MASTER_API_KEY</code> in your .env file to manage API keys.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {error.message || "Failed to load API keys"}
          </AlertDescription>
        </Alert>
      )}

      {/* New Key Warning */}
      {newlyCreatedKey && (
        <Alert className="bg-warning/10 border-warning/20">
          <AlertCircle className="h-4 w-4 text-warning" />
          <AlertDescription className="space-y-2">
            <p className="font-medium">New API Key Created!</p>
            <p className="text-sm">Copy this key now. You won&apos;t be able to see it again!</p>
            <code className="block bg-background p-2 rounded text-xs font-mono break-all">
              {newlyCreatedKey}
            </code>
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
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setNewlyCreatedKey(null)}
            >
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="grid grid-cols-[1fr_2fr_auto_auto_auto] gap-4 px-5 py-3 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider">
          <span>Name</span>
          <span>Key</span>
          <span>Created</span>
          <span>Status</span>
          <span>Actions</span>
        </div>

        {isLoading && (
          <div className="p-4 space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-8 w-20" />
              </div>
            ))}
          </div>
        )}

        <AnimatePresence>
          {!isLoading && keys.map((item, i) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ delay: i * 0.03 }}
              className="grid grid-cols-[1fr_2fr_auto_auto_auto] gap-4 items-center px-5 py-4 border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Key className="w-4 h-4 text-primary" />
                <div>
                  <span className="font-medium text-sm text-card-foreground block">
                    {item.name}
                  </span>
                  {item.description && (
                    <span className="text-xs text-muted-foreground">
                      {item.description}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <code className="text-xs font-mono text-muted-foreground bg-muted px-2 py-1 rounded truncate max-w-[200px]">
                  {item.keyPrefix}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => toggleVisibility(item.id)}
                >
                  {visibleKeys.has(item.id) ? (
                    <EyeOff className="w-3.5 h-3.5" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => copyKey(item.id, item.keyPrefix)}
                >
                  {copiedKey === item.id ? (
                    <Check className="w-3.5 h-3.5 text-success" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </Button>
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {formatDate(item.createdAt)}
              </span>
              <div>
                {item.isActive ? (
                  <Badge
                    variant="outline"
                    className="bg-success/10 text-success border-success/20 text-[10px]"
                  >
                    Active
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="bg-destructive/10 text-destructive border-destructive/20 text-[10px]"
                  >
                    Revoked
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1">
                {item.isActive ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-warning hover:text-warning"
                    onClick={() => handleRevokeKey(item.id)}
                    disabled={revokeKey.isPending}
                  >
                    Revoke
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-success hover:text-success"
                    onClick={() => handleActivateKey(item.id)}
                    disabled={activateKey.isPending}
                  >
                    Activate
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive"
                  onClick={() => handleDeleteKey(item.id)}
                  disabled={deleteKey.isPending}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {!isLoading && keys.length === 0 && !error && (
          <div className="p-8 text-center">
            <Key className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-card-foreground">No API Keys</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Create your first API key to get started.
            </p>
          </div>
        )}
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create API Key</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">
                Key Name
              </label>
              <Input
                placeholder="e.g. Production API"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">
                Description (optional)
              </label>
              <Input
                placeholder="e.g. Main production API key"
                value={newKeyDescription}
                onChange={(e) => setNewKeyDescription(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleCreateKey}
                disabled={!newKeyName || createKey.isPending}
              >
                {createKey.isPending ? "Creating..." : "Generate Key"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
