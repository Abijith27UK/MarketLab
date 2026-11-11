import React, { useEffect, useState } from "react";
import { Input } from "@/components/ui";

interface NumberFieldProps {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * Numeric input that keeps the user's typed text while parsing on change.
 *
 * A plain controlled number input rewrites "0." to "0" mid-typing, which makes
 * decimals impossible to enter. This keeps a text draft and reports the parsed
 * value (or null when cleared), while still following an external reset.
 */
export const NumberField: React.FC<NumberFieldProps> = ({
  label,
  value,
  onChange,
  placeholder,
  disabled,
}) => {
  const [text, setText] = useState(value === null ? "" : String(value));

  useEffect(() => {
    const parsed = text.trim() === "" ? null : Number(text);
    if (parsed !== value) setText(value === null ? "" : String(value));
    // Intentionally only reacts to the incoming value: typing owns `text`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleChange = (next: string) => {
    setText(next);
    const trimmed = next.trim();
    if (trimmed === "" || trimmed === "-" || trimmed.endsWith(".")) {
      if (trimmed === "") onChange(null);
      return;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) onChange(parsed);
  };

  return (
    <Input
      label={label}
      type="text"
      placeholder={placeholder}
      value={text}
      onChange={handleChange}
      disabled={disabled}
    />
  );
};

export default NumberField;
