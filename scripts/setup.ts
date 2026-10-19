import path from "node:path";
import { openDatabase } from "../src/lib/db";
import { importSnapshot } from "../src/lib/import";
const connection = openDatabase(undefined, true);
try {
  console.log(
    importSnapshot(
      connection,
      path.resolve(process.argv[2] || "Technical_Challenge_Data"),
    ),
  );
} finally {
  connection.sqlite.close();
}
