import { formatSen } from "@portals/core";
import type { MonthPoint } from "../api/hooks";

/**
 * The year as a diverging column chart, with the running total over it.
 *
 * This replaces a Surplus/Deficit table in the Google Sheet -- twelve rows,
 * each a month's net, plus a Total. Two things the table could not do, and
 * both are the reason this exists:
 *
 * - The SHAPE. Whether the year dug a hole and climbed out, or drifted down
 *   steadily, is the first thing you want and the last thing a column of
 *   figures shows you. That is the grey line.
 * - Months that have not happened. The Sheet fills them with RM 0.00, which
 *   renders as a run of break-even months rather than as an empty future.
 *   Here they simply have no column.
 *
 * The columns and the line share ONE axis and one unit. A second y-scale for
 * the running total would let any two series be drawn to agree or disagree at
 * will, which is why there isn't one.
 */

/** Plot height in px. Columns are absolutely positioned against it. */
const PLOT_H = 240;

/** Column width as a share of its month's band. The rest is deliberate air. */
const COL_SHARE = 0.42;

/**
 * Columns never grow past this, however wide the card gets.
 *
 * A column is a mark, not a container: past roughly this width it stops
 * reading as a measurement and starts reading as a block of colour, and the
 * eye compares areas instead of heights.
 */
const COL_MAX_PX = 24;

/**
 * Shortest column that still reads as a column.
 *
 * A month that lands near break-even is real information -- it should look
 * like a sliver, not like a month with no data at all.
 */
const MIN_H = 3;

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Axis ticks land on round money, not on whatever the extremes happen to be. */
function niceStep(range: number): number {
  const rough = range / 4;
  const mag = 10 ** Math.floor(Math.log10(Math.max(rough, 1)));
  for (const mult of [1, 2, 2.5, 5, 10]) {
    if (mag * mult >= rough) return mag * mult;
  }
  return mag * 10;
}

function tickLabel(sen: number): string {
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
    maximumFractionDigits: 0,
  }).format(sen / 100);
}

interface Scale {
  min: number;
  max: number;
  ticks: number[];
  /** Pixels from the top of the plot for a value in sen. */
  y: (sen: number) => number;
}

function buildScale(points: MonthPoint[]): Scale {
  const values = [0, ...points.map((p) => p.netSen), ...points.map((p) => p.cumulativeSen)];
  const rawMax = Math.max(...values);
  const rawMin = Math.min(...values);
  const step = niceStep(rawMax - rawMin || 1);

  const max = Math.ceil(rawMax / step) * step;
  const min = Math.floor(rawMin / step) * step;
  const span = max - min || 1;

  const ticks: number[] = [];
  for (let t = min; t <= max + 1; t += step) ticks.push(Math.round(t));

  return { min, max, ticks, y: (sen) => ((max - sen) / span) * PLOT_H };
}

