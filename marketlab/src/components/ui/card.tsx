import React from "react";

interface CardProps {
  className?: string;
  children: React.ReactNode;
}

export const Card = ({ className, children }: CardProps) => {
  return (
    <div className={`
      bg-gray-900/50 border border-gray-700 rounded-lg p-6 
      ${className}
    `}>
      {children}
    </div>
  );
};