import { motion } from "framer-motion";
import { Bot, Activity, Zap, Users, Server, Key, Database, AlertCircle, CheckCircle, FolderOpen } from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useHealth } from "@/hooks/api";
import { AdminAPI } from "@/services/adminApi";

const stats = [
  { title: "Active Agents", value: 12, icon: <Bot className="w-4 h-4" />, trend: { value: "3 this week", positive: true }, subtitle: "" },
  { title: "API Requests", value: "48.2K", icon: <Activity className="w-4 h-4" />, trend: { value: "12%", positive: true }, subtitle: "vs last month" },
  { title: "Tokens Used", value: "2.1M", icon: <Zap className="w-4 h-4" />, trend: { value: "8%", positive: false }, subtitle: "vs last month" },
  { title: "Active Users", value: 342, icon: <Users className="w-4 h-4" />, trend: { value: "24%", positive: true }, subtitle: "vs last month" },
];

const recentActivity = [
  { agent: "Customer Support Bot", action: "Handled 23 conversations", time: "2 min ago", status: "active" },
  { agent: "Data Analyzer", action: "Completed batch processing", time: "15 min ago", status: "completed" },
  { agent: "Content Writer", action: "Generated 5 articles", time: "1 hr ago", status: "completed" },
  { agent: "Code Assistant", action: "Reviewed 12 pull requests", time: "2 hrs ago", status: "active" },
  { agent: "Email Classifier", action: "Processed 450 emails", time: "3 hrs ago", status: "completed" },
];

interface HealthResponse {
  ok: boolean;
  service: string;
  llmProvider: string;
  oauthEnabled: boolean;
  apiKeyRequired: boolean;
  apiKeyConfigured: boolean;
  managedKeys: number;
  projects?: number;
  rateLimitingEnabled: boolean;
  rateLimitConfig?: {
    maxRequests: number;
    windowSeconds: number;
  };
}

export default function Dashboard() {
  const isConfigured = AdminAPI.isConfigured();
  const { data: health, isLoading, error } = useHealth({
    enabled: isConfigured,
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Monitor your AI agents and API usage</p>
      </div>

      {/* API Status */}
      {!isConfigured && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Please configure <code className="font-mono text-xs">VITE_MASTER_API_KEY</code> in your .env file to connect to the API.
          </AlertDescription>
        </Alert>
      )}

      {isConfigured && error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Failed to connect to API: {error.message}. Make sure the server is running at {AdminAPI.getBaseUrl()}
          </AlertDescription>
        </Alert>
      )}

      {isConfigured && health?.ok && (
        <Alert className="bg-success/10 border-success/20">
          <CheckCircle className="h-4 w-4 text-success" />
          <AlertDescription className="flex items-center justify-between">
            <span>Connected to Agent Infra API ({health.service})</span>
            <span className="text-xs text-muted-foreground">
              LLM: {health.llmProvider} | Managed Keys: {health.managedKeys}
            </span>
          </AlertDescription>
        </Alert>
      )}

      {/* Service Status Cards */}
      {isConfigured && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {isLoading ? (
            <>
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </>
          ) : health ? (
            <>
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 }}
              >
                <StatCard
                  title="Service Status"
                  value={health.ok ? "Online" : "Offline"}
                  icon={<Server className="w-4 h-4" />}
                  trend={{ value: health.service, positive: health.ok }}
                  subtitle=""
                />
              </motion.div>
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
              >
                <StatCard
                  title="LLM Provider"
                  value={health.llmProvider}
                  icon={<Zap className="w-4 h-4" />}
                  trend={{ value: "Active", positive: true }}
                  subtitle=""
                />
              </motion.div>
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
              >
                <StatCard
                  title="Managed Keys"
                  value={health.managedKeys}
                  icon={<Key className="w-4 h-4" />}
                  trend={{ value: "API Keys", positive: true }}
                  subtitle=""
                />
              </motion.div>
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                <StatCard
                  title="Projects"
                  value={(health as HealthResponse).projects ?? 0}
                  icon={<FolderOpen className="w-4 h-4" />}
                  trend={{ value: "Active", positive: true }}
                  subtitle=""
                />
              </motion.div>
            </>
          ) : null}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, i) => (
          <motion.div key={stat.title} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 + 0.25 }}>
            <StatCard {...stat} />
          </motion.div>
        ))}
      </div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="bg-card border border-border rounded-xl">
        <div className="p-5 border-b border-border">
          <h2 className="text-lg font-semibold text-card-foreground">Recent Activity</h2>
        </div>
        <div className="divide-y divide-border">
          {recentActivity.map((item, i) => (
            <div key={i} className="flex items-center justify-between px-5 py-4 hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${item.status === "active" ? "bg-success" : "bg-muted-foreground"}`} />
                <div>
                  <p className="text-sm font-medium text-card-foreground">{item.agent}</p>
                  <p className="text-xs text-muted-foreground">{item.action}</p>
                </div>
              </div>
              <span className="text-xs text-muted-foreground font-mono">{item.time}</span>
            </div>
          ))}
        </div>
      </motion.div>

      {/* API Configuration Info */}
      {isConfigured && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="bg-muted/50 border border-border rounded-xl p-5"
        >
          <h3 className="text-sm font-medium text-card-foreground mb-2">API Configuration</h3>
          <div className="space-y-1 text-xs text-muted-foreground font-mono">
            <p>Base URL: {AdminAPI.getBaseUrl()}</p>
            <p>API Key: {AdminAPI.getKeyPreview()}</p>
          </div>
        </motion.div>
      )}
    </div>
  );
}
