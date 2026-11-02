import { execSync } from "node:child_process";

/** Applies migrations to the dedicated TEST database before integration tests. */
export default function setup() {
  const url =
    process.env.TEST_DATABASE_URL ?? "postgresql://rezonest:rezonest@localhost:5432/rezonest_workos_test";
  if (!url.includes("test")) throw new Error("Refusing to run integration tests on a non-test database");
  execSync("pnpm prisma migrate deploy", { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });
}
