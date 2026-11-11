import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import App from "./App";
import { describeTarget, hasConvexUrl, convexUrl } from "@/lib/backend";
import { useBackendStatus } from "@/hooks/useBackendStatus";
import "./styles/globals.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

/** Shown only while the very first probe is in flight (normally a few ms). */
const ConnectingScreen: React.FC<{ target: string }> = ({ target }) => (
  <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
    <div className="ml-brand flex items-center gap-2">
      <span className="ml-brand-mark">◆</span>
      <span className="ml-brand-name">MarketLab</span>
    </div>
    <p className="text-sm text-gray-400" role="status" aria-live="polite">
      Connecting to the Convex backend at <span className="ml-mono">{target}</span>…
    </p>
    <div className="skeleton h-1.5 w-48 rounded-full" />
  </div>
);

/**
 * Owns the Convex client lifecycle.
 *
 * A `ConvexReactClient` is created ONLY once the deployment answers an HTTP
 * health probe, and is closed as soon as that probe fails. That is what stops
 * `ws://…/sync` from retrying forever against a backend that is not running.
 */
const Root: React.FC = () => {
  const backend = useBackendStatus();
  const [client, setClient] = useState<ConvexReactClient | null>(null);

  useEffect(() => {
    if (backend.status !== "online" || !convexUrl) return;
    const created = new ConvexReactClient(convexUrl);
    setClient(created);
    return () => {
      created.close();
      setClient(null);
    };
  }, [backend.status]);

  const target = useMemo(() => describeTarget(backend.url), [backend.url]);

  if (!hasConvexUrl) {
    return (
      <Shell>
        <App backend={{ ...backend, status: "unconfigured" }} />
      </Shell>
    );
  }

  if (backend.status === "checking") {
    return (
      <Shell>
        <ConnectingScreen target={target} />
      </Shell>
    );
  }

  if (backend.status === "online") {
    // The client is created in an effect, so there is one render where the probe
    // has succeeded but no client exists yet. Rendering `App` there would mount
    // `RootProvider` without a `ConvexAuthProvider` above it, and every Convex
    // auth hook in it would return undefined.
    if (!client) {
      return (
        <Shell>
          <ConnectingScreen target={target} />
        </Shell>
      );
    }
    return (
      <Shell>
        <ConvexAuthProvider client={client}>
          <App backend={backend} />
        </ConvexAuthProvider>
      </Shell>
    );
  }

  // Offline / unconfigured: the app renders on sample data and calls no Convex hooks.
  return (
    <Shell>
      <App backend={backend} />
    </Shell>
  );
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
