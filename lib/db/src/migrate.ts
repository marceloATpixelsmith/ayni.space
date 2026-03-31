import fs from "node:fs";
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./index";

function resolveMigrationsFolder(): string {
  const candidates = [
    path.resolve(process.cwd(), "lib/db/migrations"),
    path.resolve(process.cwd(), "../lib/db/migrations"),
    path.resolve(process.cwd(), "../../lib/db/migrations"),
    path.resolve(process.cwd(), "../../../lib/db/migrations"),
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
