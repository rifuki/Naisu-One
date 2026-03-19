export interface QuoteReviewWidget {
  type: 'quote_review';
  amount: string;
  fromChain: string;
  toChain: string;
  estimatedReceive: string;
  startPriceLamports: string;
  floorPriceLamports: string;
  fromUsdValue: string;
  toUsdValue: string;
  rate: string;
  priceSource: 'pyth' | 'coingecko' | 'fallback';
  confidence: number | null;
  outputTokenOptions: string[];
  durationOptions: number[];
  defaultOutputToken: string;
  defaultDuration: number;
  solverWarning?: string;
}

export interface BalanceDisplayWidget {
  type: 'balance_display';
  evmBalance?: string;
  evmAddress?: string;
  solBalance?: string;
  solAddress?: string;
}

export type AnyWidget = QuoteReviewWidget | BalanceDisplayWidget;

export interface WidgetConfirmPayload {
  widgetType: string;
  selection: Record<string, unknown>;
}
