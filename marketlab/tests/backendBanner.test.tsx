// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import BackendBanner from "@/components/system/BackendBanner";
import type { BackendState } from "@/hooks/useBackendStatus";

afterEach(cleanup);

const state = (overrides: Partial<BackendState> = {}): BackendState => ({
  status: "offline",
  url: "http://127.0.0.1:3210",
  error: "Connection refused or host unreachable",
  attempt: 2,
  lastCheckedAt: Date.now(),
  lastOnlineAt: null,
  latencyMs: null,
  nextRetryInMs: 4_000,
  retryNow: () => {},
  ...overrides,
});

describe("BackendBanner", () => {
  it("renders nothing while the deployment is online or being checked", () => {
    const { container, unmount } = render(<BackendBanner state={state({ status: "online" })} />);
    expect(container.textContent).toBe("");
    unmount();

    const checking = render(<BackendBanner state={state({ status: "checking" })} />);
    expect(checking.container.textContent).toBe("");
  });

  it("states the failure, the retry schedule and that data is sample", () => {
    render(<BackendBanner state={state()} />);
    const banner = screen.getByTestId("backend-banner");

    expect(banner.textContent).toMatch(/Demo mode/);
    expect(banner.textContent).toMatch(/127\.0\.0\.1:3210/);
    expect(banner.textContent).toMatch(/Connection refused/);
    expect(banner.textContent).toMatch(/2 failed attempts/);
    expect(banner.textContent).toMatch(/next check in 4s/);
    expect(banner.textContent).toMatch(/labelled SAMPLE/);
    // No credential values may appear in the banner.
    expect(banner.textContent).not.toMatch(/Bearer |token=|secret=|api[_-]?key=/i);
  });

  it("lets the user re-check immediately", () => {
    const retryNow = vi.fn();
    render(<BackendBanner state={state({ retryNow })} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry now" }));
    expect(retryNow).toHaveBeenCalledTimes(1);
  });

  it("shows setup steps including the local deployment command", () => {
    render(<BackendBanner state={state()} />);
    const details = document.querySelector(".ml-backend-details");
    expect(details?.textContent).toMatch(/npx convex dev/);
  });

  it("explains the unconfigured state and disables retry", () => {
    render(<BackendBanner state={state({ status: "unconfigured", url: "", error: null })} />);
    const banner = screen.getByTestId("backend-banner");
    expect(banner.textContent).toMatch(/no backend configured/i);
    expect(
      (screen.getByRole("button", { name: "Retry now" }) as HTMLButtonElement).disabled
    ).toBe(true);
  });
});
