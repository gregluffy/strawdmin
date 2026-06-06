import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    server: {
      deps: {
        external: [/@libsql/, /^next/],
      },
    },
    env: {
      INTERNAL_DB_URL: ":memory:",
      DB_TYPE: "sqlite",
      DB_CONNECTION_STRING: "test",
      JWT_SECRET: "test-secret-do-not-use-in-prod",
    },
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      exclude: ["lib/types.ts", "lib/drivers/**"],
    },
  },
});
