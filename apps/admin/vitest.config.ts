import { defineConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default defineConfig({
  ...viteConfig,
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["@testing-library/jest-dom/vitest"],
    include: ["src/__tests__/**/*.runtime.test.tsx"],
    exclude: ["node_modules", "dist"],
    passWithNoTests: false,
  },
});
