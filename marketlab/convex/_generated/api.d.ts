/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as alerts from "../alerts.js";
import type * as alertsCore from "../alertsCore.js";
import type * as auth from "../auth.js";
import type * as backtestCore_config from "../backtestCore/config.js";
import type * as backtestCore_engine from "../backtestCore/engine.js";
import type * as backtestCore_types from "../backtestCore/types.js";
import type * as backtestCore_validation from "../backtestCore/validation.js";
import type * as backtests from "../backtests.js";
import type * as chartPreferences from "../chartPreferences.js";
import type * as http from "../http.js";
import type * as instruments from "../instruments.js";
import type * as market_csv from "../market/csv.js";
import type * as market_fallback from "../market/fallback.js";
import type * as market_hash from "../market/hash.js";
import type * as market_http from "../market/http.js";
import type * as market_indicators from "../market/indicators.js";
import type * as market_normalize from "../market/normalize.js";
import type * as market_provenance from "../market/provenance.js";
import type * as market_providers_breeze from "../market/providers/breeze.js";
import type * as market_providers_fyers from "../market/providers/fyers.js";
import type * as market_providers_tapetide from "../market/providers/tapetide.js";
import type * as market_providers_tejhq from "../market/providers/tejhq.js";
import type * as market_rateLimit from "../market/rateLimit.js";
import type * as market_registry from "../market/registry.js";
import type * as market_sample from "../market/sample.js";
import type * as market_time from "../market/time.js";
import type * as market_types from "../market/types.js";
import type * as marketData from "../marketData.js";
import type * as marketStore from "../marketStore.js";
import type * as paper from "../paper.js";
import type * as paperAccounts from "../paperAccounts.js";
import type * as paperCore_config from "../paperCore/config.js";
import type * as paperCore_engine from "../paperCore/engine.js";
import type * as screener from "../screener.js";
import type * as strategies from "../strategies.js";
import type * as users from "../users.js";
import type * as watchlists from "../watchlists.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  alerts: typeof alerts;
  alertsCore: typeof alertsCore;
  auth: typeof auth;
  "backtestCore/config": typeof backtestCore_config;
  "backtestCore/engine": typeof backtestCore_engine;
  "backtestCore/types": typeof backtestCore_types;
  "backtestCore/validation": typeof backtestCore_validation;
  backtests: typeof backtests;
  chartPreferences: typeof chartPreferences;
  http: typeof http;
  instruments: typeof instruments;
  "market/csv": typeof market_csv;
  "market/fallback": typeof market_fallback;
  "market/hash": typeof market_hash;
  "market/http": typeof market_http;
  "market/indicators": typeof market_indicators;
  "market/normalize": typeof market_normalize;
  "market/provenance": typeof market_provenance;
  "market/providers/breeze": typeof market_providers_breeze;
  "market/providers/fyers": typeof market_providers_fyers;
  "market/providers/tapetide": typeof market_providers_tapetide;
  "market/providers/tejhq": typeof market_providers_tejhq;
  "market/rateLimit": typeof market_rateLimit;
  "market/registry": typeof market_registry;
  "market/sample": typeof market_sample;
  "market/time": typeof market_time;
  "market/types": typeof market_types;
  marketData: typeof marketData;
  marketStore: typeof marketStore;
  paper: typeof paper;
  paperAccounts: typeof paperAccounts;
  "paperCore/config": typeof paperCore_config;
  "paperCore/engine": typeof paperCore_engine;
  screener: typeof screener;
  strategies: typeof strategies;
  users: typeof users;
  watchlists: typeof watchlists;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
