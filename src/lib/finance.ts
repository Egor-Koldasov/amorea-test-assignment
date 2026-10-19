import Decimal from "decimal.js";
import type { Entry, Issue } from "./types";
import { validDate } from "./validation";
const DAY = 86400000;
export const dayNumber = (s: string) => Date.parse(s) / DAY;
export type Filter = { property: string; from: string; to: string };
export function parseFilter(
  params: Record<string, string | string[] | undefined>,
): Filter {
  const value = (k: string, fallback: string) =>
    typeof params[k] === "string" ? (params[k] as string) : fallback;
  const from = value("from", "2026-09-01"),
    to = value("to", "2026-10-31"),
    property = value("property", "all");
  if (!validDate(from) || !validDate(to) || from > to)
    throw new Error("Укажите корректный период: начало не позже окончания.");
  if (property !== "all" && !/^V\d{3,}$/.test(property))
    throw new Error("Некорректный объект.");
  return { from, to, property };
}
// Allocate in whole IDR, with the remainder assigned to the earliest nights.
export function allocate(
  total: string,
  nights: number,
  start: number,
  end: number,
): Decimal {
  if (!Number.isInteger(nights) || nights <= 0)
    throw new Error("Invalid stay length");
  const n = new Decimal(total),
    base = n.div(nights).floor(),
    remainder = n.mod(nights).toNumber();
  const lo = Math.max(0, Math.min(nights, start)),
    hi = Math.max(lo, Math.min(nights, end));
  return base
    .mul(hi - lo)
    .plus(Math.max(0, Math.min(hi, remainder) - Math.min(lo, remainder)));
}
export function portion(total: string, r: Entry["row"], filter: Filter) {
  const checkin = dayNumber(r.check_in),
    nights = dayNumber(r.check_out) - checkin;
  return allocate(
    total,
    nights,
    dayNumber(filter.from) - checkin,
    dayNumber(filter.to) + 1 - checkin,
  );
}
export const inPeriod = (date: string, f: Filter) =>
  date >= f.from && date <= f.to;
export function matchesEntry(e: Entry, f: Filter) {
  if (f.property !== "all" && e.row.property_id !== f.property) return false;
  if (e.kind === "reservations")
    return (
      !validDate(e.row.check_in) ||
      !validDate(e.row.check_out) ||
      (e.row.check_in <= f.to && e.row.check_out > f.from)
    );
  if (e.kind === "expenses")
    return !validDate(e.row.expense_date) || inPeriod(e.row.expense_date, f);
  if (e.kind === "payments")
    return !validDate(e.row.payment_date) || inPeriod(e.row.payment_date, f);
  return true;
}
const fields = [
  "gross",
  "ota",
  "management",
  "expenses",
  "pending",
  "receipts",
  "balance",
  "disputed",
  "excludedGross",
] as const;
export type Totals = Record<(typeof fields)[number], string>;
export function calculate(entries: Entry[], f: Filter): Totals {
  const t = Object.fromEntries(
    fields.map((k) => [k, new Decimal(0)]),
  ) as Record<(typeof fields)[number], Decimal>;
  const rules = entries.filter(
    (e) => e.kind === "commission_rules" && !e.excluded,
  );
  for (const e of entries) {
    const r = e.row;
    if (!matchesEntry(e, f)) continue;
    if (e.excluded) continue;
    if (e.kind === "reservations") {
      if (r.status === "cancelled") {
        if (inPeriod(r.check_in, f)) t.disputed = t.disputed.plus(r.ota_fee);
        continue;
      }
      const rule = rules.filter(
        (e) =>
          e.row.property_id === r.property_id &&
          e.row.effective_from <= r.check_in &&
          e.row.effective_to >= r.check_in,
      );
      if (rule.length !== 1)
        throw new Error(`Нарушение проверки комиссии: ${e.key}`);
      const fee = new Decimal(r.gross_booking_value)
        .mul(rule[0].row.management_fee_rate)
        .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
        .toFixed(0);
      t.gross = t.gross.plus(portion(r.gross_booking_value, r, f));
      t.ota = t.ota.plus(portion(r.ota_fee, r, f));
      t.management = t.management.plus(portion(fee, r, f));
    }
    if (e.kind === "expenses") {
      t.expenses = t.expenses.plus(r.amount);
      if (r.payment_status === "pending") t.pending = t.pending.plus(r.amount);
    }
    if (e.kind === "payments") t.receipts = t.receipts.plus(r.amount);
  }
  t.balance = t.gross.minus(t.ota).minus(t.management).minus(t.expenses);
  return Object.fromEntries(fields.map((k) => [k, t[k].toFixed(0)])) as Totals;
}
export function excludedGross(entries: Entry[], issues: Issue[], f: Filter) {
  const ignore = new Set(
    issues
      .filter((i) => ["duplicate", "superseded"].includes(i.code))
      .map((i) => i.entry),
  );
  let total = new Decimal(0);
  for (const e of entries)
    if (
      e.kind === "reservations" &&
      e.excluded &&
      !ignore.has(e) &&
      matchesEntry(e, f) &&
      e.row.currency === "IDR" &&
      /^\d+$/.test(e.row.gross_booking_value) &&
      validDate(e.row.check_in) &&
      validDate(e.row.check_out) &&
      e.row.check_out > e.row.check_in
    )
      total = total.plus(portion(e.row.gross_booking_value, e.row, f));
  return total.toFixed(0);
}
