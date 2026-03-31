import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./index";

function resolveMigrationsFolder(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentFile);

  const candidates = [
    path.resolve(currentDir, "../migrations"),
    path.resolve(process.cwd(), "lib/db/migrations"),
    path.resolve(process.cwd(), "../lib/db/migrations"),
    path.resolve(process.cwd(), "../../lib/db/migrations"),
  ];

  const migrationsFolder = candidates.find((candidate) => fs.existsSync(candidate));

  if (!migrationsFolder) {
    throw new Error(
      `Unable to locate drizzle migrations folder. Checked: ${candidates.join(", ")}`,
    );
  }

  return migrationsFolder;
}

export async function runMigrations(): Promise<void> {
  const migrationsFolder = resolveMigrationsFolder();
  await migrate(db, { migrationsFolder });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runMigrations()
    .then(() => {
      console.info("[db:migrate] Migrations applied successfully.");
      process.exit(0);
    })
    .catch((error) => {
      console.error("[db:migrate] Failed to apply migrations.");
      console.error(error);
      process.exit(1);
    });
}
