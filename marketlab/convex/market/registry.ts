/**
 * Provider registry.
 *
 * Selection is explicit and never silent: a provider is only used when its
 * credentials are present AND it declares the requested capability (and the
 * requested candle interval). Every payload carries the provider id that served
 * it, so the UI can label the source. Formats are never mixed: a response comes
 * from exactly one provider.
 */

import type {
  CapabilityName,
  Interval,
  MarketDataProvider,
  ProviderConfigStatus,
  ProviderEnv,
  ProviderId,
} from "./types";
import { provider as fyers } from "./providers/fyers";
import { provider as breeze } from "./providers/breeze";
import { provider as tapetide } from "./providers/tapetide";
import { provider as tejhq } from "./providers/tejhq";
import { provider as nsemcp } from "./providers/nsemcp";

/**
 * Priority order used when more than one provider is configured.
 *
 * TejHQ sits last because it is keyless and end-of-day: a configured broker
 * feed (intraday, quotes, streaming) should always win, while TejHQ remains the
 * zero-setup source for daily history and instrument masters.
 */
export const PROVIDER_PRIORITY: ProviderId[] = ["fyers", "breeze", "tapetide", "nsemcp", "tejhq"];

export const ALL_PROVIDERS: MarketDataProvider[] = [fyers, breeze, tapetide, nsemcp, tejhq];

/** Providers a user may pick as their informational quote source. */
export const SELECTABLE_QUOTE_PROVIDERS: ProviderId[] = ["tejhq", "nsemcp"];

export function getProvider(id: string): MarketDataProvider | undefined {
  return ALL_PROVIDERS.find((provider) => provider.id === id);
}

export function providerStatuses(env: ProviderEnv): ProviderConfigStatus[] {
  return PROVIDER_PRIORITY.map((id) => {
    const provider = getProvider(id) as MarketDataProvider;
    const { configured, missing } = provider.isConfigured(env);
    return {
      providerId: provider.id,
      label: provider.label,
      docsUrl: provider.docsUrl,
      authMode: provider.authMode,
      configured,
      requiredEnv: provider.requiredEnv,
      missingEnv: missing,
      capabilities: provider.capabilities,
      notes: provider.notes,
    };
  });
}

/** True when the provider declares the capability and, for candles, the interval. */
export function supports(
  provider: MarketDataProvider,
  capability: CapabilityName,
  interval?: Interval
): boolean {
  const descriptor = provider.capabilities[capability];
  if (!descriptor?.supported) return false;
  if (capability === "candles" && interval) {
    return (descriptor.intervals ?? []).includes(interval);
  }
  return true;
}

/**
 * Picks the provider that will serve a request.
 * Returns `null` when nothing is configured — callers then fall back to the
 * clearly labelled sample catalogue rather than inventing provider data.
 */
export function providerFor(
  env: ProviderEnv,
  capability: CapabilityName,
  interval?: Interval,
  preferred?: ProviderId | null
): MarketDataProvider | null {
  const ordered = preferred
    ? [
        getProvider(preferred) as MarketDataProvider | undefined,
        ...PROVIDER_PRIORITY.filter((id) => id !== preferred).map(
          (id) => getProvider(id) as MarketDataProvider
        ),
      ].filter((value): value is MarketDataProvider => Boolean(value))
    : PROVIDER_PRIORITY.map((id) => getProvider(id) as MarketDataProvider);

  for (const provider of ordered) {
    if (!provider) continue;
    // The experimental NSE history feed is opt-in only: an unqualified candle
    // request keeps using the established default so backtests and existing
    // charts are never silently moved onto the experiment.
    if (!preferred && capability === "candles" && provider.id === "nsemcp") continue;
    if (!provider.isConfigured(env).configured) continue;
    if (!supports(provider, capability, interval)) continue;
    return provider;
  }
  return null;
}

/** Providers that can serve candles for a given interval. */
export function providersForInterval(env: ProviderEnv, interval: Interval): ProviderId[] {
  return PROVIDER_PRIORITY.filter((id) => {
    const provider = getProvider(id) as MarketDataProvider;
    return provider.isConfigured(env).configured && supports(provider, "candles", interval);
  });
}

/** Union of intervals any configured provider can serve. */
export function availableIntervals(env: ProviderEnv): Interval[] {
  const intervals = new Set<Interval>();
  for (const provider of ALL_PROVIDERS) {
    if (!provider.isConfigured(env).configured) continue;
    for (const interval of provider.capabilities.candles.intervals ?? []) {
      intervals.add(interval);
    }
  }
  return [...intervals];
}
