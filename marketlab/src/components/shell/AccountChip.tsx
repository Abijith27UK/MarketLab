import React from "react";
import { LogIn } from "lucide-react";
import { useRootContext } from "@/context/RootContext";

export interface AccountChipProps {
  variant: "topbar" | "sidebar";
  onOpenProfile: () => void;
  onSignIn: () => void;
}

const initialsOf = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
};

/**
 * Account affordance shared by the top bar and the sidebar footer.
 *
 * Only real values are rendered: the signed-in name/email come from the Convex
 * profile, and with no backend the chip states the demo limitation instead of
 * inventing a user.
 */
export const AccountChip: React.FC<AccountChipProps> = ({
  variant,
  onOpenProfile,
  onSignIn,
}) => {
  const { user, isAuthenticated, backendOnline } = useRootContext();

  if (!backendOnline) {
    if (variant === "topbar") {
      return (
        <span className="ml-status" data-tone="sample" title="No backend configured">
          <span className="ml-status-dot" aria-hidden="true" />
          <span className="ml-status-text">Demo</span>
        </span>
      );
    }
    return (
      <div className="ml-account ml-account--static">
        <span className="ml-account-avatar" aria-hidden="true">
          ◇
        </span>
        <span className="ml-account-text">
          <span className="ml-account-name">Demo mode</span>
          <span className="ml-account-meta">Backend offline</span>
        </span>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    if (variant === "topbar") {
      return (
        <button
          type="button"
          className="ml-btn ml-btn--secondary ml-btn--sm ml-signin-btn"
          onClick={onSignIn}
        >
          <LogIn size={14} aria-hidden="true" />
          Sign in
        </button>
      );
    }
    return (
      <button
        type="button"
        className="ml-account"
        onClick={onSignIn}
        aria-label="Sign in or create an account"
      >
        <span className="ml-account-avatar" aria-hidden="true">
          <LogIn size={14} />
        </span>
        <span className="ml-account-text">
          <span className="ml-account-name">Sign in</span>
          <span className="ml-account-meta">Sync watchlists &amp; paper account</span>
        </span>
      </button>
    );
  }

  const name = user.name?.trim() || "Account";
  const meta = user.email ?? "Signed in";

  if (variant === "topbar") {
    return (
      <button
        type="button"
        className="ml-account ml-account--compact"
        onClick={onOpenProfile}
        aria-label={`Open profile for ${name}`}
        title={name}
      >
        <span className="ml-account-avatar" aria-hidden="true">
          {initialsOf(name)}
        </span>
      </button>
    );
  }

  return (
    <button type="button" className="ml-account" onClick={onOpenProfile} title={name}>
      <span className="ml-account-avatar" aria-hidden="true">
        {initialsOf(name)}
      </span>
      <span className="ml-account-text">
        <span className="ml-account-name">{name}</span>
        <span className="ml-account-meta">{meta}</span>
      </span>
    </button>
  );
};

export default AccountChip;
