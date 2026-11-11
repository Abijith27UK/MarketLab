import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  base: "./",
  resolve: {
    alias: [
      {
        find: "@/convex/_generated",
        replacement: path.resolve(__dirname, "convex/_generated"),
      },
      { find: "@", replacement: path.resolve(__dirname, "src") },
      // Pure market-data modules shared by the Convex backend and the UI.
      { find: "@quant", replacement: path.resolve(__dirname, "convex/market") },
      // Pure strategy types, validation and formatting shared with the backtester.
      { find: "@backtest", replacement: path.resolve(__dirname, "convex/backtestCore") },
    ],
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        // Split the three large, rarely-changing dependency groups out of the
        // application chunk so a code change does not invalidate all of it.
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("lightweight-charts")) return "charts";
          if (id.includes("convex") || id.includes("@convex-dev")) return "convex";
          if (id.includes("react-dom") || id.includes("react/") || id.includes("scheduler")) {
            return "react";
          }
          return "vendor";
        },
      },
    },
  },
});
