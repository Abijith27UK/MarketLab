// Convex schema definitions for MarketLab
// This file defines the data model used by the Convex backend

// User preferences and profile
export const userPreferences = {
  userId: "string",
  theme: "light" | "dark" | "system",
  currency: "string",
  timezone: "string",
  defaultTradingMode: "paper" | "live",
  defaultOrderSettings: {
    productType: "string",
    duration: "string",
    autoSquareOff: boolean,
  },
  watchlistPreferences: {
    defaultView: "string",
    autoRefresh: boolean,
  },
  notificationPreferences: {
    emailNotifications: boolean,
    priceAlerts: boolean,
    weeklyDigest: boolean,
  },
  createdAt: number,
  updatedAt: number,
};

// Instruments/market instruments
export const instruments = {
  instrumentId: "string",
  symbol: "string",
  name: "string",
  exchange: "string",
  instrumentType: "string",
  segment: "string",
  sector: "string",
  industry: "string",
  lotSize: number,
  tickSize: number,
  expiry: "number | null",
  strikePrice: "number | null",
  underlyingInstrumentId: "string | null",
  listingStatus: "string",
  currency: "string",
  isActive: boolean,
  isIndex: boolean,
  marketCap: "number | null",
  lastUpdated: number,
};

// Watchlists
export const watchlists = {
  userId: "string",
  name: "string",
  description: "string",
  isDefault: boolean,
  isPublic: boolean,
  createdAt: number,
  updatedAt: number,
};

export const watchlistItems = {
  watchlistId: "string",
  instrumentId: "string",
  position: number,
};

// Trading accounts
export const tradingAccounts = {
  userId: "string",
  brokerName: "string",
  accountId: "string",
  accountName: "string",
  isPaper: boolean,
  status: "string",
  createdAt: number,
  updatedAt: number,
};

// Orders
export const orders = {
  userId: "string",
  orderId: "string",
  instrumentId: "string",
  side: "BUY" | "SELL",
  orderType: "MARKET" | "LIMIT" | "STOP_LOSS" | "STOP_LIMIT",
  quantity: number,
  price: "number | null",
  triggerPrice: "number | null",
  status: "PENDING" | "SUBMITTED" | "FILLED" | "CANCELLED" | "REJECTED",
  averagePrice: "number | null",
  filledQuantity: number,
  totalQuantity: number,
  placeholderOrderId: "string",
  createdAt: number,
  updatedAt: number,
};

// Positions
export const positions = {
  userId: "string",
  instrumentId: "string",
  netQuantity: number,
  averagePrice: number,
  totalBuyQuantity: number,
  totalSellQuantity: number,
  totalBuyAmount: number,
  totalSellAmount: number,
  todayBuyQuantity: number,
  todaySellQuantity: number,
  todayBuyAmount: number,
  todaySellAmount: number,
  unrealizedPL: number,
  realizedPL: number,
  lastUpdated: number,
};

// Holdings (historical)
export const holdings = {
  userId: "string",
  instrumentId: "string",
  quantity: number,
  averagePrice: number,
  purchaseDate: number,
  purchaseId: "string",
  saleDate: "number | null",
  salePrice: "number | null",
  realizedPL: number,
};

// Cash balances
export const cashBalances = {
  userId: "string",
  availableCash: number,
  totalDebit: number,
  totalCredit: number,
  lastUpdated: number,
};

// Strategies
export const strategies = {
  userId: "string",
  name: "string",
  description: "string",
  definition: {
    entryRules: any[],
    exitRules: any[],
    riskManagement: {
      positionSizing: "string",
      stopLoss: number,
      takeProfit: "number | null",
      trailingStop: "number | null",
      maxConcurrentPositions: number,
      maxCapitalAllocation: number,
    },
    parameters: {
      timeframe: "string",
      indicators: {
        smaPeriod: number,
        emaPeriod: number,
        rsiPeriod: number,
        macdFast: number,
        macdSlow: number,
      },
    },
  },
  isPaper: boolean,
  isPublished: boolean,
  createdAt: number,
  updatedAt: number,
};

// Strategy versions
export const strategyVersions = {
  strategyId: "string",
  version: number,
  definition: any,
  testResults: {
    startDate: number,
    endDate: number,
    initialCapital: number,
    finalEquity: number,
    totalReturn: number,
    maxDrawdown: number,
    sharpeRatio: number,
    totalTrades: number,
    winRate: number,
    profitFactor: number,
  },
  createdAt: number,
};

// Backtest runs
export const backtestRuns = {
  userId: "string",
  strategyId: "string",
  strategyVersion: number,
  instrumentUniverse: any[],
  startDate: number,
  endDate: number,
  timeframe: "string",
  initialCapital: number,
  positionSizing: "string",
  transactionCosts: number,
  slippage: number,
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED",
  results: {
    initialCapital: number,
    finalEquity: number,
    totalReturn: number,
    maxDrawdown: number,
    sharpeRatio: number,
    totalTrades: number,
    winRate: number,
    profitFactor: number,
    averageTradeExpectancy: number,
    averageHoldingDuration: number,
  },
  createdAt: number,
};

// Backtest trades
export const backtestTrades = {
  backtestId: "string",
  orderId: "string",
  instrumentId: "string",
  side: "BUY" | "SELL",
  quantity: number,
  price: number,
  timestamp: number,
  pnl: number,
  strategyRule: "string",
};

// Alerts
export const alerts = {
  userId: "string",
  type: "string",
  instrumentId: "string | null",
  condition: {
    threshold: number,
    operator: "above" | "below" | "crossover" | "crossunder",
    indicator: "string | null",
  },
  isActive: boolean,
  triggeredAt: "number | null",
  createdAt: number,
};

// Audit logs
export const auditLogs = {
  userId: "string",
  action: "string",
  entityType: "order" | "position" | "strategy" | "backtest",
  entityId: "string",
  details: {},
  createdAt: number,
};

// Market data source configurations
export const marketDataSources = {
  name: "string",
  type: "string",
  config: {
    apiKey: "string | null",
    baseUrl: "string",
    symbols: any[],
  },
  isActive: boolean,
  lastSyncedAt: "number | null",
  createdAt: number,
};

// Market status
export const marketStatus = {
  market: "string",
  status: "string",
  lastUpdate: number,
  indexValues: {
    nifty50: "number | null",
    sensex: "number | null",
  },
  topGainers: any[],
  topLosers: any[],
  mostActive: any[],
};