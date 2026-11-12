import React from "react";

export interface EmptyStateProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Optional leading glyph (an icon element). */
  icon?: React.ReactNode;
  /** Optional call to action, usually a Button. */
  action?: React.ReactNode;
  className?: string;
}

/** Consistent "nothing here yet" panel. */
export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  icon,
  action,
  className = "",
}) => (
  <div className={["ml-empty-state", className].filter(Boolean).join(" ")}>
    {icon ? (
      <span className="ml-empty-state__icon" aria-hidden="true">
        {icon}
      </span>
    ) : null}
    <p className="ml-empty-state__title">{title}</p>
    {description ? <p className="ml-empty-state__body">{description}</p> : null}
    {action ? <div className="ml-empty-state__action">{action}</div> : null}
  </div>
);

export default EmptyState;
