import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

const TEST_DB =
  process.env.TEST_DATABASE_URL ?? "postgresql://rezonest:rezonest@localhost:5432/rezonest_workos_test";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node" },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          env: { DATABASE_URL: TEST_DB },
          globalSetup: ["tests/integration/global-setup.ts"],
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
          testTimeout: 30_000,
        },
      },
    ],
  },
});
