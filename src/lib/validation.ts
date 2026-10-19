import Decimal from "decimal.js";
import { parse } from "csv-parse/sync";
import {
  kinds,
  keyOf,
  type Kind,
  type Row,
  type Entry,
  type Issue,
  type Dataset,
} from "./types";
export const headers: Record<Kind, string[]> = {
  properties: [
    "property_id",
    "property_name",
    "cluster",
    "owner_id",
    "base_currency",
  ],
  reservations: [
    "reservation_id",
    "property_id",
    "check_in",
    "check_out",
    "status",
    "gross_booking_value",
    "currency",
    "ota_fee",
    "refund_amount",
    "channel",
    "updated_at",
  ],
  expenses: [
    "expense_id",
    "property_id",
    "expense_date",
    "category",
    "amount",
    "currency",
    "payment_status",
  ],
  payments: [
    "payment_id",
    "reservation_id",
    "property_id",
    "payment_date",
    "amount",
    "currency",
    "status",
  ],
  commission_rules: [
    "property_id",
    "effective_from",
    "effective_to",
    "management_fee_rate",
    "fee_basis",
    "note",
  ],
};
export function validDate(s: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s
  );
}
const amount = (s: string) =>
  /^\d+$/.test(s) && new Decimal(s).lte(Number.MAX_SAFE_INTEGER);
