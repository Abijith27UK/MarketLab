import React from "react";

interface GridProps {
  cols?: number;
  gap?: string;
  className?: string;
  children: React.ReactNode;
}

export const Grid = ({ cols = 2, gap = "4", className = "", children }: GridProps) => {
  return (
    <div className={`
      grid grid-cols-${cols} gap-${gap} ${className}
    `}>
      {children}
    </div>
  );
};