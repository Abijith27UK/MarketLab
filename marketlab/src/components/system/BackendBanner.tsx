import React from "react";
import { backendSetupSteps, describeTarget, isLoopbackDeployment } from "@/lib/backend";
import type { BackendState } from "@/hooks/useBackendStatus";

interface BackendBannerProps {
  state: BackendState;
}

/**
 * Persistent, honest status strip while the Convex deployment is unreachable.
 * It replaces the old behaviour of a blank page plus an endless socket retry.
 */
export const BackendBanner: React.FC<BackendBannerProps> = ({ state }) => {
  if (state.status === "online" || state.status === "checking") return null;

  const unconfigured = state.status === "unconfigured";
  const target = state.url ? describeTarget(state.url) : "no deployment configured";
  const loopback = isLoopbackDeployment(state.url);
  const seconds = state.nextRetryInMs ? Math.ceil(state.nextRetryInMs / 1000) : null;
  const steps = backendSetupSteps(state.url);

  return (
    <section className="ml-backend-banner" role="status" aria-live="polite" data-testid="backend-banner">
      <div className="ml-backend-banner-head">
        <span className="ml-backend-dot" aria-hidden="true" />
        <div>
          <p className="ml-backend-title">
            {unconfigured
              ? "Demo mode — no backend configured"
              : `Demo mode — backend unreachable (${target})`}
          </p>
          <p className="ml-backend-sub">
            {unconfigured
              ? "Profiles, watchlists and paper accounts need a Convex deployment."
              : state.error ?? "Waiting for the deployment to answer"}
            {state.attempt > 0 ? ` · ${state.attempt} failed attempt${state.attempt === 1 ? "" : "s"}` : ""}
            {seconds !== null ? ` · next check in ${seconds}s` : ""}
          </p>
        </div>
        <button
          type="button"
          className="ml-backend-retry"
          onClick={state.retryNow}
          disabled={unconfigured}
        >
          Retry now
        </button>
      </div>

      <p className="ml-backend-note">
        Every price, index value and chart in this session is <strong>labelled SAMPLE</strong> —
        deterministic demo data, not Indian market data. Nothing here is live, and no order was
        placed.
      </p>

      <details className="ml-backend-details">
        <summary>How to connect the backend{loopback ? " (local deployment)" : ""}</summary>
        <ol>
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </details>
    </section>
  );
};

export default BackendBanner;
