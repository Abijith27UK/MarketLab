import React from "react";

export interface SectionHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Buttons/meta aligned to the right of the heading. */
  actions?: React.ReactNode;
  /** Alias kept for call sites that pass `right`. */
  right?: React.ReactNode;
  className?: string;
}

/** Heading + optional description + optional trailing actions. */
export const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  description,
  actions,
  right,
  className = "",
}) => {
  const side = actions ?? right;
  return (
    <div className={["ml-section-head", className].filter(Boolean).join(" ")}>
      <div className="ml-section-head__text">
        <h2 className="ml-section-title">{title}</h2>
        {description ? <p className="ml-section-sub">{description}</p> : null}
      </div>
      {side ? <div className="ml-section-head__actions">{side}</div> : null}
    </div>
  );
};

export default SectionHeader;
