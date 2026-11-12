import React from "react";
import { Menu } from "lucide-react";

export interface TopBarProps {
  /** Current page or context label. */
  title: string;
  /** Secondary context line (page purpose or instrument id). */
  subtitle?: string;
  onOpenMenu: () => void;
  /** Whether the mobile navigation drawer is currently open. */
  menuExpanded?: boolean;
  /** Search trigger slot — the palette itself is owned by GlobalSearch. */
  search: React.ReactNode;
  /** Session / data-freshness slot. */
  status: React.ReactNode;
  /** Account controls slot. */
  account: React.ReactNode;
}

/**
 * Sticky application top bar: page context, global search, data freshness and
 * account controls. Renders no data of its own.
 */
export const TopBar: React.FC<TopBarProps> = ({
  title,
  subtitle,
  onOpenMenu,
  menuExpanded = false,
  search,
  status,
  account,
}) => (
  <header className="ml-topbar" role="banner">
    <div className="ml-topbar-start">
      <button
        type="button"
        className="ml-menu-button"
        onClick={onOpenMenu}
        aria-label="Open navigation"
        aria-expanded={menuExpanded}
        aria-controls="app-sidebar"
        data-testid="menu-button"
      >
        <Menu size={18} aria-hidden="true" />
      </button>
      <div className="ml-topbar-context">
        <span className="ml-topbar-title">{title}</span>
        {subtitle ? <span className="ml-topbar-sub">{subtitle}</span> : null}
      </div>
    </div>

    <div className="ml-topbar-center">{search}</div>

    <div className="ml-topbar-end">
      {status}
      {account}
    </div>
  </header>
);

export default TopBar;
