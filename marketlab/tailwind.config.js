/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  // `Grid` builds its class name dynamically, so the column counts are safelisted.
  safelist: [{ pattern: /grid-cols-(1|2|3|4|5|6)/ }],
  theme: {
    extend: {
      colors: {
        surface: "#12121a",
        elevated: "#1a1a24",
        border: "#2a2a3a",
        accent: "#00d4aa",
      },
    },
  },
  plugins: [],
};
