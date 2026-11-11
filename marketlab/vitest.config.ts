import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@/convex/_generated",
        replacement: path.resolve(__dirname, "convex/_generated"),
      },
      { find: "@", replacement: path.resolve(__dirname, "src") },
      { find: "@quant", replacement: path.resolve(__dirname, "convex/market") },
      { find: "@backtest", replacement: path.resolve(__dirname, "convex/backtestCore") },
    ],
  },
  test: {
    // Pure logic tests run in node; component tests opt into jsdom with a
    // `@vitest-environment jsdom` docblock at the top of the file.
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    reporters: "default",
  },
});
