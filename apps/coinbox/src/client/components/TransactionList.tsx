import { formatSen } from "@portals/core";
import type { Transaction } from "../api/hooks";

/**
 * NEVER RENDER A NEGATIVE NUMBER. Coinbox CLAUDE.md.
 *
 * Direction is shown as a prefix and a colour, never a minus sign. A leading
 * `-` in a list of money is read as an accounting convention by some people
 * and as a mistake by others; `+` / `−` beside a colour is neither ambiguous
 * nor dependent on colour alone, which matters because the palette's own note
 * says a status colour is never the only signal.
 */
function Amount({ sen, direction }: { sen: number; direction: "in" | "out" }) {
  return (
    <span
      className={
        "tabular-nums font-semibold " +
        (direction === "in" ? "text-status-ok-fg" : "text-ink")
      }
    >
      {direction === "in" ? "+" : "−"} {formatSen(sen)}
    </span>
  );
}

export function TransactionList({
  transactions,
  vehicleNames,
  onEdit,
}: {
  transactions: Transaction[];
  vehicleNames: Map<string, string>;
  onEdit: (t: Transaction) => void;
}) {
  if (transactions.length === 0) {
    return (
      <p className="rounded-xl border border-edge bg-surface px-4 py-8 text-center text-ink-muted">
        Nothing here yet.
      </p>
    );
  }

  // Grouped by day, because that is how the Sheet reads and how spending is
  // remembered -- "what did I spend on Tuesday", not "row 412".
  const days = new Map<string, Transaction[]>();
  for (const t of transactions) {
    const list = days.get(t.occurredOn) ?? [];
    list.push(t);
    days.set(t.occurredOn, list);
  }

  return (
    <div className="flex flex-col gap-6">
      {[...days.entries()].map(([day, rows]) => (
        <section key={day}>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-faint">
            {day}
          </h3>
          <ul className="divide-y divide-edge overflow-hidden rounded-xl border border-edge bg-surface">
            {rows.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onEdit(t)}
                  className="flex w-full items-start justify-between gap-4 px-4 py-3 text-left hover:bg-inset"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-ink">{t.item}</span>
                    <span className="mt-0.5 block truncate text-sm text-ink-faint">
                      {t.categoryName}
                      {t.vehicleId && vehicleNames.has(t.vehicleId)
                        ? ` · ${vehicleNames.get(t.vehicleId)}`
                        : ""}
                      {t.description ? ` · ${t.description}` : ""}
                    </span>
                  </span>
                  <Amount sen={t.amountSen} direction={t.direction} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
