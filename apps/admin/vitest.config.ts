import { defineConfig } from "vite";
import viteConfig from "./vite.config";

export default defineConfig({
  ...viteConfig,
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/__tests__/**/*.runtime.test.tsx"],
    exclude: ["node_modules", "dist"],
    passWithNoTests: false,
  },
});