export function validate(input: Record<Kind, string>): Dataset {
  const entries: Entry[] = [],
    issues: Issue[] = [];
  const flag = (
    e: Entry,
    code: string,
    message: string,
    severity: "exclude" | "warning" = "exclude",
    relatedId?: string,
  ) => {
    if (severity === "exclude") e.excluded = true;
    issues.push({ entry: e, code, message, severity, relatedId });
  };
  for (const kind of kinds) {
    const records = parse(input[kind], {
      bom: true,
      columns: (cols: string[]) => {
        if (
          headers[kind].some((h) => !cols.includes(h)) ||
          new Set(cols).size !== cols.length
        )
          throw new Error(
            `${kind}.csv: отсутствуют обязательные столбцы или есть повторные заголовки`,
          );
        return cols;
      },
      skip_empty_lines: true,
      info: true,
      trim: true,
    }) as { record: Row; info: { lines: number } }[];
    for (const item of records) {
      const row = item.record,
        e: Entry = {
          kind,
          row,
          key: keyOf(kind, row),
          line: item.info.lines,
          excluded: false,
        };
      entries.push(e);
      if (headers[kind].filter((h) => h !== "note").some((h) => !row[h]))
        flag(e, "required", "Не заполнены обязательные поля");
      const ids: Record<string, string> = {
        property_id: "V",
        owner_id: "O",
        reservation_id: "R",
        expense_id: "E",
        payment_id: "P",
      };
      for (const [f, prefix] of Object.entries(ids))
        if (f in row && !new RegExp(`^${prefix}\\d{3,}$`).test(row[f]))
          flag(e, "id_format", `Некорректный ${f}`);
      for (const f of [
        "check_in",
        "check_out",
        "updated_at",
        "expense_date",
        "payment_date",
        "effective_from",
        "effective_to",
      ])
        if (f in row && !validDate(row[f]))
          flag(e, "date", `Некорректная дата ${f}`);
      for (const f of [
        "gross_booking_value",
        "ota_fee",
        "refund_amount",
        "amount",
      ])
        if (f in row && !amount(row[f]))
          flag(
            e,
            "amount",
            `Некорректная сумма ${f}: требуется целое неотрицательное значение`,
          );
      if ("currency" in row && row.currency !== "IDR")
        flag(e, "currency", `Валюта ${row.currency}: нет курса для итога IDR`);
      if (kind === "properties" && row.base_currency !== "IDR")
        flag(e, "currency", "Прототип поддерживает базовую валюту IDR");
      if (kind === "reservations") {
        if (!["confirmed", "modified", "cancelled"].includes(row.status))
          flag(e, "status", "Неизвестный статус бронирования");
        if (row.check_out <= row.check_in)
          flag(e, "interval", "Выезд должен быть позже заезда");
        if (amount(row.refund_amount) && amount(row.gross_booking_value)) {
          if (new Decimal(row.refund_amount).gt(row.gross_booking_value))
            flag(e, "refund_exceeds", "Возврат больше стоимости");
          else if (
            row.refund_amount !== "0" &&
            new Decimal(row.refund_amount).lt(row.gross_booking_value)
          )
            flag(
              e,
              "partial_refund",
              "Частичный возврат: правила пересчёта не определены",
            );
          else if (
            row.status === "cancelled" &&
            !new Decimal(row.refund_amount).eq(row.gross_booking_value)
          )
            flag(
              e,
              "cancellation",
              "Отмена без полного возврата: требуется проверка",
            );
          else if (
            row.status !== "cancelled" &&
            new Decimal(row.refund_amount).gt(0)
          )
            flag(
              e,
              "refund_status",
              "Полный возврат при активном бронировании",
            );
        }
        if (
          amount(row.ota_fee) &&
          amount(row.gross_booking_value) &&
          new Decimal(row.ota_fee).gt(row.gross_booking_value)
        )
          flag(e, "fee_exceeds", "OTA-комиссия больше стоимости");
        if (
          row.channel === "Direct" &&
          amount(row.ota_fee) &&
          new Decimal(row.ota_fee).gt(0)
        )
          flag(e, "direct_fee", "Direct с ненулевой OTA-комиссией", "warning");
        if (
          row.status === "cancelled" &&
          amount(row.ota_fee) &&
          new Decimal(row.ota_fee).gt(0)
        )
          flag(
            e,
            "cancel_fee",
            "Неизвестно, удержана ли OTA-комиссия при отмене",
            "warning",
          );
      }
      if (
        kind === "expenses" &&
        !["paid", "pending"].includes(row.payment_status)
      )
        flag(e, "status", "Неизвестный статус расхода");
      if (kind === "payments") {
        if (row.status !== "received")
          flag(e, "status", "В поступления включаем только received");
        if (row.amount === "0")
          flag(
            e,
            "zero_payment",
            "Нулевой платёж не подтверждает поступление или возврат",
            "warning",
          );
      }
      if (kind === "commission_rules") {
        if (!/^0(?:\.\d+)?$|^1(?:\.0+)?$/.test(row.management_fee_rate))
          flag(e, "rate", "Ставка должна быть от 0 до 1");
        if (row.fee_basis !== "gross_booking_value")
          flag(e, "basis", "Неподдерживаемая база комиссии");
        if (row.effective_to < row.effective_from)
          flag(e, "interval", "Некорректный период ставки");
      }
    }
  }
  // Resolve duplicates before cross-file checks. Preserve every source row for audit.
  const groups = new Map<string, Entry[]>();
  for (const e of entries) {
    const k = `${e.kind}:${e.key}`;
    groups.set(k, [...(groups.get(k) || []), e]);
  }
  const canonical: Entry[] = [];
  for (const group of groups.values()) {
    const unique: Entry[] = [];
    for (const e of group) {
      if (unique.some((u) => JSON.stringify(u.row) === JSON.stringify(e.row)))
        flag(
          e,
          "duplicate",
          "Полный дубль: учитывается только первый экземпляр",
        );
      else unique.push(e);
    }
    if (unique.length === 1) {
      canonical.push(unique[0]);
      continue;
    }
    if (
      unique[0].kind === "reservations" &&
      unique.every((e) => validDate(e.row.updated_at))
    ) {
      unique.sort((a, b) => b.row.updated_at.localeCompare(a.row.updated_at));
      const latest = unique.filter(
        (e) => e.row.updated_at === unique[0].row.updated_at,
      );
      if (latest.length === 1) {
        canonical.push(latest[0]);
        for (const e of unique.slice(1))
          flag(e, "superseded", "Устаревшая версия бронирования");
        continue;
      }
    }
    for (const e of unique)
      flag(
        e,
        "conflict",
        "Один ID с противоречивыми данными: невозможно выбрать версию",
      );
  }
  const properties = new Map(
    canonical
      .filter((e) => e.kind === "properties" && !e.excluded)
      .map((e) => [e.key, e]),
  );
  for (const e of canonical)
    if (e.kind !== "properties" && !properties.has(e.row.property_id))
      flag(
        e,
        "unknown_property",
        `Объект ${e.row.property_id} отсутствует или исключён`,
      );
  const rules = canonical.filter(
    (e) => e.kind === "commission_rules" && !e.excluded,
  );
  for (let i = 0; i < rules.length; i++)
    for (const b of rules.slice(i + 1)) {
      const a = rules[i];
      if (
        a.row.property_id === b.row.property_id &&
        a.row.effective_from <= b.row.effective_to &&
        b.row.effective_from <= a.row.effective_to
      ) {
        flag(
          a,
          "rule_overlap",
          "Периоды правил комиссии пересекаются",
          "warning",
          b.key,
        );
        flag(
          b,
          "rule_overlap",
          "Периоды правил комиссии пересекаются",
          "warning",
          a.key,
        );
      }
    }
  const reservations = canonical.filter((e) => e.kind === "reservations");
  for (const e of reservations)
    if (e.row.status !== "cancelled" && validDate(e.row.check_in)) {
      const matches = rules.filter(
        (r) =>
          r.row.property_id === e.row.property_id &&
          r.row.effective_from <= e.row.check_in &&
          r.row.effective_to >= e.row.check_in,
      );
      if (matches.length !== 1)
        flag(
          e,
          "commission_match",
          `Подходящих ставок комиссии: ${matches.length}; требуется ровно одна`,
        );
    }
  // Warnings describe source availability, including reservations excluded for financial reasons.
  const active = reservations.filter(
    (e) =>
      e.row.status !== "cancelled" &&
      validDate(e.row.check_in) &&
      validDate(e.row.check_out) &&
      e.row.check_out > e.row.check_in,
  );
  for (let i = 0; i < active.length; i++)
    for (const b of active.slice(i + 1)) {
      const a = active[i];
      if (
        a.row.property_id === b.row.property_id &&
        a.row.check_in < b.row.check_out &&
        b.row.check_in < a.row.check_out
      ) {
        flag(
          a,
          "overlap",
          "Пересечение проживания на одной вилле",
          "warning",
          b.key,
        );
        flag(
          b,
          "overlap",
          "Пересечение проживания на одной вилле",
          "warning",
          a.key,
        );
      }
    }
  for (const e of canonical.filter((e) => e.kind === "payments")) {
    const r = reservations.find((r) => r.key === e.row.reservation_id);
    if (!r)
      flag(
        e,
        "unknown_reservation",
        "Бронирование отсутствует или имеет конфликт версий",
      );
    else if (r.row.property_id !== e.row.property_id)
      flag(
        e,
        "property_mismatch",
        "Объект платежа не совпадает с объектом бронирования",
      );
    else if (r.excluded)
      flag(
        e,
        "excluded_reservation",
        "Платёж связан с исключённым бронированием; проверяется независимо",
        "warning",
      );
  }
  return { entries, issues };
}
