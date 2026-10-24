import React from "react";

type ButtonVariant = "primary" | "secondary" | "danger";

interface ButtonProps {
  variant?: ButtonVariant;
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md" | "lg";
}

export const Button = ({ 
  variant = "primary", 
  children, 
  onClick, 
  disabled = false, 
  className = "", 
  size = "md" 
}: ButtonProps) => {
  const variantStyles = {
    primary: "bg-gradient-to-r from-green-600 to-emerald-500 text-white hover:opacity-90",
    secondary: "bg-gray-800 text-white hover:opacity-90",
    danger: "bg-red-600 text-white hover:opacity-90",
  };

  const sizeStyles = {
    sm: "h-8 px-3 text-sm",
    md: "h-10 px-4 text-base",
    lg: "h-12 px-6 text-lg",
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors 
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-green-400 
        ${variantStyles[variant]}
        ${sizeStyles[size]}
        ${className}
      `}
    >
      {children}
    </button>
  );
};