import React, { useEffect, useRef, useState } from "react";


interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  options: SelectOption[];
  value?: string;
  onSelect?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Optional accessible label. */
  label?: string;
}

/**
 * Controlled select.
 *
 * Displays the option *label* for the current value (not the raw value) and
 * follows the `value` prop so a parent can reset or preselect it.
 */
export const Select = ({
  options,
  value,
  onSelect,
  placeholder = "Select...",
  disabled = false,
  className = "",
  label,
}: SelectProps) => {
  // Fully controlled: the displayed option comes straight from the `value` prop.
  // Keeping a second copy in state let the two drift apart whenever the parent
  // changed its selection or the option list was rebuilt.
  const selectedValue = value ?? "";
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleDocumentClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handleDocumentClick);
    return () => document.removeEventListener("mousedown", handleDocumentClick);
  }, [isOpen]);

  const current = options.find((option) => option.value === selectedValue);

  const handleSelect = (option: SelectOption) => {
    setIsOpen(false);
    onSelect?.(option.value);
  };

  return (
    <div className="relative" ref={containerRef}>
      {label && <label className="text-sm text-gray-400 block mb-1">{label}</label>}
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        disabled={disabled || options.length === 0}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`
          w-full rounded-md border border-gray-700 bg-gray-900/50 px-3 py-2 text-sm text-left
          text-white placeholder-gray-500 focus:outline-none focus:ring-2
          focus:ring-green-500 focus:border-green-500 disabled:opacity-60 ${className}
        `}
      >
        {current?.label ?? placeholder}
      </button>

      {isOpen && !disabled && (
        <div
          role="listbox"
          className="absolute right-0 z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-gray-700 bg-gray-800 p-1 shadow-lg"
        >
          {options.map((option) => (
            <div
              key={option.value}
              role="option"
              aria-selected={selectedValue === option.value}
              tabIndex={0}
              onClick={() => handleSelect(option)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") handleSelect(option);
              }}
              className={`cursor-pointer rounded px-2 py-1.5 text-sm transition-colors hover:bg-gray-700 ${
                selectedValue === option.value ? "font-medium text-green-400" : "text-white"
              }`}
            >
              {option.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
