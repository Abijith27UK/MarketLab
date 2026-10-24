import React from "react";

interface TypographyProps {
  variant?: "h1" | "h2" | "h3" | "h4" | "body1" | "body2" | "caption" | "overline";
  children: React.ReactNode;
  className?: string;
  color?: "default" | "primary" | "secondary" | "success" | "error" | "warning";
}

const variantStyles = {
  h1: "text-4xl font-bold",
  h2: "text-3xl font-bold",
  h3: "text-2xl font-semibold",
  h4: "text-xl font-semibold",
  body1: "text-base",
  body2: "text-sm",
  caption: "text-xs",
  overline: "text-xs uppercase tracking-wide",
};

const colorStyles = {
  default: "",
  primary: "text-blue-600",
  secondary: "text-gray-600",
  success: "text-green-600",
  error: "text-red-600",
  warning: "text-yellow-600",
};

export const Typography: React.FC<TypographyProps> = ({
  variant = "body1",
  children,
  className = "",
  color = "default",
}) => {
  const Tag = variant.startsWith("h") ? (variant as any) : "p";
  return (
    <Tag className={`${variantStyles[variant]} ${colorStyles[color]} ${className}`}>
      {children}
    </Tag>
  );
};
