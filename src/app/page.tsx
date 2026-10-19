import Link from "next/link";
import { loadDataset } from "@/lib/report";
import {
  calculate,
  excludedGross,
  matchesEntry,
  parseFilter,
  type Filter,
} from "@/lib/finance";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const money = (s: string) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(
    BigInt(s),
  );
const labels: Record<string, string> = {
  properties: "Объекты",
  reservations: "Бронирования",
  expenses: "Расходы",
  payments: "Платежи",
  commission_rules: "Ставки",
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  let f: Filter;
  let data: ReturnType<typeof loadDataset>;
  try {
    f = parseFilter(params);
    data = loadDataset();
  } catch (error) {
    return (
      <main>
        <header>
          <span className="brand">◈ VILLA LEDGER</span>
        </header>
        <section className="empty">
          <h1>Ошибка загрузки</h1>
          <p>{(error as Error).message}</p>
          <a href="/">Вернуться к обзору</a>
        </section>
      </main>
    );
  }
  const props = data.entries.filter(
    (e) => e.kind === "properties" && !e.excluded,
  );
  if (f.property !== "all" && !props.some((e) => e.key === f.property))
    return (
      <main>
        <h1>Объект не найден</h1>
        <a href="/">Все объекты</a>
      </main>
    );
  const total = calculate(data.entries, f);
  const scopedIssues = data.issues.filter((i) => matchesEntry(i.entry, f));
  const excluded = new Set(
    scopedIssues.filter((i) => i.severity === "exclude").map((i) => i.entry),
  );
  const warnings = new Set(
    scopedIssues.filter((i) => i.severity === "warning").map((i) => i.entry),
  );
  const selected = props.filter(
    (e) => f.property === "all" || e.key === f.property,
  );
  const quality =
    params.quality === "exclude"
      ? "exclude"
      : params.quality === "warning"
        ? "warning"
        : "all";
  const issueList = scopedIssues
    .filter((i) => quality === "all" || i.severity === quality)
    .sort(
      (a, b) =>
        a.severity.localeCompare(b.severity) ||
        a.entry.kind.localeCompare(b.entry.kind) ||
        a.entry.line - b.entry.line,
    );
  const query = new URLSearchParams({
    property: f.property,
    from: f.from,
    to: f.to,
  });
  const qualityLink = (q: string) => `/?${query}&quality=${q}`;
  const cards = [
    ["Начисления", total.gross, "По ночам проживания"],
    ["Комиссии OTA", total.ota, ""],
    ["Комиссия УК", total.management, ""],
    [
      "Операционные расходы",
      total.expenses,
      `Не оплачено: ${money(total.pending)}`,
    ],
  ];
  return (
    <main>
      <header>
        <a className="brand" href="/">
          ◈ <span>VILLA LEDGER</span>
        </a>
        <span className="header-note">ФИНАНСЫ · IDR</span>
      </header>
      <form className="filters" action="/">
        <label>
          Объект
          <select name="property" defaultValue={f.property}>
            <option value="all">Все виллы · {props.length}</option>
            {props.map((p) => (
              <option key={p.key} value={p.key}>
                {p.row.property_name} · {p.row.cluster}
              </option>
            ))}
          </select>
        </label>
        <label>
          С даты
          <input
            aria-label="С даты"
            type="date"
            name="from"
            defaultValue={f.from}
            required
          />
        </label>
        <label>
          По дату включительно
          <input
            aria-label="По дату включительно"
            type="date"
            name="to"
            defaultValue={f.to}
            required
          />
        </label>
        <button type="submit">
          Применить <span>↗</span>
        </button>
        <a className="reset" href="/">
          Сбросить
        </a>
        <span className="currency">
          <b>IDR</b>
        </span>
      </form>
      <div className="notice">
        <span className="notice-icon">!</span>
        <p>
          Исключено строк: {excluded.size}. С предупреждениями: {warnings.size}.
        </p>
        <a href="#quality">Подробнее ↓</a>
      </div>
      <section className="summary" aria-label="Основные показатели">
        <div className="hero-card">
          <div className="card-label">РЕЗУЛЬТАТ СОБСТВЕННИКА · ОЦЕНКА</div>
          <div className="hero-number">
            {money(total.balance)} <small>IDR</small>
          </div>
          <div className="hero-foot">
            Не сумма к выплате. Спорные комиссии по отменам не включены.
          </div>
        </div>
        <div className="cash-card">
          <div className="card-label">ПОСТУПЛЕНИЯ</div>
          <div className="cash-number">
            {money(total.receipts)} <small>IDR</small>
          </div>
          <div className="hero-foot">
            По датам платежей. Без выплат и возвратов.
          </div>
        </div>
      </section>
      <section className="metrics">
        {cards.map(([title, value, caption]) => (
          <article key={title}>
            <h2>{title}</h2>
            <div className="metric-number">{money(value)}</div>
            {caption && <p>{caption}</p>}
          </article>
        ))}
      </section>
      <section className="section">
        <div className="section-title">
          <div>
            <h2>По объектам</h2>
          </div>
          <span className="muted">IDR</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Объект</th>
                <th>Начисления</th>
                <th>OTA</th>
                <th>Комиссия УК</th>
                <th>Расходы</th>
                <th>Результат*</th>
                <th>Поступления</th>
              </tr>
            </thead>
            <tbody>
              {selected.map((p) => {
                const t = calculate(data.entries, { ...f, property: p.key });
                return (
                  <tr key={p.key}>
                    <td>
                      <a
                        href={`/?${new URLSearchParams({ ...f, property: p.key })}`}
                      >
                        {p.row.property_name} ↗
                      </a>
                      <small>
                        {p.key} · {p.row.cluster}
                      </small>
                    </td>
                    {[
                      t.gross,
                      t.ota,
                      t.management,
                      t.expenses,
                      t.balance,
                      t.receipts,
                    ].map((n, i) => (
                      <td key={i} className={i === 4 ? "strong" : ""}>
                        {money(n)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>Всего</td>
                {[
                  total.gross,
                  total.ota,
                  total.management,
                  total.expenses,
                  total.balance,
                  total.receipts,
                ].map((n, i) => (
                  <td key={i}>{money(n)}</td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="footnote">* Оценка, не сумма к выплате.</p>
      </section>
      <section className="quality-summary">
        <div>
          <span className="eyebrow">СПОРНЫЕ OTA ПО ОТМЕНАМ</span>
          <h3>
            {money(total.disputed)} <small>IDR</small>
          </h3>
          <p>По плановому заезду; не включены в результат.</p>
        </div>
        <div>
          <span className="eyebrow">ИСКЛЮЧЁННАЯ СТОИМОСТЬ ПРОЖИВАНИЯ</span>
          <h3>
            {money(excludedGross(data.entries, data.issues, f))}{" "}
            <small>IDR</small>
          </h3>
          <p>Только IDR, без дублей и старых версий.</p>
        </div>
      </section>
      <section className="section" id="quality">
        <div className="section-title">
          <div>
            <h2>Качество данных</h2>
          </div>
          <a className="download" href={`/api/issues?${query}`}>
            Скачать CSV ↗
          </a>
        </div>
        <div className="tabs">
          <Link
            scroll={false}
            className={quality === "all" ? "active" : ""}
            href={qualityLink("all")}
          >
            Все замечания · {scopedIssues.length}
          </Link>
          <Link
            scroll={false}
            className={quality === "exclude" ? "active" : ""}
            href={qualityLink("exclude")}
          >
            Исключения ·{" "}
            {scopedIssues.filter((i) => i.severity === "exclude").length}
          </Link>
          <Link
            scroll={false}
            className={quality === "warning" ? "active" : ""}
            href={qualityLink("warning")}
          >
            Предупреждения ·{" "}
            {scopedIssues.filter((i) => i.severity === "warning").length}
          </Link>
        </div>
        <p className="footnote">
          Несколько замечаний могут относиться к одной строке.
        </p>
        <div className="table-wrap issue-table">
          <table>
            <thead>
              <tr>
                <th>Решение</th>
                <th>Источник / строка</th>
                <th>Запись</th>
                <th>Причина</th>
                <th>Исходные данные</th>
              </tr>
            </thead>
            <tbody>
              {issueList.map((i, n) => (
                <tr key={n}>
                  <td>
                    <span className={`badge ${i.severity}`}>
                      {i.severity === "exclude" ? "Исключено" : "Проверить"}
                    </span>
                  </td>
                  <td>
                    {labels[i.entry.kind]}
                    <small>
                      {i.entry.kind}.csv : {i.entry.line}
                    </small>
                  </td>
                  <td>
                    {i.entry.key}
                    <small>
                      {i.entry.row.property_id}
                      {i.relatedId ? ` ↔ ${i.relatedId}` : ""}
                    </small>
                  </td>
                  <td>
                    {i.message}
                    {i.severity === "warning" && i.entry.excluded && (
                      <small>Запись исключена по другой причине</small>
                    )}
                  </td>
                  <td>
                    <details>
                      <summary>Открыть</summary>
                      <dl>
                        {Object.entries(i.entry.row).map(([key, value]) => (
                          <div key={key}>
                            <dt>{key}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {issueList.length === 0 && (
            <p className="empty-state">В этом срезе замечаний нет.</p>
          )}
        </div>
      </section>
      <details className="method-note">
        <summary>Правила расчёта</summary>
        <p>
          Начисления и комиссии — по ночам, расходы — по дате возникновения,
          поступления — по дате платежа. Результат = начисления − OTA − комиссия
          УК − расходы.
        </p>
        <p>
          Ставка УК — на дату заезда, база — полная стоимость. Полные отмены с
          полным возвратом не дают начислений и комиссии УК. Спорные OTA по
          отменам не включены.
        </p>
        <p>
          Пересекающиеся бронирования остаются в расчётах. Нет дат оплаты
          расходов и возвратов, начальных остатков и выплат собственникам.
          Полный денежный поток и остаток к выплате неизвестны.
        </p>
        <p>
          Замечания без корректной даты показываются за любой период.
          Пересечения указаны для обоих участников.
        </p>
      </details>
    </main>
  );
}
