/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  // The product is dark-first; `class` lets a future light theme opt in
  // explicitly without changing the default rendering.
  darkMode: "class",
  // `Grid`-style helpers build class names dynamically, so column counts are
  // safelisted. Component styles themselves live in globals.css (plain CSS),
  // which is never purged — only generated utilities need this list.
  safelist: [{ pattern: /grid-cols-(1|2|3|4|5|6|12)/ }],
  theme: {
    extend: {
      colors: {
        // Surfaces
        bg: "var(--bg)",
        sidebar: "var(--sidebar)",
        card: "var(--card)",
        elevated: "var(--elevated)",
        // Borders
        hairline: "var(--border)",
        "hairline-strong": "var(--border-strong)",
        // Text
        ink: {
          DEFAULT: "var(--text)",
          muted: "var(--text-2)",
          faint: "var(--text-3)",
        },
        // Semantic
        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
          soft: "var(--accent-soft)",
        },
        pos: { DEFAULT: "var(--pos)", soft: "var(--pos-soft)" },
        neg: { DEFAULT: "var(--neg)", soft: "var(--neg-soft)" },
        warn: { DEFAULT: "var(--warn)", soft: "var(--warn-soft)" },
      },
      fontFamily: {
        sans: [
          "Inter",
          "Inter var",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "SF Mono",
          "Menlo",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
      fontSize: {
        // Extra tiers that the product needs beyond Tailwind's defaults.
        micro: ["var(--fs-micro)", { lineHeight: "1.45" }],
        meta: ["var(--fs-meta)", { lineHeight: "1.5" }],
        page: ["var(--fs-page)", { lineHeight: "1.2" }],
      },
      borderRadius: {
        sm: "var(--r-sm)",
        DEFAULT: "var(--r)",
        md: "var(--r)",
        lg: "var(--r-lg)",
        xl: "var(--r-lg)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        DEFAULT: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
      transitionTimingFunction: {
        out: "var(--ease)",
      },
      transitionDuration: {
        fast: "var(--dur)",
      },
      maxWidth: {
        page: "var(--page-max)",
      },
      spacing: {
        rail: "var(--rail)",
      },
    },
  },
  plugins: [],
};
