import React from "react";

export interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Badges or status line shown beneath the description. */
  meta?: React.ReactNode;
  /** Primary and secondary actions, right-aligned on wide viewports. */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Shared page header: title, supporting description, optional status meta and
 * actions. Used by every page so headings, spacing and action placement match.
 */
export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  description,
  meta,
  actions,
  className,
}) => (
  <header className={["ml-page-header", className].filter(Boolean).join(" ")}>
    <div className="ml-page-header__main">
      <h1 className="ml-page-title">{title}</h1>
      {description ? <p className="ml-page-sub">{description}</p> : null}
      {meta ? <div className="ml-page-header__meta">{meta}</div> : null}
    </div>
    {actions ? <div className="ml-page-header__actions">{actions}</div> : null}
  </header>
);

export default PageHeader;
