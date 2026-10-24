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
    ],
  },
  build: {
    outDir: "dist",
  },
});
