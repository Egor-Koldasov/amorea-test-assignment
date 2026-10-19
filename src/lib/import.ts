import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { openDatabase } from "./db";
import { batches, files, rawRows, entities, issues, settings } from "./schema";
import { kinds, type Kind } from "./types";
import { validate } from "./validation";
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function importSnapshot(
  connection: ReturnType<typeof openDatabase>,
  directory: string,
) {
  const input = Object.fromEntries(
    kinds.map((k) => [
      k,
      readFileSync(path.join(directory, `${k}.csv`), "utf8"),
    ]),
  ) as Record<Kind, string>;
  const digest = hash(JSON.stringify(kinds.map((k) => [k, hash(input[k])])));
  const { db, sqlite } = connection;
  const existing = db
    .select()
    .from(batches)
    .where(eq(batches.hash, digest))
    .get();
  if (existing) {
    db.insert(settings)
      .values({ key: "active_batch", value: existing.id })
      .onConflictDoUpdate({ target: settings.key, set: { value: existing.id } })
      .run();
    return { batchId: existing.id, reused: true };
  }
  const data = validate(input); // A malformed file fails before any write.
  return sqlite.transaction(() => {
    const batch = db
      .insert(batches)
      .values({ hash: digest, createdAt: new Date().toISOString() })
      .returning()
      .get();
    const fileIds = new Map(
      kinds.map((k) => [
        k,
        db
          .insert(files)
          .values({ batchId: batch.id, name: `${k}.csv`, hash: hash(input[k]) })
          .returning()
          .get().id,
      ]),
    );
    const ids = new Map<object, number>();
    for (const e of data.entries) {
      const raw = db
        .insert(rawRows)
        .values({
          fileId: fileIds.get(e.kind)!,
          line: e.line,
          payload: JSON.stringify(e.row),
        })
        .returning()
        .get();
      ids.set(e, raw.id);
      db.insert(entities)
        .values({
          batchId: batch.id,
          rawId: raw.id,
          kind: e.kind,
          businessId: e.key,
          propertyId: e.row.property_id,
          payload: JSON.stringify(e.row),
          excluded: e.excluded,
        })
        .run();
    }
    for (const i of data.issues)
      db.insert(issues)
        .values({
          batchId: batch.id,
          rawId: ids.get(i.entry)!,
          severity: i.severity,
          code: i.code,
          message: i.message,
          relatedId: i.relatedId,
        })
        .run();
    db.insert(settings)
      .values({ key: "active_batch", value: batch.id })
      .onConflictDoUpdate({ target: settings.key, set: { value: batch.id } })
      .run();
    return {
      batchId: batch.id,
      reused: false,
      rows: data.entries.length,
      issues: data.issues.length,
    };
  })();
}
