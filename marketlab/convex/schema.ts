import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

const exchangeValidator = v.union(v.literal("NSE"), v.literal("BSE"));
const instrumentTypeValidator = v.union(
  v.literal("EQUITY"),
  v.literal("ETF"),
  v.literal("INDEX"),
  v.literal("OTHER")
);
/** Freshness label carried by every market value the API returns. */
const dataModeValidator = v.union(
  v.literal("LIVE"),
  v.literal("DELAYED"),
  v.literal("CACHED"),
  v.literal("HISTORICAL"),
  v.literal("SAMPLE")
);
const nullableNumber = v.union(v.number(), v.null());
const conditionValidator = v.object({
  type: v.string(),
  maKind: v.union(v.literal("SMA"), v.literal("EMA"), v.null()),
  period: nullableNumber,
  fast: nullableNumber,
  slow: nullableNumber,
  signal: nullableNumber,
  threshold: nullableNumber,
});

const ruleSetValidator = v.object({
  combinator: v.union(v.literal("AND"), v.literal("OR")),
  conditions: v.array(conditionValidator),
});

const intervalValidator = v.union(
  v.literal("1m"),
  v.literal("5m"),
  v.literal("15m"),
  v.literal("1h"),
  v.literal("1d"),
  v.literal("1w"),
  v.literal("1M")
);

