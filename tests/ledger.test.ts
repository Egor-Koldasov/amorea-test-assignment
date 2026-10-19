import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { allocate, calculate, parseFilter, portion } from "../src/lib/finance";
import { validate, headers } from "../src/lib/validation";
import { kinds, type Kind, type Row } from "../src/lib/types";
import { openDatabase } from "../src/lib/db";
import { importSnapshot } from "../src/lib/import";
const source = () =>
  Object.fromEntries(
    kinds.map((k) => [
      k,
      readFileSync(`Technical_Challenge_Data/${k}.csv`, "utf8"),
    ]),
  ) as Record<Kind, string>;
function fixture(overrides: Partial<Record<Kind, Row[]>> = {}) {
  const rows: Record<Kind, Row[]> = {
    properties: [
      {
        property_id: "V001",
        property_name: "Test",
        cluster: "Ubud",
        owner_id: "O001",
        base_currency: "IDR",
      },
    ],
    reservations: [
      {
        reservation_id: "R0001",
        property_id: "V001",
        check_in: "2026-09-28",
        check_out: "2026-10-03",
        status: "confirmed",
        gross_booking_value: "100000",
        currency: "IDR",
        ota_fee: "15000",
        refund_amount: "0",
        channel: "OTA",
        updated_at: "2026-09-01",
      },
    ],
    expenses: [],
    payments: [],
    commission_rules: [
      {
        property_id: "V001",
        effective_from: "2026-09-01",
        effective_to: "2026-12-31",
        management_fee_rate: "0.17",
        fee_basis: "gross_booking_value",
        note: "",
      },
    ],
    ...overrides,
  };
  return Object.fromEntries(
    kinds.map((k) => [
      k,
      [
        headers[k].join(","),
        ...rows[k].map((r) => headers[k].map((h) => r[h]).join(",")),
      ].join("\n"),
    ]),
  ) as Record<Kind, string>;
}
const filter = { property: "all", from: "2026-09-01", to: "2026-09-30" };
describe("Financial calculations", () => {
  it("allocates exact amounts without losing remainder", () => {
    expect(
      [0, 1, 2].map((n) => allocate("100", 3, n, n + 1).toNumber()),
    ).toEqual([34, 33, 33]);
    expect(allocate("100", 3, -10, 10).toString()).toBe("100");
  });
  it("splits accruals across months and keeps cash independent", () => {
    const d = validate(
      fixture({
        payments: [
          {
            payment_id: "P0001",
            reservation_id: "R0001",
            property_id: "V001",
            payment_date: "2026-09-05",
            amount: "100000",
            currency: "IDR",
            status: "received",
          },
        ],
      }),
    );
    const sep = calculate(d.entries, filter),
      oct = calculate(d.entries, {
        ...filter,
        from: "2026-10-01",
        to: "2026-10-31",
      });
    expect(sep).toMatchObject({
      gross: "60000",
      ota: "9000",
      management: "10200",
      balance: "40800",
      receipts: "100000",
    });
    expect(oct).toMatchObject({
      gross: "40000",
      management: "6800",
      receipts: "0",
    });
  });
  it("counts paid and pending expenses by expense date", () => {
    const d = validate(
      fixture({
        expenses: ["paid", "pending"].map((s, n) => ({
          expense_id: `E000${n}`,
          property_id: "V001",
          expense_date: "2026-09-15",
          category: "Cleaning",
          amount: "1000",
          currency: "IDR",
          payment_status: s,
        })),
      }),
    );
    expect(calculate(d.entries, filter)).toMatchObject({
      expenses: "2000",
      pending: "1000",
      balance: "38800",
    });
  });
  it("uses check-in rate even when stay crosses rate boundary", () => {
    const input = fixture();
    input.commission_rules =
      input.commission_rules.replace("2026-12-31", "2026-09-30") +
      "\nV001,2026-10-01,2026-12-31,0.2,gross_booking_value,";
    const d = validate(input);
    expect(
      calculate(d.entries, { ...filter, to: "2026-10-31" }).management,
    ).toBe("17000");
  });
  it("excludes checkout day and rejects invalid filter dates", () => {
    expect(
      portion(
        "100",
        { check_in: "2026-09-01", check_out: "2026-09-02" },
        { ...filter, from: "2026-09-02" },
      ).toString(),
    ).toBe("0");
    expect(() => parseFilter({ from: "2026-02-30" })).toThrow();
    expect(() =>
      parseFilter({ from: "2027-01-01", to: "2026-01-01" }),
    ).toThrow();
  });
  it("cancellations create no accrual; disputed OTA follows planned arrival", () => {
    const input = fixture();
    input.reservations = input.reservations.replace(
      "confirmed,100000,IDR,15000,0",
      "cancelled,100000,IDR,15000,100000",
    );
    const d = validate(input);
    expect(calculate(d.entries, filter)).toMatchObject({
      gross: "0",
      management: "0",
      ota: "0",
      disputed: "15000",
    });
    expect(
      calculate(d.entries, { ...filter, from: "2026-10-01", to: "2026-10-31" })
        .disputed,
    ).toBe("0");
  });
});
describe("Validation", () => {
  it("finds the known source issues and 73 overlap pairs", () => {
    const d = validate(source());
    expect(d.entries).toHaveLength(357);
    expect(d.issues.filter((i) => i.code === "duplicate")).toHaveLength(2);
    expect(d.issues.filter((i) => i.code === "overlap")).toHaveLength(146);
    expect(
      new Set(
        d.issues.filter((i) => i.code === "overlap").map((i) => i.entry.key),
      ).size,
    ).toBe(87);
    expect(
      d.entries
        .filter((e) => e.kind === "reservations" && e.excluded)
        .map((e) => e.key)
        .sort(),
    ).toEqual(["R0015", "R0034", "R0061", "R0072", "R0102"]);
  });
  it("deduplicates without changing totals", () => {
    const a = fixture(),
      b = fixture();
    b.reservations += "\n" + b.reservations.split("\n")[1];
    expect(calculate(validate(a).entries, filter)).toEqual(
      calculate(validate(b).entries, filter),
    );
  });
  it("chooses latest version, rejects equal-date conflicts", () => {
    const a = fixture(),
      line = a.reservations.split("\n")[1];
    a.reservations +=
      "\n" +
      line.replace("100000", "200000").replace("2026-09-01", "2026-09-02");
    expect(calculate(validate(a).entries, filter).gross).toBe("120000");
    a.reservations = a.reservations.replace("2026-09-02", "2026-09-01");
    expect(calculate(validate(a).entries, filter).gross).toBe("0");
  });
  it("does not call adjacent stays overlapping", () => {
    const a = fixture();
    a.reservations +=
      "\n" +
      a.reservations
        .split("\n")[1]
        .replace("R0001", "R0002")
        .replace("2026-09-28", "2026-10-03")
        .replace("2026-10-03,confirmed", "2026-10-05,confirmed");
    expect(validate(a).issues.filter((i) => i.code === "overlap")).toHaveLength(
      0,
    );
  });
  it("rejects overlapping commission rules instead of picking one", () => {
    const a = fixture();
    a.commission_rules +=
      "\nV001,2026-09-15,2026-12-31,0.2,gross_booking_value,";
    const d = validate(a);
    expect(d.issues.some((i) => i.code === "commission_match")).toBe(true);
    expect(calculate(d.entries, filter).gross).toBe("0");
  });
  it("keeps valid receipt when reservation has invalid fee", () => {
    const a = fixture({
      payments: [
        {
          payment_id: "P0001",
          reservation_id: "R0001",
          property_id: "V001",
          payment_date: "2026-09-05",
          amount: "100000",
          currency: "IDR",
          status: "received",
        },
      ],
    });
    a.reservations = a.reservations.replace("15000", "-100");
    expect(calculate(validate(a).entries, filter)).toMatchObject({
      gross: "0",
      receipts: "100000",
    });
  });
  it("quarantines partial refunds and missing rates", () => {
    const a = fixture();
    a.reservations = a.reservations.replace("15000,0,OTA", "15000,100,OTA");
    expect(validate(a).issues.some((i) => i.code === "partial_refund")).toBe(
      true,
    );
    const b = fixture({ commission_rules: [] });
    expect(calculate(validate(b).entries, filter).gross).toBe("0");
  });
});
describe("SQLite import", () => {
  it("is idempotent, preserves snapshots, supports restore, and fails atomically", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "villa-ledger-")),
      c = openDatabase(":memory:", true);
    try {
      const input = fixture();
      for (const k of kinds)
        writeFileSync(path.join(dir, k + ".csv"), input[k]);
      const first = importSnapshot(c, dir);
      expect(first.reused).toBe(false);
      expect(importSnapshot(c, dir)).toEqual({
        batchId: first.batchId,
        reused: true,
      });
      expect(c.sqlite.prepare("select count(*) n from raw_rows").get()).toEqual(
        { n: 3 },
      );
      writeFileSync(
        path.join(dir, "reservations.csv"),
        input.reservations.replace("100000", "200000"),
      );
      expect(importSnapshot(c, dir).batchId).not.toBe(first.batchId);
      expect(c.sqlite.prepare("select count(*) n from batches").get()).toEqual({
        n: 2,
      });
      writeFileSync(path.join(dir, "reservations.csv"), input.reservations);
      expect(importSnapshot(c, dir).batchId).toBe(first.batchId);
      writeFileSync(path.join(dir, "payments.csv"), "bad,header\n1,2");
      expect(() => importSnapshot(c, dir)).toThrow();
      expect(c.sqlite.prepare("select count(*) n from batches").get()).toEqual({
        n: 2,
      });
      expect(
        c.sqlite
          .prepare("select value from settings where key='active_batch'")
          .get(),
      ).toEqual({ value: first.batchId });
    } finally {
      c.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
