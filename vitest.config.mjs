import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.mjs"],
    // Unit/DOM first; integration hits live site and needs network
    testTimeout: 15000,
    hookTimeout: 15000,
    pool: "forks",
  },
});