export function YearChart({
  months,
  selected,
  onSelect,
  ytdNetSen,
}: {
  months: MonthPoint[];
  selected: string;
  onSelect: (month: string) => void;
  ytdNetSen: number;
}) {
  if (months.length === 0) {
    return (
      <div className="rounded-xl border border-edge bg-surface p-8 text-center">
        <p className="text-ink">No months to chart yet.</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
          Once there are entries in more than one month, the year appears here.
        </p>
      </div>
    );
  }

  // The calendar year the selection sits in, so the empty tail of the year is
  // visible rather than the chart quietly ending at the last month with data.
  const year = selected.slice(0, 4);
  const bands = MONTH_LABELS.map((label, i) => {
    const key = `${year}-${String(i + 1).padStart(2, "0")}`;
    return { key, label, point: months.find((m) => m.month === key) ?? null };
  });

  const inYear = bands.filter((b) => b.point).map((b) => b.point as MonthPoint);
  const scale = buildScale(inYear.length > 0 ? inYear : months);
  const zeroY = scale.y(0);
  const bandPct = 100 / bands.length;

  // The running total is drawn only across months that have one. `points`
  // carries percent x and pixel y; the SVG stretches horizontally while
  // vector-effect keeps the stroke 2px at any width.
  const line = bands
    .map((b, i) =>
      b.point ? `${(i + 0.5) * bandPct},${scale.y(b.point.cumulativeSen)}` : null,
    )
    .filter((p): p is string => p !== null);

  const lastWithData = bands.filter((b) => b.point).at(-1);
  const lastIndex = lastWithData ? bands.indexOf(lastWithData) : -1;

  return (
    <div className="rounded-xl border border-edge bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold text-ink">The year so far</h2>
          <p className="mt-1 text-sm text-ink-muted">
            What each month cleared, and where the running total stands.
          </p>
        </div>
        <div className="text-right">
          <span className="block text-xs font-medium uppercase tracking-wider text-ink-faint">
            Year to date
          </span>
          <span
            className={
              "mt-1 block text-xl font-semibold tabular-nums " +
              (ytdNetSen < 0 ? "text-status-overdue-fg" : "text-status-ok-fg")
            }
          >
            {/* Never a negative number: magnitude, colour and a prefix. */}
            {ytdNetSen < 0 ? "−" : "+"}
            {formatSen(Math.abs(ytdNetSen))}
          </span>
        </div>
      </div>

      <div className="mt-5 flex gap-2">
        <div className="relative w-16 shrink-0 sm:w-20" style={{ height: PLOT_H }}>
          {scale.ticks.map((t) => (
            <span
              key={t}
              className="absolute right-0 -translate-y-1/2 text-[11px] tabular-nums text-ink-faint"
              style={{ top: scale.y(t) }}
            >
              {tickLabel(t)}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div className="relative w-full" style={{ height: PLOT_H }}>
            {scale.ticks.map((t) => (
              <div
                key={t}
                aria-hidden
                // The zero line reads stronger than the rest: every column is
                // measured from it, and the others are only reference.
                className={t === 0 ? "absolute h-px w-full bg-ink-faint/60" : "absolute h-px w-full bg-edge"}
                style={{ top: scale.y(t) }}
              />
            ))}

            {/*
              The selected month's backing band. It is drawn HERE, before the
              columns, and not as the button's own background -- the buttons
              are the last thing in the stack, so a filled button paints over
              the very column it selects and the selection reads as a column
              that has gone dim.
            */}
            {/*
              LIFTED off the surface, not sunk into it. `inset` is darker than
              `surface`, so using it here punched a black hole in the card and
              the selected month read as the one that had been switched off.
            */}
            <div
              aria-hidden
              className="absolute top-0 h-full rounded-lg bg-edge/50"
              style={{
                left: `${bands.findIndex((b) => b.key === selected) * bandPct}%`,
                width: `${bandPct}%`,
              }}
            />

            {bands.map((b, i) => {
              if (!b.point) return null;
              const value = b.point.netSen;
              const height = Math.max(Math.abs(scale.y(value) - zeroY), MIN_H);
              const up = value > 0;
              return (
                <div
                  key={b.key}
                  aria-hidden
                  className={
                    "absolute -translate-x-1/2 " +
                    (up
                      ? "rounded-t bg-status-ok-fg"
                      : "rounded-b bg-status-overdue-fg")
                  }
                  style={{
                    left: `${(i + 0.5) * bandPct}%`,
                    width: `min(${bandPct * COL_SHARE}%, ${COL_MAX_PX}px)`,
                    top: up ? zeroY - height : zeroY,
                    height,
                  }}
                />
              );
            })}

            {line.length > 1 && (
              <svg
                aria-hidden
                className="absolute inset-0 h-full w-full"
                viewBox={`0 0 100 ${PLOT_H}`}
                preserveAspectRatio="none"
              >
                <polyline
                  points={line.join(" ")}
                  fill="none"
                  stroke="currentColor"
                  className="text-ink-muted"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  // The viewBox is stretched to the container's width, which
                  // would smear the stroke without this.
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            )}

            {lastWithData?.point && (
              <span
                aria-hidden
                className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-muted ring-2 ring-surface"
                style={{
                  left: `${(lastIndex + 0.5) * bandPct}%`,
                  top: scale.y(lastWithData.point.cumulativeSen),
                }}
              />
            )}

            {bands.map((b, i) => (
              <button
                key={b.key}
                type="button"
                disabled={!b.point}
                onClick={() => onSelect(b.key)}
                aria-pressed={b.key === selected}
                aria-label={
                  b.point
                    ? `${b.label}: ${b.point.netSen < 0 ? "deficit" : "surplus"} ${formatSen(Math.abs(b.point.netSen))}`
                    : `${b.label}: no entries`
                }
                // Transparent, always: these sit on top of the marks purely to
                // catch the click. Hover and focus are drawn as a ring, which
                // is a box-shadow and covers nothing.
                className={
                  "absolute top-0 h-full rounded-lg transition focus:outline-none focus:ring-2 focus:ring-ink-muted " +
                  (b.point
                    ? "hover:ring-1 hover:ring-inset hover:ring-edge"
                    : "cursor-default")
                }
                style={{ left: `${i * bandPct}%`, width: `${bandPct}%` }}
              />
            ))}
          </div>

          <div className="mt-2 flex w-full">
            {bands.map((b) => (
              <span
                key={b.key}
                className={
                  "min-w-0 flex-1 text-center text-[11px] sm:text-xs " +
                  (b.key === selected
                    ? "font-semibold text-ink"
                    : b.point
                      ? "text-ink-muted"
                      : "text-ink-faint/60")
                }
              >
                {b.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-edge pt-3">
        <Key className="bg-status-ok-fg">Surplus, above the line</Key>
        <Key className="bg-status-overdue-fg">Deficit, below</Key>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-3.5 rounded-full bg-ink-muted" />
          <span className="text-xs text-ink-faint">Running total</span>
        </span>
        <span className="ml-auto text-xs text-ink-faint">
          Pick a month to break it down below.
        </span>
      </div>
    </div>
  );
}

function Key({ className, children }: { className: string; children: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className={"h-2.5 w-2.5 rounded-sm " + className} />
      <span className="text-xs text-ink-faint">{children}</span>
    </span>
  );
}
