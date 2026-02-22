import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Send, Bot, User, Sparkles, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import ReactMarkdown from "react-markdown";
import { useAdminChat } from "@/hooks/api";
import { AdminAPI } from "@/services/adminApi";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const isConfigured = AdminAPI.isConfigured();

  const adminChat = useAdminChat({
    onSuccess: (data) => {
      // Save session ID for conversation continuity
      setSessionId(data.sessionId);
      
      // Add assistant message
      const assistantMsg: Message = {
        id: Date.now().toString(),
        role: "assistant",
        content: data.message,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setIsLoading(false);
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to send message",
      });
      setIsLoading(false);
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const sendMessage = () => {
    if (!input.trim() || isLoading) return;
    if (!isConfigured) {
      toast({
        variant: "destructive",
        title: "Configuration Error",
        description: "Please set VITE_MASTER_API_KEY in your .env file",
      });
      return;
    }

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    // Send message using admin API
    adminChat.mutate({
      userId: "admin-user",
      sessionId,
      message: userMsg.content,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setSessionId(undefined);
    toast({
      title: "Chat cleared",
      description: "Started a new conversation",
    });
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="flex items-center justify-between pb-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Admin Chat</h1>
          <p className="text-muted-foreground mt-1">
            Unlimited chat using admin endpoint
            {!isConfigured && (
              <span className="text-destructive ml-2">(API key not configured)</span>
            )}
          </p>
        </div>
        {messages.length > 0 && (
          <Button variant="outline" size="sm" onClick={clearChat}>
            New Chat
          </Button>
        )}
      </div>

      {!isConfigured && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Please configure <code className="font-mono text-xs">VITE_MASTER_API_KEY</code> in your .env file to use the admin chat.
          </AlertDescription>
        </Alert>
      )}

      <div
        ref={scrollRef}
        className="flex-1 overflow-auto rounded-xl border border-border bg-card p-4 space-y-4"
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <Sparkles className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold text-card-foreground">
              Start a conversation
            </h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              Type a message below to interact with the AI agent using the admin
              API (unlimited).
            </p>
            {sessionId && (
              <p className="text-xs text-muted-foreground mt-2">
                Session: {sessionId.slice(0, 8)}...
              </p>
            )}
          </div>
        )}
        {messages.map((msg) => (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}
          >
            {msg.role === "assistant" && (
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0 mt-1">
                <Bot className="w-4 h-4" />
              </div>
            )}
            <div
              className={`max-w-[70%] rounded-xl px-4 py-3 ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-card-foreground"
              }`}
            >
              {msg.role === "assistant" ? (
                <div className="max-w-none text-sm text-card-foreground [&_p]:m-0 [&_ul]:my-2 [&_ol]:my-2">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-sm">{msg.content}</p>
              )}
            </div>
            {msg.role === "user" && (
              <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-secondary-foreground shrink-0 mt-1">
                <User className="w-4 h-4" />
              </div>
            )}
          </motion.div>
        ))}
        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground text-xs pl-11">
            <div className="flex gap-1">
              <span
                className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce"
                style={{ animationDelay: "0ms" }}
              />
              <span
                className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce"
                style={{ animationDelay: "150ms" }}
              />
              <span
                className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce"
                style={{ animationDelay: "300ms" }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex items-end gap-3 pt-4">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            isConfigured
              ? "Type a message..."
              : "Configure API key to start chatting..."
          }
          className="resize-none min-h-[48px] max-h-32"
          rows={1}
          disabled={!isConfigured}
        />
        <Button
          onClick={sendMessage}
          disabled={isLoading || !input.trim() || !isConfigured}
          size="icon"
          className="shrink-0 h-12 w-12"
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
