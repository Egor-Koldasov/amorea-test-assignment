import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import path from "node:path";
export function openDatabase(
  filename = process.env.DATABASE_PATH ||
    path.join(process.cwd(), "data/ledger.sqlite"),
  initialize = false,
) {
  if (initialize && filename !== ":memory:") {
    mkdirSync(path.dirname(filename), { recursive: true });
  }
  let sqlite: Database.Database;
  try {
    sqlite = new Database(filename, {
      fileMustExist: !initialize && filename !== ":memory:",
      readonly: !initialize && filename !== ":memory:",
    });
  } catch (error) {
    throw new Error(
      "Не удалось открыть базу. Выполните npm run setup и проверьте DATABASE_PATH.",
      { cause: error },
    );
  }
  sqlite.pragma("foreign_keys = ON");
  if (initialize) sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite);
  if (initialize)
    migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return { db, sqlite };
}