export default defineSchema({
  // Convex Auth built-in tables (accounts, sessions, users)
  ...authTables,

  // Per-user profile and preferences. Owner derived from auth, not client input.
  userProfiles: defineTable({
    userId: v.id("users"),
    name: v.string(),
    theme: v.union(v.literal("light"), v.literal("dark"), v.literal("system")),
    currency: v.string(),
    timezone: v.string(),
    defaultTradingMode: v.union(v.literal("paper"), v.literal("live")),
    defaultOrderSettings: v.object({
      productType: v.string(),
      duration: v.string(),
      autoSquareOff: v.boolean(),
    }),
    notificationPreferences: v.object({
      emailNotifications: v.boolean(),
      priceAlerts: v.boolean(),
      weeklyDigest: v.boolean(),
    }),
    createdAt: v.number(),
    updatedAt: v.number(),
    /** Optional so profiles created before Phase 5 remain valid. */
    dashboardSections: v.optional(
      v.object({
        indices: v.boolean(),
        topStocks: v.boolean(),
        watchlist: v.boolean(),
        movers: v.boolean(),
      })
    ),
  }).index("by_user", ["userId"]),

  // Watchlists owned by a user
  watchlists: defineTable({
    userId: v.id("users"),
    name: v.string(),
    description: v.string(),
    position: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_name", ["userId", "name"]),

  // Watchlist items: a watchlist contains instrument ids (denormalized owner for fast auth checks)
  watchlistItems: defineTable({
    watchlistId: v.id("watchlists"),
    userId: v.id("users"),
    instrumentId: v.string(),
    position: v.number(),
    addedAt: v.number(),
  })
    .index("by_watchlist", ["watchlistId"])
    .index("by_user", ["userId"])
    .index("by_watchlist_instrument", ["watchlistId", "instrumentId"]),

  /**
   * Instrument master. Phase 1 demo records remain valid (they are flagged
   * `isSampleData`); provider-synchronised records add the optional fields.
   */
  instruments: defineTable({
    symbol: v.string(),
    name: v.string(),
    exchange: exchangeValidator,
    instrumentType: instrumentTypeValidator,
    sector: v.string(),
    dataSource: v.string(),
    isSampleData: v.boolean(),
    lastUpdated: v.number(),
    // Phase 2 additions (optional so existing demo rows stay valid)
    instrumentId: v.optional(v.string()),
    tradingSymbol: v.optional(v.string()),
    segment: v.optional(v.string()),
    isin: v.optional(v.string()),
    tickSize: v.optional(nullableNumber),
    lotSize: v.optional(nullableNumber),
    isActive: v.optional(v.boolean()),
    providerIds: v.optional(
      v.object({
        fyers: v.optional(v.string()),
        breeze: v.optional(v.string()),
        tapetide: v.optional(v.string()),
        tejhq: v.optional(v.string()),
      })
    ),
  })
    .index("by_symbol", ["symbol"])
    .index("by_exchange", ["exchange"])
    .index("by_instrument_id", ["instrumentId"])
    .index("by_exchange_symbol", ["exchange", "symbol"])
    .index("by_exchange_symbol_type", ["exchange", "symbol", "instrumentType"])
    .searchIndex("search_symbol", {
      searchField: "symbol",
      filterFields: ["exchange", "instrumentType"],
    })
    .searchIndex("search_name", {
      searchField: "name",
      filterFields: ["exchange", "instrumentType"],
    }),

  // Latest quote per instrument, last written by a provider request (or sample).
  marketQuotes: defineTable({
    instrumentId: v.string(),
    symbol: v.string(),
    exchange: exchangeValidator,
    lastPrice: v.number(),
    change: nullableNumber,
    changePercent: nullableNumber,
    open: nullableNumber,
    high: nullableNumber,
    low: nullableNumber,
    previousClose: nullableNumber,
    volume: nullableNumber,
    bid: nullableNumber,
    ask: nullableNumber,
    quoteTime: nullableNumber,
    fetchedAt: v.number(),
    source: v.string(),
    mode: dataModeValidator,
  })
    .index("by_instrument", ["instrumentId"])
    .index("by_source", ["source"]),

  // Fundamentals snapshot (optional Tapetide provider).
  fundamentals: defineTable({
    instrumentId: v.string(),
    symbol: v.string(),
    source: v.string(),
    mode: dataModeValidator,
    fetchedAt: v.number(),
    asOf: v.union(v.string(), v.null()),
    peTtm: nullableNumber,
    marketCapCrore: nullableNumber,
    high52w: nullableNumber,
    low52w: nullableNumber,
    sections: v.array(v.object({ name: v.string(), periodCount: v.number() })),
  }).index("by_instrument", ["instrumentId"]),

  /**
   * A group of candles from one source: either a provider cache window
   * (`kind: "cache"`, expires) or a user CSV import (`kind: "import"`, owned).
   */
  candleDatasets: defineTable({
    kind: v.union(v.literal("cache"), v.literal("import")),
    name: v.string(),
    instrumentId: v.string(),
    interval: intervalValidator,
    source: v.string(),
    mode: dataModeValidator,
    adjusted: v.union(v.literal("adjusted"), v.literal("raw"), v.literal("unknown")),
    ownerId: v.optional(v.id("users")),
    rowCount: v.number(),
    firstTs: nullableNumber,
    lastTs: nullableNumber,
    expiresAt: nullableNumber,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_instrument_interval", ["instrumentId", "interval"])
    .index("by_owner", ["ownerId"])
    .index("by_kind", ["kind"]),

  candles: defineTable({
    datasetId: v.id("candleDatasets"),
    instrumentId: v.string(),
    interval: intervalValidator,
    ts: v.number(),
    open: v.number(),
    high: v.number(),
    low: v.number(),
    close: v.number(),
    volume: nullableNumber,
  })
    .index("by_dataset", ["datasetId"])
    .index("by_dataset_ts", ["datasetId", "ts"]),

  // Per-provider health, rate window and sync metadata. Never holds secrets.
  providerState: defineTable({
    providerId: v.string(),
    lastAttemptAt: nullableNumber,
    lastSuccessAt: nullableNumber,
    lastErrorAt: nullableNumber,
    lastError: v.union(v.string(), v.null()),
    lastLatencyMs: nullableNumber,
    instrumentsSyncedAt: nullableNumber,
    instrumentCount: nullableNumber,
    // IST date (YYYY-MM-DD) of the newest session a successful fetch returned.
    lastDataDate: v.optional(v.union(v.string(), v.null())),
    rateWindowStart: v.number(),
    rateWindowCount: v.number(),
    dailyWindowStart: v.number(),
    dailyCount: v.number(),
    updatedAt: v.number(),
  }).index("by_provider", ["providerId"]),

  // Exchange holidays used for session status (IST dates, YYYY-MM-DD).
  marketCalendar: defineTable({
    date: v.string(),
    description: v.string(),
  }).index("by_date", ["date"]),

  // User-owned saved screener definitions.
  savedScreeners: defineTable({
    userId: v.id("users"),
    name: v.string(),
    filtersJson: v.string(),
    lastResultCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_name", ["userId", "name"]),

  /**
   * Per-user price threshold alerts. Evaluation is on demand (see
   * `convex/alerts.ts`): there is no background scheduler or delivery channel in
   * this deployment, so an alert only changes state when the owner runs a check.
   * Every evaluation stores the exact price and freshness label it used.
   */
  priceAlerts: defineTable({
    userId: v.id("users"),
    instrumentId: v.string(),
    symbol: v.string(),
    exchange: exchangeValidator,
    direction: v.union(v.literal("ABOVE"), v.literal("BELOW")),
    threshold: v.number(),
    status: v.union(v.literal("ACTIVE"), v.literal("TRIGGERED"), v.literal("PAUSED")),
    note: v.string(),
    lastEvaluatedAt: nullableNumber,
    lastPrice: nullableNumber,
    lastMode: v.union(dataModeValidator, v.null()),
    lastSource: v.union(v.string(), v.null()),
    triggeredAt: nullableNumber,
    triggerPrice: nullableNumber,
    triggerMode: v.union(dataModeValidator, v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_status", ["userId", "status"]),

  // Per-user chart preferences for an instrument.
  chartPreferences: defineTable({
    userId: v.id("users"),
    instrumentId: v.string(),
    interval: intervalValidator,
    chartType: v.union(v.literal("candlestick"), v.literal("line"), v.literal("bar")),
    indicators: v.array(
      v.object({
        name: v.string(),
        enabled: v.boolean(),
        period: v.optional(v.number()),
        fast: v.optional(v.number()),
        slow: v.optional(v.number()),
        signal: v.optional(v.number()),
        multiplier: v.optional(v.number()),
      })
    ),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_instrument", ["userId", "instrumentId"]),

  // Metadata for user CSV imports (the candle rows live in candleDatasets/candles).
  dataImports: defineTable({
    userId: v.id("users"),
    instrumentId: v.string(),
    instrumentLabel: v.string(),
    interval: intervalValidator,
    fileName: v.string(),
    status: v.union(v.literal("completed"), v.literal("failed")),
    datasetId: v.union(v.id("candleDatasets"), v.null()),
    totalRows: v.number(),
    acceptedRows: v.number(),
    rejectedRows: v.number(),
    duplicatedRows: v.number(),
    firstTs: nullableNumber,
    lastTs: nullableNumber,
    rejectionSample: v.array(v.object({ line: v.number(), reason: v.string() })),
    error: v.union(v.string(), v.null()),
    createdAt: v.number(),
  }).index("by_user", ["userId"]),

  //
  // Per-user simulated paper trading account. Cash is only ever moved by the
  // validated order engine in `convex/paper.ts`; no client can patch a balance.
  paperAccounts: defineTable({
    userId: v.id("users"),
    startingCapital: v.number(),
    availableCash: v.number(),
    currency: v.string(),
    status: v.union(v.literal("active"), v.literal("disabled")),
    createdAt: v.number(),
    updatedAt: v.number(),
    // Phase 3 additions (optional so pre-existing accounts stay valid)
    realizedPnl: v.optional(v.number()),
    /** Set once the first order is placed; starting capital is then immutable. */
    startingCapitalLocked: v.optional(v.boolean()),
    lastOrderAt: v.optional(v.union(v.number(), v.null())),
  }).index("by_user", ["userId"]),

  //
  // Simulated orders. Rejections and cancellations are recorded too, so the
  // history explains every order without any balance movement.
  paperOrders: defineTable({
    userId: v.id("users"),
    accountId: v.id("paperAccounts"),
    instrumentId: v.string(),
    side: v.union(v.literal("BUY"), v.literal("SELL")),
    orderType: v.union(v.literal("MARKET"), v.literal("LIMIT"), v.literal("STOP_LOSS")),
    quantity: v.number(),
    price: v.optional(v.number()),
    triggerPrice: v.optional(v.number()),
    status: v.union(
      v.literal("PENDING"),
      v.literal("OPEN"),
      v.literal("FILLED"),
      v.literal("CANCELLED"),
      v.literal("REJECTED")
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    // Phase 3 additions
    /** Client-supplied idempotency key — one order per account per value. */
    clientOrderId: v.optional(v.string()),
    symbol: v.optional(v.string()),
    name: v.optional(v.string()),
    exchange: v.optional(exchangeValidator),
    instrumentType: v.optional(instrumentTypeValidator),
    limitPrice: v.optional(nullableNumber),
    filledQuantity: v.optional(v.number()),
    filledPrice: v.optional(nullableNumber),
    filledAt: v.optional(nullableNumber),
    /** Freshness label of the price actually used, stored per fill. */
    fillMode: v.optional(dataModeValidator),
    fillSource: v.optional(v.string()),
    fillQuoteTime: v.optional(nullableNumber),
    /** Cash or shares this order locks while it rests as OPEN. */
    reservedCash: v.optional(v.number()),
    reservedQuantity: v.optional(v.number()),
    rejectionReason: v.optional(v.union(v.string(), v.null())),
    cancelledAt: v.optional(nullableNumber),
  })
    .index("by_user", ["userId"])
    .index("by_account", ["accountId"])
    .index("by_account_client", ["accountId", "clientOrderId"])
    .index("by_account_status", ["accountId", "status"])
    .index("by_account_created", ["accountId", "createdAt"]),

  //
  // Current holding per account per instrument. Authoritative for quantity and
  // cost basis; rebuilt deterministically by the ledger entries below.
  paperPositions: defineTable({
    userId: v.id("users"),
    accountId: v.id("paperAccounts"),
    instrumentId: v.string(),
    symbol: v.string(),
    name: v.string(),
    exchange: exchangeValidator,
    instrumentType: instrumentTypeValidator,
    quantity: v.number(),
    costBasis: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_account_instrument", ["accountId", "instrumentId"]),

  //
  // Append-only audit trail: one entry per fill, holding the cash and position
  // movement that produced the current balances.
  paperLedger: defineTable({
    userId: v.id("users"),
    accountId: v.id("paperAccounts"),
    orderId: v.id("paperOrders"),
    instrumentId: v.string(),
    symbol: v.string(),
    kind: v.union(v.literal("BUY"), v.literal("SELL")),
    quantity: v.number(),
    price: v.number(),
    cashDelta: v.number(),
    cashAfter: v.number(),
    positionQtyAfter: v.number(),
    costBasisAfter: v.number(),
    realizedPnl: v.number(),
    mode: dataModeValidator,
    source: v.string(),
    ts: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_account_ts", ["accountId", "ts"])
    .index("by_order", ["orderId"]),

  /* ---------------------------------------------------------------- */
  /* Phase 4 — strategy builder and backtests                          */
  /* ---------------------------------------------------------------- */

  /**
   * A saved strategy. Rules are structured data, never user code, and every
   * numeric parameter is re-validated on the server before a run.
   */
  strategies: defineTable({
    userId: v.id("users"),
    name: v.string(),
    description: v.string(),
    instrumentId: v.string(),
    interval: intervalValidator,
    fromMs: v.number(),
    toMs: v.number(),
    initialCapital: v.number(),
    datasetMode: v.union(v.literal("AUTO"), v.literal("REAL_ONLY"), v.literal("SAMPLE")),
    sizing: v.object({
      kind: v.union(v.literal("FIXED_QUANTITY"), v.literal("PERCENT_OF_EQUITY")),
      quantity: nullableNumber,
      percentOfEquity: nullableNumber,
      maxPositionValuePct: v.number(),
    }),
    entry: ruleSetValidator,
    exit: ruleSetValidator,
    stopLossPct: nullableNumber,
    takeProfitPct: nullableNumber,
    costs: v.object({
      brokerageFlat: v.number(),
      brokeragePct: v.number(),
      slippageBps: v.number(),
    }),
    /** Incremented on every save; stored with each run for traceability. */
    version: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_name", ["userId", "name"])
    .index("by_user_updated", ["userId", "updatedAt"]),

  /**
   * An immutable backtest result. Everything needed to explain the numbers is
   * stored with it: dataset provenance, strategy snapshot, and engine version.
   */
  backtestRuns: defineTable({
    userId: v.id("users"),
    strategyId: v.id("strategies"),
    strategyVersion: v.number(),
    strategyName: v.string(),
    /** Frozen copy of the validated configuration used for this run. */
    configSnapshot: v.string(),
    instrumentId: v.string(),
    interval: intervalValidator,
    fromMs: v.number(),
    toMs: v.number(),
    datasetMode: v.union(v.literal("AUTO"), v.literal("REAL_ONLY"), v.literal("SAMPLE")),
    datasetKind: v.union(v.literal("sample"), v.literal("import"), v.literal("cache")),
    datasetSource: v.string(),
    datasetLabel: v.string(),
    datasetId: v.union(v.string(), v.null()),
    datasetHash: v.string(),
    datasetRowCount: v.number(),
    datasetFirstTs: nullableNumber,
    datasetLastTs: nullableNumber,
    datasetGaps: v.number(),
    dataMode: dataModeValidator,
    metrics: v.object({
      initialCapital: v.number(),
      finalEquity: v.number(),
      netPnl: v.number(),
      returnPct: v.number(),
      maxDrawdownPct: v.number(),
      tradeCount: v.number(),
      winningTrades: v.number(),
      losingTrades: v.number(),
      winRatePct: nullableNumber,
      averageWin: nullableNumber,
      averageLoss: nullableNumber,
      profitFactor: nullableNumber,
      exposurePct: v.number(),
      totalBrokerage: v.number(),
      totalSlippage: v.number(),
      totalCosts: v.number(),
    }),
    equityCurve: v.array(
      v.object({ ts: v.number(), equity: v.number(), drawdownPct: v.number() })
    ),
    priceCurve: v.array(v.object({ ts: v.number(), close: v.number() })),
    trades: v.array(
      v.object({
        entryIndex: v.number(),
        exitIndex: v.number(),
        entryTs: v.number(),
        exitTs: v.number(),
        entryPrice: v.number(),
        exitPrice: v.number(),
        quantity: v.number(),
        grossPnl: v.number(),
        costs: v.number(),
        netPnl: v.number(),
        returnPct: v.number(),
        exitReason: v.union(
          v.literal("exit_signal"),
          v.literal("stop_loss"),
          v.literal("take_profit"),
          v.literal("end_of_data")
        ),
        ambiguousExit: v.boolean(),
      })
    ),
    labels: v.array(v.string()),
    warnings: v.array(v.string()),
    truncatedTrades: v.boolean(),
    openPositionAtEnd: v.boolean(),
    candlesUsed: v.number(),
    signalsEvaluated: v.number(),
    engineVersion: v.string(),
    inputHash: v.string(),
    status: v.union(v.literal("COMPLETED"), v.literal("FAILED")),
    createdAt: v.number(),
    completedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_strategy", ["strategyId"])
    .index("by_user_created", ["userId", "createdAt"])
    .index("by_strategy_created", ["strategyId", "createdAt"]),
});
