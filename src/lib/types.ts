export const kinds = [
  "properties",
  "reservations",
  "expenses",
  "payments",
  "commission_rules",
] as const;
export type Kind = (typeof kinds)[number];
export type Row = Record<string, string>;
export type Entry = {
  kind: Kind;
  line: number;
  row: Row;
  key: string;
  excluded: boolean;
};
export type Issue = {
  entry: Entry;
  severity: "exclude" | "warning";
  code: string;
  message: string;
  relatedId?: string;
};
export type Dataset = { entries: Entry[]; issues: Issue[] };
export const keyOf = (kind: Kind, r: Row) =>
  kind === "commission_rules"
    ? `${r.property_id}/${r.effective_from}/${r.effective_to}`
    : r[
        {
          properties: "property_id",
          reservations: "reservation_id",
          expenses: "expense_id",
          payments: "payment_id",
        }[kind]
      ];
