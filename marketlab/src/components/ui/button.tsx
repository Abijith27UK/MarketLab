import React from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretch to the width of the container. */
  fullWidth?: boolean;
  className?: string;
  children: React.ReactNode;
}

/**
 * Primary action control.
 *
 * Presentation lives in `.ml-btn*` (styles/globals.css) so the palette is
 * declared once. The native `type` is left to the caller: inside a <form> the
 * default submit behaviour is what makes the auth form work.
 */
export const Button: React.FC<ButtonProps> = ({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className = "",
  children,
  ...rest
}) => (
  <button
    className={[
      "ml-btn",
      `ml-btn--${variant}`,
      `ml-btn--${size}`,
      fullWidth ? "ml-btn--full" : "",
      className,
    ]
      .filter(Boolean)
      .join(" ")}
    {...rest}
  >
    {children}
  </button>
);

export default Button;
