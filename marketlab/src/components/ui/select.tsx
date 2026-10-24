import React, { useState } from "react";

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
}

export const Select = ({ 
  options, 
  value, 
  onSelect, 
  placeholder = "Select...", 
  disabled = false, 
  className = "" 
}: SelectProps) => {
  const [selectedValue, setSelectedValue] = useState(value || options[0]?.value);
  const [isOpen, setIsOpen] = useState(false);

  const handleSelect = (option: SelectOption) => {
    setSelectedValue(option.value);
    setIsOpen(false);
    onSelect?.(option.value);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        className={`
          w-full rounded-md border border-gray-700 bg-gray-900/50 px-3 py-2 text-sm 
          text-white placeholder-gray-500 focus:outline-none focus:ring-2 
          focus:ring-green-500 focus:border-green-500 ${className}
        `}
      >
        {selectedValue || placeholder}
      </button>

      {isOpen && !disabled && (
        <div 
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 mt-2 w-48 bg-gray-800 rounded-md border border-gray-700 p-2 shadow-lg z-10"
        >
          {options.map((option) => (
            <div
              key={option.value}
              onClick={() => handleSelect(option)}
              className={`
                padding-2 rounded hover:bg-gray-700 cursor-pointer 
                transition-colors text-sm ${selectedValue === option.value ? "font-medium text-green-400" : "text-white"}
              `}
            >
              {option.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};