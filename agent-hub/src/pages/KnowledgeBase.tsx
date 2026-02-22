import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Database, Upload, FileText, Trash2, Search, Plus, File, Globe, AlertCircle, RefreshCw, X, FileUp, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  useIngestDocument,
  useRAGJobStatus,
  useSearchKnowledgeBaseMutation,
  useUploadDocument,
} from "@/hooks/api";
import { AdminAPI, RAGSearchResult } from "@/services/adminApi";

// Local type for knowledge sources (combining job status + metadata)
interface KnowledgeSource {
  id: string;
  jobId: string;
  name: string;
  type: "document" | "website" | "api" | "text";
  status: "pending" | "processing" | "completed" | "failed";
  chunks?: number;
  createdAt: string;
  content?: string;
  fileInfo?: {
    size: number;
    wordCount: number;
    pages?: number;
    fileType: string;
  };
}

// Supported file types
const SUPPORTED_FILE_TYPES = [
  { type: "text/plain", ext: ".txt", label: "Text" },
  { type: "text/markdown", ext: ".md", label: "Markdown" },
  { type: "application/json", ext: ".json", label: "JSON" },
  { type: "application/pdf", ext: ".pdf", label: "PDF" },
  { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: ".docx", label: "Word" },
  { type: "text/csv", ext: ".csv", label: "CSV" },
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export default function KnowledgeBase() {
  const { toast } = useToast();
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchResults, setSearchResults] = useState<RAGSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  
  // Upload form state
  const [uploadName, setUploadName] = useState("");
  const [uploadContent, setUploadContent] = useState("");
  const [uploadTenantId, setUploadTenantId] = useState("default");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  
  // File upload state
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const isConfigured = AdminAPI.isConfigured();

  // Mutations
  const ingestDocument = useIngestDocument({
    onSuccess: (data) => {
      toast({
        title: "Document Ingested",
        description: `Job ID: ${data.jobId}. Processing...`,
      });
      setActiveJobId(data.jobId);
      
      // Add to sources list
      const newSource: KnowledgeSource = {
        id: Date.now().toString(),
        jobId: data.jobId,
        name: uploadName,
        type: "text",
        status: "pending",
        createdAt: new Date().toISOString(),
        content: uploadContent.slice(0, 100) + "...",
      };
      setSources((prev) => [newSource, ...prev]);
      
      // Reset form
      setUploadName("");
      setUploadContent("");
      setShowUpload(false);
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to ingest document",
      });
    },
  });

  const uploadDocument = useUploadDocument({
    onSuccess: (data) => {
      toast({
        title: "File Uploaded",
        description: `${data.parsed?.filename || 'File'} is being processed...`,
      });
      setActiveJobId(data.jobId);
      
      // Add to sources list
      const newSource: KnowledgeSource = {
        id: Date.now().toString(),
        jobId: data.jobId,
        name: data.parsed?.filename || selectedFile?.name || "Uploaded File",
        type: "document",
        status: "pending",
        createdAt: new Date().toISOString(),
        fileInfo: data.parsed ? {
          size: data.parsed.size,
          wordCount: data.parsed.wordCount,
          pages: data.parsed.pages,
          fileType: data.parsed.type,
        } : undefined,
      };
      setSources((prev) => [newSource, ...prev]);
      
      // Reset file state
      setSelectedFile(null);
      setUploadProgress(0);
      setShowUpload(false);
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Upload Error",
        description: error.message || "Failed to upload file",
      });
      setUploadProgress(0);
    },
  });

  const searchMutation = useSearchKnowledgeBaseMutation();

  // Track job status
  const { data: jobStatus } = useRAGJobStatus(activeJobId, {
    enabled: !!activeJobId,
  });

  // Update source status when job status changes
  useEffect(() => {
    if (jobStatus && activeJobId) {
      setSources((prev) =>
        prev.map((source) =>
          source.jobId === activeJobId
            ? {
                ...source,
                status: jobStatus.status,
                chunks: jobStatus.chunks,
              }
            : source
        )
      );
      
      // Clear active job if completed or failed
      if (jobStatus.status === "completed" || jobStatus.status === "failed") {
        if (jobStatus.status === "completed") {
          toast({
            title: "Document Indexed",
            description: `Successfully processed ${jobStatus.chunks || 0} chunks`,
          });
        } else if (jobStatus.status === "failed") {
          toast({
            variant: "destructive",
            title: "Indexing Failed",
            description: jobStatus.error || "Unknown error",
          });
        }
        setActiveJobId(null);
      }
    }
  }, [jobStatus, activeJobId, toast]);

  const handleIngest = () => {
    if (!uploadName || !uploadContent) {
      toast({
        variant: "destructive",
        title: "Validation Error",
        description: "Please provide both name and content",
      });
      return;
    }

    ingestDocument.mutate({
      tenantId: uploadTenantId,
      source: uploadName,
      content: uploadContent,
      metadata: {
        createdBy: "admin",
        type: "text",
      },
    });
  };

  const handleFileUpload = () => {
    if (!selectedFile) {
      toast({
        variant: "destructive",
        title: "No File Selected",
        description: "Please select a file to upload",
      });
      return;
    }

    // Simulate upload progress
    setUploadProgress(10);
    const progressInterval = setInterval(() => {
      setUploadProgress((prev) => {
        if (prev >= 90) {
          clearInterval(progressInterval);
          return prev;
        }
        return prev + 10;
      });
    }, 100);

    uploadDocument.mutate(
      {
        file: selectedFile,
        tenantId: uploadTenantId,
        metadata: {
          createdBy: "admin",
          type: "document",
        },
      },
      {
        onSettled: () => {
          clearInterval(progressInterval);
          setUploadProgress(100);
        },
      }
    );
  };

  const handleSearch = async () => {
    if (!searchQuery) return;
    setIsSearching(true);
    
    try {
      const results = await searchMutation.mutateAsync({
        tenantId: "default",
        query: searchQuery,
        limit: 5,
      });
      setSearchResults(results);
      showSearch && setShowSearch(true);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Search Error",
        description: error instanceof Error ? error.message : "Failed to search",
      });
    } finally {
      setIsSearching(false);
    }
  };

  const deleteSource = (id: string) => {
    setSources((prev) => prev.filter((s) => s.id !== id));
    toast({
      title: "Source Removed",
      description: "The source has been removed from the list",
    });
  };

  const totalChunks = sources.reduce((acc, s) => acc + (s.chunks || 0), 0);
  const completedChunks = sources
    .filter((s) => s.status === "completed")
    .reduce((acc, s) => acc + (s.chunks || 0), 0);

  // Drag and drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      validateAndSetFile(files[0]);
    }
  }, []);

  const validateAndSetFile = (file: File) => {
    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      toast({
        variant: "destructive",
        title: "File Too Large",
        description: `Maximum file size is 10MB. Your file is ${(file.size / 1024 / 1024).toFixed(2)}MB`,
      });
      return;
    }

    // Check file type
    const supportedType = SUPPORTED_FILE_TYPES.find(
      (t) => t.type === file.type || file.name.endsWith(t.ext)
    );

    if (!supportedType) {
      const supportedExts = SUPPORTED_FILE_TYPES.map(t => t.ext).join(", ");
      toast({
        variant: "destructive",
        title: "Unsupported File Type",
        description: `Supported formats: ${supportedExts}`,
      });
      return;
    }

    setSelectedFile(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      validateAndSetFile(file);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1024 / 1024).toFixed(2) + " MB";
  };

  const typeIcons: Record<string, typeof FileText> = {
    document: FileText,
    website: Globe,
    api: Database,
    text: FileText,
  };

  const statusColors: Record<string, string> = {
    completed: "bg-success/15 text-success border-success/20",
    processing: "bg-warning/15 text-warning border-warning/20",
    pending: "bg-warning/15 text-warning border-warning/20",
    failed: "bg-destructive/15 text-destructive border-destructive/20",
  };

  const isUploading = uploadDocument.isPending || uploadProgress > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Knowledge Base</h1>
          <p className="text-muted-foreground mt-1">
            Manage your RAG data sources and vector embeddings
            {!isConfigured && (
              <span className="text-destructive ml-2">(API key not configured)</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setShowSearch(true)}
            disabled={!isConfigured}
            className="gap-2"
          >
            <Search className="w-4 h-4" /> Search
          </Button>
          <Button
            onClick={() => setShowUpload(true)}
            disabled={!isConfigured}
            className="gap-2"
          >
            <Plus className="w-4 h-4" /> Add Source
          </Button>
        </div>
      </div>

      {!isConfigured && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Please configure <code className="font-mono text-xs">VITE_MASTER_API_KEY</code> in your .env file to manage knowledge base.
          </AlertDescription>
        </Alert>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-sm text-muted-foreground">Total Sources</p>
          <p className="text-2xl font-bold text-card-foreground mt-1">
            {sources.length}
          </p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-sm text-muted-foreground">Total Chunks</p>
          <p className="text-2xl font-bold text-card-foreground mt-1">
            {totalChunks.toLocaleString()}
          </p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-sm text-muted-foreground">Index Health</p>
          <div className="flex items-center gap-3 mt-2">
            <Progress
              value={totalChunks > 0 ? (completedChunks / totalChunks) * 100 : 100}
              className="h-2 flex-1"
            />
            <span className="text-sm font-semibold text-card-foreground">
              {totalChunks > 0
                ? Math.round((completedChunks / totalChunks) * 100)
                : 100}
              %
            </span>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search knowledge base..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="pl-10"
            disabled={!isConfigured}
          />
        </div>
        <Button
          onClick={handleSearch}
          disabled={!searchQuery || isSearching || !isConfigured}
        >
          {isSearching ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            "Search"
          )}
        </Button>
      </div>

      {/* Sources list */}
      <div className="space-y-3">
        <AnimatePresence>
          {sources.map((source, i) => {
            const Icon = typeIcons[source.type] || File;
            return (
              <motion.div
                key={source.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ delay: i * 0.03 }}
                className="bg-card border border-border rounded-xl p-5 hover:border-primary/20 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-3">
                        <h3 className="font-semibold text-card-foreground">
                          {source.name}
                        </h3>
                        <Badge
                          variant="outline"
                          className={statusColors[source.status]}
                        >
                          {source.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                        {source.chunks !== undefined && (
                          <span>{source.chunks.toLocaleString()} chunks</span>
                        )}
                        {source.fileInfo && (
                          <>
                            <span>{formatFileSize(source.fileInfo.size)}</span>
                            <span>{source.fileInfo.wordCount.toLocaleString()} words</span>
                            {source.fileInfo.pages && (
                              <span>{source.fileInfo.pages} pages</span>
                            )}
                          </>
                        )}
                        <span>
                          {new Date(source.createdAt).toLocaleDateString()}
                        </span>
                        <span className="font-mono text-[10px]">
                          Job: {source.jobId.slice(0, 8)}...
                        </span>
                      </div>
                      {source.content && (
                        <p className="text-xs text-muted-foreground mt-2 max-w-xl truncate">
                          {source.content}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => deleteSource(source.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {sources.length === 0 && !isConfigured && (
          <div className="text-center p-8">
            <Database className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-card-foreground">
              Configure API Key
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Add your master API key to start managing the knowledge base.
            </p>
          </div>
        )}

        {sources.length === 0 && isConfigured && (
          <div className="text-center p-8">
            <Database className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-card-foreground">
              No Sources Yet
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Add your first knowledge source to get started.
            </p>
          </div>
        )}
      </div>

      {/* Add Source Dialog */}
      <Dialog open={showUpload} onOpenChange={setShowUpload}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Knowledge Source</DialogTitle>
          </DialogHeader>
          
          <Tabs defaultValue="file" className="mt-2">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="file" className="gap-2">
                <FileUp className="w-4 h-4" /> Upload File
              </TabsTrigger>
              <TabsTrigger value="text" className="gap-2">
                <FileText className="w-4 h-4" /> Paste Text
              </TabsTrigger>
            </TabsList>
            
            {/* File Upload Tab */}
            <TabsContent value="file" className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">
                  Tenant ID
                </label>
                <Input
                  placeholder="default"
                  value={uploadTenantId}
                  onChange={(e) => setUploadTenantId(e.target.value)}
                />
              </div>

              {/* Drag and Drop Area */}
              <div
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                className={`
                  relative border-2 border-dashed rounded-xl p-8 text-center transition-all
                  ${isDragging 
                    ? "border-primary bg-primary/5" 
                    : "border-border hover:border-muted-foreground/50"
                  }
                  ${selectedFile ? "bg-success/5 border-success/30" : ""}
                `}
              >
                <input
                  type="file"
                  onChange={handleFileInput}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  accept={SUPPORTED_FILE_TYPES.map(t => t.ext).join(",")}
                  disabled={isUploading}
                />
                
                {selectedFile ? (
                  <div className="space-y-3">
                    <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center mx-auto">
                      <CheckCircle className="w-6 h-6 text-success" />
                    </div>
                    <div>
                      <p className="font-medium text-card-foreground">{selectedFile.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatFileSize(selectedFile.size)} • {selectedFile.type || "Unknown type"}
                      </p>
                    </div>
                    {uploadProgress > 0 && (
                      <div className="w-full max-w-xs mx-auto">
                        <Progress value={uploadProgress} className="h-2" />
                        <p className="text-xs text-muted-foreground mt-1">
                          {uploadProgress < 100 ? "Uploading..." : "Processing..."}
                        </p>
                      </div>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedFile(null);
                        setUploadProgress(0);
                      }}
                      disabled={isUploading}
                    >
                      <X className="w-4 h-4 mr-1" /> Remove
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto">
                      <Upload className="w-6 h-6 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium text-card-foreground">
                        {isDragging ? "Drop file here" : "Drag & drop or click to upload"}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Supports: TXT, MD, JSON, PDF, DOCX, CSV
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Maximum file size: 10MB
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setShowUpload(false)} disabled={isUploading}>
                  Cancel
                </Button>
                <Button
                  onClick={handleFileUpload}
                  disabled={!selectedFile || isUploading}
                >
                  {isUploading ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4 mr-2" />
                      Upload & Process
                    </>
                  )}
                </Button>
              </div>
            </TabsContent>
            
            {/* Text Paste Tab */}
            <TabsContent value="text" className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">
                  Source Name
                </label>
                <Input
                  placeholder="e.g. Product Documentation"
                  value={uploadName}
                  onChange={(e) => setUploadName(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">
                  Tenant ID
                </label>
                <Input
                  placeholder="default"
                  value={uploadTenantId}
                  onChange={(e) => setUploadTenantId(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">
                  Content
                </label>
                <Textarea
                  placeholder="Paste your document content here..."
                  value={uploadContent}
                  onChange={(e) => setUploadContent(e.target.value)}
                  rows={8}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setShowUpload(false)} disabled={ingestDocument.isPending}>
                  Cancel
                </Button>
                <Button
                  onClick={handleIngest}
                  disabled={!uploadName || !uploadContent || ingestDocument.isPending}
                >
                  {ingestDocument.isPending ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    "Add Source"
                  )}
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Search Results Dialog */}
      <Dialog open={showSearch} onOpenChange={setShowSearch}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Search Results</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {searchResults.length === 0 && !isSearching && (
              <p className="text-center text-muted-foreground py-8">
                No results found. Try a different search query.
              </p>
            )}
            {searchResults.map((result) => (
              <div
                key={result.id}
                className="border border-border rounded-lg p-4 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-primary">
                    {result.source}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    Score: {(result.score * 100).toFixed(1)}%
                  </Badge>
                </div>
                <p className="text-sm text-card-foreground whitespace-pre-wrap">
                  {result.content}
                </p>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
