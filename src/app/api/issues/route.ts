import { loadDataset } from "@/lib/report";
import { matchesEntry, parseFilter } from "@/lib/finance";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const cell = (s: string) =>
  `"${(/^[=+@\-\t\r]/.test(s) ? `'${s}` : s).replaceAll('"', '""')}"`;
export async function GET(request: Request) {
  try {
    const f = parseFilter(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const data = loadDataset();
    const rows = [
      [
        "file",
        "line",
        "id",
        "property",
        "decision",
        "code",
        "reason",
        "related_id",
        "source",
      ],
      ...data.issues
        .filter((i) => matchesEntry(i.entry, f))
        .map((i) => [
          `${i.entry.kind}.csv`,
          String(i.entry.line),
          i.entry.key,
          i.entry.row.property_id,
          i.severity,
          i.code,
          i.message,
          i.relatedId || "",
          JSON.stringify(i.entry.row),
        ]),
    ];
    return new Response(
      "\uFEFF" + rows.map((r) => r.map(cell).join(",")).join("\r\n"),
      {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="data-quality.csv"',
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
