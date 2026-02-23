import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { DashboardLayout } from "./components/DashboardLayout";
import Dashboard from "./pages/Dashboard";
import Projects from "./pages/Projects";
import Agents from "./pages/Agents";
import ApiKeys from "./pages/ApiKeys";
import Chat from "./pages/Chat";
import Tools from "./pages/Tools";
import KnowledgeBase from "./pages/KnowledgeBase";
import NotFound from "./pages/NotFound";
import Login from "./pages/Login";
import { getAuthMe } from "./services/authApi";

const queryClient = new QueryClient();

const ProtectedRoutes = () => (
  <DashboardLayout>
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/projects" element={<Projects />} />
      <Route path="/agents" element={<Agents />} />
      <Route path="/tools" element={<Tools />} />
      <Route path="/api-keys" element={<ApiKeys />} />
      <Route path="/chat" element={<Chat />} />
      <Route path="/knowledge-base" element={<KnowledgeBase />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  </DashboardLayout>
);

const App = () => {
  const [checked, setChecked] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    getAuthMe()
      .then((res) => setAuthed(!!res.authenticated))
      .finally(() => setChecked(true));
  }, []);

  if (!checked) {
    return <div className="min-h-screen bg-background text-foreground flex items-center justify-center">Checking session...</div>;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <div className="dark">
            <Routes>
              <Route path="/login" element={authed ? <Navigate to="/" replace /> : <Login />} />
              <Route path="/*" element={authed ? <ProtectedRoutes /> : <Navigate to="/login" replace />} />
            </Routes>
          </div>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
