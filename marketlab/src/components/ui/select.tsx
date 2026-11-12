import React, { useCallback, useEffect, useId, useRef, useState } from "react";

interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  options: SelectOption[];
  value?: string;
  onSelect?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Optional accessible label. */
  label?: string;
  hint?: string;
}

/**
 * Controlled select.
 *
 * Displays the option *label* for the current value (not the raw value) and
 * follows the `value` prop so a parent can reset or preselect it. Keyboard:
 * Enter/Space/ArrowDown opens, arrows move, Enter selects, Escape closes.
 */
export const Select = ({
  options,
  value,
  onSelect,
  placeholder = "Select...",
  disabled = false,
  className = "",
  label,
  hint,
}: SelectProps) => {
  const selectedValue = value ?? "";
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const generatedId = useId();
  const listboxId = `ml-select-${generatedId}`;

  const current = options.find((option) => option.value === selectedValue);

  useEffect(() => {
    if (!isOpen) return;
    const handleDocumentClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handleDocumentClick);
    return () => document.removeEventListener("mousedown", handleDocumentClick);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) setActiveIndex(-1);
  }, [isOpen]);

  const handleSelect = useCallback(
    (option: SelectOption) => {
      setIsOpen(false);
      onSelect?.(option.value);
    },
    [onSelect]
  );

  const move = (delta: 1 | -1) => {
    if (options.length === 0) return;
    const start = activeIndex < 0 ? (delta === 1 ? -1 : 0) : activeIndex;
    const next = (start + delta + options.length) % options.length;
    setActiveIndex(next);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!isOpen) setIsOpen(true);
      else move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) setIsOpen(true);
      else move(-1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      const option = options[activeIndex] ?? options[0];
      if (option) handleSelect(option);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
    }
  };

  return (
    <div className="ml-field">
      {label && (
        <label className="ml-field__label" htmlFor={`${listboxId}-trigger`}>
          {label}
        </label>
      )}
      <div className="ml-select" ref={containerRef}>
        <button
          id={`${listboxId}-trigger`}
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          onKeyDown={onKeyDown}
          disabled={disabled || options.length === 0}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-controls={isOpen ? listboxId : undefined}
          className={["ml-select__trigger", className].filter(Boolean).join(" ")}
        >
          <span className="ml-select__value">{current?.label ?? placeholder}</span>
          <span className={`ml-select__chevron${isOpen ? " is-open" : ""}`} aria-hidden="true">
            ▾
          </span>
        </button>

        {isOpen && !disabled && (
          <div id={listboxId} role="listbox" className="ml-select__menu">
            {options.map((option, index) => (
              <div
                key={option.value}
                role="option"
                aria-selected={selectedValue === option.value}
                tabIndex={-1}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => handleSelect(option)}
                className={`ml-select__option${index === activeIndex ? " is-active" : ""}`}
              >
                {option.label}
              </div>
            ))}
          </div>
        )}
      </div>
      {hint && <p className="ml-field__hint">{hint}</p>}
    </div>
  );
};

export default Select;
