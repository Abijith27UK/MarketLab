import React, { useState } from "react";

interface InputProps {
  type?: string;
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}

export const Input = ({ 
  type = "text", 
  placeholder, 
  value, 
  onChange, 
  onSubmit, 
  disabled = false, 
  label, 
  className = "" 
}: InputProps) => {
  const [inputValue, setInputValue] = useState(value || "");

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    onChange?.(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      onSubmit?.(inputValue);
    }
  };

  return (
    <div className="space-y-2">
      {label && (
        <label className="text-sm text-gray-400 block mb-1">{label}</label>
      )}
      <input
        type={type}
        placeholder={placeholder}
        value={inputValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        className={`
          w-full rounded-md border border-gray-700 bg-gray-900/50 px-3 py-2 text-sm 
          text-white placeholder-gray-500 focus:outline-none focus:ring-2 
          focus:ring-green-500 focus:border-green-500 ${className}
        `}
      />
    </div>
  );
};