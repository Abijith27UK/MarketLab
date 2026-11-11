import React from "react";
import { useRootContext } from "@/context/RootContext";
import { Card, Button } from "@/components/ui";

interface BackendRequiredProps {
  feature: string;
  /** What the feature stores, stated plainly so nothing looks broken silently. */
  description: string;
}

/**
 * Shown in place of a Convex-backed feature while the deployment is unreachable.
 * No placeholder data is fabricated: the panel says what is unavailable, why,
 * and what to do.
 */
export const BackendRequired: React.FC<BackendRequiredProps> = ({ feature, description }) => {
  const { retryBackend } = useRootContext();

  return (
    <div className="p-4 md:p-6">
      <h1 className="ml-page-title">{feature}</h1>
      <p className="ml-page-sub">{description}</p>

      <Card className="mt-5" >
        <h2 className="text-lg font-semibold">Backend unavailable</h2>
        <p className="mt-2 text-sm text-gray-400">
          {feature} reads and writes your own records in Convex, so it stays empty until the
          deployment answers. Nothing is simulated here and no request was retried in a loop — the
          app checks the deployment on a bounded backoff and resumes automatically.
        </p>
        <ul className="ml-paused-list">
          <li>Your existing data is untouched.</li>
          <li>Market overview, stock cards and charts keep working in sample mode.</li>
          <li>Sign-in is disabled while the backend is unreachable.</li>
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" onClick={retryBackend}>
            Check connection now
          </Button>
        </div>
      </Card>
    </div>
  );
};

interface InvalidInstrumentProps {
  instrumentId: string;
  onBack: () => void;
}

/** Rejects malformed or unknown instrument ids instead of querying with them. */
export const InvalidInstrument: React.FC<InvalidInstrumentProps> = ({ instrumentId, onBack }) => (
  <div className="p-4 md:p-6">
    <button className="mb-3 text-xs text-gray-400 hover:text-white" onClick={onBack}>
      ← Back
    </button>
    <Card>
      <h1 className="text-xl font-semibold">Unknown instrument</h1>
      <p className="mt-2 text-sm text-gray-400">
        <span className="ml-mono">{instrumentId.slice(0, 96)}</span> is not a valid instrument id.
        Expected the form <span className="ml-mono">EXCHANGE:SYMBOL:TYPE</span>, for example{" "}
        <span className="ml-mono">NSE:RELIANCE:EQUITY</span>.
      </p>
      <Button variant="secondary" className="mt-4" onClick={onBack}>
        Back to overview
      </Button>
    </Card>
  </div>
);

export default BackendRequired;
