import React, { useEffect, useId, useState } from "react";

export interface InputProps {
  type?: string;
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  disabled?: boolean;
  label?: string;
  /** Supporting text shown under the field when there is no error. */
  hint?: string;
  /** Validation message; also marks the field invalid for assistive tech. */
  error?: string | null;
  className?: string;
}

/**
 * Text/number input.
 *
 * Editable locally (so typing never depends on a parent round-trip) but it
 * follows the `value` prop when the parent changes it — otherwise a parent that
 * clears or preselects a value would silently keep showing the stale text.
 */
export const Input = ({
  type = "text",
  placeholder,
  value,
  onChange,
  onSubmit,
  disabled = false,
  label,
  hint,
  error,
  className = "",
}: InputProps) => {
  const generatedId = useId();
  const inputId = `ml-input-${generatedId}`;
  const [inputValue, setInputValue] = useState(value ?? "");

  useEffect(() => {
    if (value !== undefined) setInputValue(value);
  }, [value]);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(event.target.value);
    onChange?.(event.target.value);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") onSubmit?.(inputValue);
  };

  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className="ml-field">
      {label && (
        <label className="ml-field__label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <input
        id={inputId}
        type={type}
        placeholder={placeholder}
        value={inputValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={["ml-input", className].filter(Boolean).join(" ")}
      />
      {error ? (
        <p id={`${inputId}-error`} className="ml-field__error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="ml-field__hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
};

export default Input;
