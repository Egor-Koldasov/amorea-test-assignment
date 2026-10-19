import { eq } from "drizzle-orm";
import { openDatabase } from "./db";
import { batches, settings, entities, rawRows, issues } from "./schema";
import type { Entry, Issue, Kind } from "./types";
export function loadDataset() {
  const { db, sqlite } = openDatabase();
  try {
    const active = db
      .select()
      .from(settings)
      .where(eq(settings.key, "active_batch"))
      .get();
    if (!active)
      throw new Error("Данные не импортированы. Выполните npm run setup.");
    const batch = db
      .select()
      .from(batches)
      .where(eq(batches.id, active.value))
      .get()!;
    const records = db
      .select({ entity: entities, line: rawRows.line })
      .from(entities)
      .innerJoin(rawRows, eq(entities.rawId, rawRows.id))
      .where(eq(entities.batchId, batch.id))
      .all();
    const map = new Map<number, Entry>();
    for (const { entity: e, line } of records)
      map.set(e.rawId, {
        kind: e.kind as Kind,
        key: e.businessId,
        row: JSON.parse(e.payload),
        line,
        excluded: e.excluded,
      });
    const problems: Issue[] = db
      .select()
      .from(issues)
      .where(eq(issues.batchId, batch.id))
      .all()
      .map((i) => ({
        entry: map.get(i.rawId)!,
        severity: i.severity as Issue["severity"],
        code: i.code,
        message: i.message,
        relatedId: i.relatedId || undefined,
      }));
    return {
      batch,
      entries: [...map.values()],
      issues: problems,
      batchCount: db.select().from(batches).all().length,
    };
  } finally {
    sqlite.close();
  }
}
