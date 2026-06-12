// Database Migration Runner
// Executes SQL migrations in order at startup

import * as fs from "fs";
import * as path from "path";
import { Database } from "./index";

export class MigrationRunner {
  constructor(private db: Database) {}

  async runMigrations(migrationsDir: string): Promise<void> {
    // Read all .sql files in directory
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    console.log(`🔄 Running ${files.length} migrations from ${migrationsDir}`);

    for (const file of files) {
      const filepath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filepath, "utf-8");

      try {
        console.log(`  ✓ ${file}`);
        await this.db.execute(sql);
      } catch (error) {
        console.error(`  ✗ ${file} failed:`, error);
        throw error;
      }
    }

    console.log("✅ All migrations completed");
  }
}
