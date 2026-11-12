import React from "react";

export type SkeletonVariant = "line" | "block" | "card" | "row";

export interface SkeletonProps {
  variant?: SkeletonVariant;
  /** Number of stacked placeholders. */
  count?: number;
  width?: string | number;
  height?: string | number;
  className?: string;
}

/** Shimmering placeholder. Hidden from assistive tech by design. */
export const Skeleton: React.FC<SkeletonProps> = ({
  variant = "line",
  count = 1,
  width,
  height,
  className = "",
}) => (
  <div aria-hidden="true" className="flex flex-col gap-2">
    {Array.from({ length: count }).map((_, index) => (
      <div
        key={index}
        className={["skeleton", `ml-skeleton--${variant}`, className].filter(Boolean).join(" ")}
        style={{ width, height }}
      />
    ))}
  </div>
);

export default Skeleton;
