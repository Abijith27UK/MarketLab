// @vitest-environment jsdom
/**
 * Regression test for the remount defect found against the live backend.
 *
 * `App` used to wrap its pages in a provider component defined inside its own
 * render body. That wrapper got a new component identity on every `App` render,
 * so React unmounted and remounted the whole page subtree — clearing dropdown
 * selections and form input whenever the backend status object changed.
 *
 * The check is behavioural: native DOM state inside the tree (`<details open>`)
 * must survive a re-render of `App`.
 */
import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import App from "@/App";
import type { BackendState } from "@/hooks/useBackendStatus";

afterEach(cleanup);

/** Offline by default so no Convex hooks or network calls run. */
const offlineState = (overrides: Partial<BackendState> = {}): BackendState => ({
  status: "offline",
  url: "http://127.0.0.1:3210",
  error: "Connection refused or host unreachable",
  attempt: 1,
  lastCheckedAt: Date.now(),
  lastOnlineAt: null,
  latencyMs: null,
  nextRetryInMs: 4000,
  retryNow: vi.fn(),
  ...overrides,
});

const setupDetails = () => document.querySelector("details");

describe("App keeps page state across re-renders", () => {
  it("does not remount the page tree when the backend state object changes", () => {
    const { rerender } = render(<App backend={offlineState()} />);

    const details = setupDetails();
    expect(details).not.toBeNull();
    details!.open = true;

    // A new status object with a different attempt count: exactly what the health
    // hook produces on each probe.
    rerender(<App backend={offlineState({ attempt: 2, nextRetryInMs: 8000 })} />);

    const after = setupDetails();
    expect(after).not.toBeNull();
    expect(after!.open).toBe(true);
    // Same DOM node, not a replacement.
    expect(after).toBe(details);
  });

  it("keeps local page state when App re-renders", () => {
    const StatefulPanel: React.FC = () => {
      const [count, setCount] = useState(0);
      return (
        <button type="button" onClick={() => setCount((value) => value + 1)}>
          clicks {count}
        </button>
      );
    };

    const Harness: React.FC<{ tick: number }> = ({ tick }) => (
      <div data-tick={tick}>
        <StatefulPanel />
      </div>
    );

    const { rerender } = render(<Harness tick={0} />);
    fireEvent.click(document.querySelector("button")!);
    expect(document.querySelector("button")!.textContent).toBe("clicks 1");

    // Sanity check that a re-render of the parent alone preserves the child's
    // state — the invariant `App` now relies on.
    rerender(<Harness tick={1} />);
    expect(document.querySelector("button")!.textContent).toBe("clicks 1");
  });
});
