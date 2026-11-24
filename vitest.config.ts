import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // zod ships a CJS build whose named exports Vitest's SSR loader can miss,
    // which makes `import { z } from "zod"` resolve to undefined. Inline it so
    // Vite transforms the ESM build instead.
    server: { deps: { inline: ["zod"] } },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
