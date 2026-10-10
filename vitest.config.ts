import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Vitest configuration.
 *
 * The default environment is `node`, because the game core is deliberately
 * framework-free and must be testable without a DOM. Component tests opt in to
 * `jsdom` with a per-file `// @vitest-environment jsdom` docblock.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    // `globals: true` is required so @testing-library/react can auto-register
    // its afterEach cleanup. Without it, DOM from one test leaks into the next
    // and every `getByRole` query starts failing with "found multiple elements".
    globals: true,
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}", "server/**/*.test.ts", "db/**/*.test.ts", "api/**/*.test.ts"],
    setupFiles: ["./src/test/setup.ts"],
    reporters: ["default"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/test/**",
        "src/**/*.{test,spec}.{ts,tsx}",
        "src/**/*.d.ts",
        "src/core/adapters/webAudio.ts", // WebAudio cannot run under Node
        "src/game/render.ts", // canvas painting, covered by visual/E2E instead
      ],
      thresholds: {
        statements: 60,
        branches: 50,
        functions: 60,
        lines: 60,
      },
    },
  },
});
