import { createFileRoute } from "@tanstack/react-router";
import { OrderList } from "@/components/order-list";
import { Package, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/orders")({
  component: OrdersPage,
});

function OrdersPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Package className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-bold">My Orders</h1>
          </div>
          <p className="text-muted-foreground">
            View and manage your active bridge intents across all chains
          </p>
        </div>
        
        <div className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground">
          <RefreshCw className="h-4 w-4" />
          <span>Auto-refresh</span>
        </div>
      </div>

      <OrderList />
    </div>
  );
}
