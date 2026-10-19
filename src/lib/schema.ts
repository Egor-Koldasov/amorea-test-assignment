import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
export const batches = sqliteTable("batches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  hash: text("hash").notNull().unique(),
  createdAt: text("created_at").notNull(),
});
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: integer("value").notNull(),
});
export const files = sqliteTable("files", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  batchId: integer("batch_id")
    .notNull()
    .references(() => batches.id),
  name: text("name").notNull(),
  hash: text("hash").notNull(),
});
export const rawRows = sqliteTable("raw_rows", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fileId: integer("file_id")
    .notNull()
    .references(() => files.id),
  line: integer("line").notNull(),
  payload: text("payload").notNull(),
});
export const entities = sqliteTable("entities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  batchId: integer("batch_id")
    .notNull()
    .references(() => batches.id),
  rawId: integer("raw_id")
    .notNull()
    .references(() => rawRows.id),
  kind: text("kind").notNull(),
  businessId: text("business_id").notNull(),
  propertyId: text("property_id").notNull(),
  payload: text("payload").notNull(),
  excluded: integer("excluded", { mode: "boolean" }).notNull(),
});
export const issues = sqliteTable("issues", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  batchId: integer("batch_id")
    .notNull()
    .references(() => batches.id),
  rawId: integer("raw_id")
    .notNull()
    .references(() => rawRows.id),
  severity: text("severity").notNull(),
  code: text("code").notNull(),
  message: text("message").notNull(),
  relatedId: text("related_id"),
});
