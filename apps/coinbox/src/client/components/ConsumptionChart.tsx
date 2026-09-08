import { useState, type ReactNode } from "react";
import { formatSen } from "@portals/core";
import { senPerLitre } from "@shared/fuelRules";
import type { FuelFill } from "../api/hooks";

/**
 * Consumption over the life of the series, with price per litre beneath it.
 *
 * ===========================================================================
 * TWO PLOTS, NOT ONE PLOT WITH TWO SCALES
 * ===========================================================================
 *
 * L/100km and RM/litre are different units with unrelated ranges. Drawn on one
 * pair of axes they could be scaled to appear to rise together, or to diverge,
 * entirely at the author's discretion -- so this is two stacked charts sharing
 * an x-axis, each with its own labelled y-axis and its own baseline. The same
 * rule is why YearChart puts its columns and its running total on ONE axis:
 * there, both series are money, so a second scale would have been the lie.
 *
 * The bands are shared so a point in the price strip sits directly under the
 * fill it belongs to, and one hover highlights both.
 *
 * ===========================================================================
 * WHY THE MARKS ARE NEUTRAL RATHER THAN RED AND GREEN
 * ===========================================================================
 *
 * Higher consumption is worse, so tinting points above the average with the
 * overdue colour is tempting. It is not done, for two reasons: the status
 * palette is reserved for states that ship with a word beside them, and at two
 * or three segments a point above the mean is noise, not a verdict. The
 * trailing mean carries the trend instead, which is the honest amount of
 * interpretation this much data supports.
 */

/** Plot heights. The price strip is deliberately subordinate. */
const PLOT_H = 200;
const PRICE_H = 72;

/** How many measured segments the trailing mean covers. */
const TRAIL = 3;

/** Marker radius. 8px across, the floor at which a dot is a reliable target. */
const DOT_R = 4;

/** Axis ticks land on round numbers, not on whatever the extremes happen to be. */
function niceStep(range: number): number {
  const rough = range / 4;
  const mag = 10 ** Math.floor(Math.log10(Math.max(rough, 1e-6)));
  for (const mult of [1, 2, 2.5, 5, 10]) {
    if (mag * mult >= rough) return mag * mult;
  }
  return mag * 10;
}

interface Scale {
  ticks: number[];
  y: (v: number) => number;
}

/**
 * A scale that does NOT force zero.
 *
 * Consumption lives in a narrow band -- a car that does 7.5 and a car that does
 * 9.0 are meaningfully different, and anchoring at zero flattens that into one
 * indistinguishable line near the top. Zero-baselining is the rule for bars,
 * whose length encodes the value; this is a line, where position does.
 */
function buildScale(values: number[], height: number): Scale {
  const rawMax = Math.max(...values);
  const rawMin = Math.min(...values);
  const step = niceStep(rawMax - rawMin || rawMax || 1);

  const max = Math.ceil(rawMax / step) * step;
  const min = Math.max(0, Math.floor(rawMin / step) * step);
  const span = max - min || 1;

  const ticks: number[] = [];
  for (let t = min; t <= max + step / 100; t += step) ticks.push(t);

  return { ticks, y: (v) => ((max - v) / span) * height };
}

/** Trailing mean over the last TRAIL measured points, in series order. */
function trailingMean(series: (number | null)[]): (number | null)[] {
  const seen: number[] = [];
  return series.map((v) => {
    if (v === null) return null;
    seen.push(v);
    const window = seen.slice(-TRAIL);
    return window.reduce((a, b) => a + b, 0) / window.length;
  });
}

/** Points for a polyline, skipping bands with no value. Percent x, pixel y. */
function polyline(
  values: (number | null)[],
  bandPct: number,
  y: (v: number) => number,
): string {
  return values
    .map((v, i) => (v === null ? null : `${(i + 0.5) * bandPct},${y(v)}`))
    .filter((p): p is string => p !== null)
    .join(" ");
}

export function ConsumptionChart({ fills }: { fills: FuelFill[] }) {
  // The API returns newest first, by odometer. A chart reads left to right in
  // time, so it is reversed here rather than sorted again -- the server already
  // decided the order, on the odometer axis, and re-sorting by date in the
  // client would quietly disagree with it for a backdated entry.
  const points = [...fills].reverse();
  const [hover, setHover] = useState<number | null>(null);

  const consumption = points.map((f) => f.lPer100km);
  const prices = points.map((f) => senPerLitre(f.amountSen, f.litresMilli));

  const measured = consumption.filter((v): v is number => v !== null);
  const pricePoints = prices.filter((v): v is number => v !== null);

  if (measured.length < 2) {
    return <NotEnoughYet fills={fills} />;
  }

  const mean = trailingMean(consumption);
  const bandPct = 100 / points.length;

  const cScale = buildScale([...measured, ...mean.filter((v): v is number => v !== null)], PLOT_H);
  const pScale = pricePoints.length > 0 ? buildScale(pricePoints, PRICE_H) : null;

  const active = hover !== null ? points[hover] : null;

  return (
    <div className="rounded-xl border border-edge bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-ink">Consumption</h3>
          <p className="mt-1 text-sm text-ink-muted">
            Litres per 100 km, one point per tank.
          </p>
        </div>
        {/* Direct readout instead of a number on every point. */}
        <div className="text-right text-sm tabular-nums" aria-live="polite">
          {active ? (
            <>
              <span className="block text-ink">{active.filledOn}</span>
              <span className="block text-ink-muted">
                {active.lPer100km === null
                  ? "no figure — part fill"
                  : `${active.lPer100km.toFixed(1)} L/100km`}
              </span>
            </>
          ) : (
            <span className="block text-ink-faint">Hover a fill for detail</span>
          )}
        </div>
      </div>

      {/* ---------------------------------------------------- consumption */}
      <div className="mt-4 flex gap-2">
        <YAxis ticks={cScale.ticks} y={cScale.y} height={PLOT_H} format={(t) => t.toFixed(1)} />

        <div className="min-w-0 flex-1">
          <div className="relative w-full" style={{ height: PLOT_H }}>
            <Grid ticks={cScale.ticks} y={cScale.y} />

            {hover !== null && (
              <div
                aria-hidden
                className="absolute top-0 h-full rounded bg-edge/50"
                style={{ left: `${hover * bandPct}%`, width: `${bandPct}%` }}
              />
            )}

            <svg
              aria-hidden
              className="absolute inset-0 h-full w-full"
              viewBox={`0 0 100 ${PLOT_H}`}
              preserveAspectRatio="none"
            >
              {/* The trailing mean sits BEHIND the data it summarises. */}
              <polyline
                points={polyline(mean, bandPct, cScale.y)}
                fill="none"
                stroke="currentColor"
                className="text-ink-faint"
                strokeWidth={2}
                strokeDasharray="5 4"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
              {/*
                Consecutive measured points are joined even when a part fill
                sits between them on the x-axis. That is not a gap being papered
                over: a part fill is not a missing measurement, it is fuel
                counted towards the segment that follows it.
              */}
              <polyline
                points={polyline(consumption, bandPct, cScale.y)}
                fill="none"
                stroke="currentColor"
                className="text-ink"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>

            {points.map((f, i) => {
              const v = consumption[i];
              if (v === null || v === undefined) return null;
              return (
                <span
                  key={f.id}
                  aria-hidden
                  // ring-surface is the 2px gap that keeps a dot legible where
                  // it lands on top of the mean line.
                  className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink ring-2 ring-surface transition-[width,height]"
                  style={{
                    left: `${(i + 0.5) * bandPct}%`,
                    top: cScale.y(v),
                    width: hover === i ? DOT_R * 2 + 4 : DOT_R * 2,
                    height: hover === i ? DOT_R * 2 + 4 : DOT_R * 2,
                  }}
                />
              );
            })}

            <HitBands
              points={points}
              bandPct={bandPct}
              onHover={setHover}
              label={(f) =>
                `${f.filledOn}: ${
                  f.lPer100km === null
                    ? "part fill, no consumption figure"
                    : `${f.lPer100km.toFixed(1)} litres per 100 kilometres`
                }`
              }
            />
          </div>
        </div>
      </div>

      {/* --------------------------------------------------- price strip */}
      {pScale && (
        <div className="mt-5 border-t border-edge pt-4">
          <div className="flex items-baseline justify-between gap-3">
            <h4 className="text-sm font-medium text-ink">Price per litre</h4>
            <span className="text-sm tabular-nums text-ink-muted">
              {active
                ? (() => {
                    const p = senPerLitre(active.amountSen, active.litresMilli);
                    return p === null ? "—" : `${formatSen(p)}/L`;
                  })()
                : ""}
            </span>
          </div>

          <div className="mt-2 flex gap-2">
            <YAxis
              ticks={pScale.ticks}
              y={pScale.y}
              height={PRICE_H}
              format={(t) => (t / 100).toFixed(2)}
            />
            <div className="min-w-0 flex-1">
              <div className="relative w-full" style={{ height: PRICE_H }}>
                <Grid ticks={pScale.ticks} y={pScale.y} />

                {hover !== null && (
                  <div
                    aria-hidden
                    className="absolute top-0 h-full rounded bg-edge/50"
                    style={{ left: `${hover * bandPct}%`, width: `${bandPct}%` }}
                  />
                )}

                <svg
                  aria-hidden
                  className="absolute inset-0 h-full w-full"
                  viewBox={`0 0 100 ${PRICE_H}`}
                  preserveAspectRatio="none"
                >
                  <polyline
                    points={polyline(prices, bandPct, pScale.y)}
                    fill="none"
                    stroke="currentColor"
                    className="text-ink-muted"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>

                <HitBands
                  points={points}
                  bandPct={bandPct}
                  onHover={setHover}
                  label={(f) => {
                    const p = senPerLitre(f.amountSen, f.litresMilli);
                    return `${f.filledOn}: ${p === null ? "no price recorded" : `${formatSen(p)} per litre`}`;
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Two lines on the upper plot, so identity is never colour alone. */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-edge pt-3">
        <Key className="bg-ink">Each tank</Key>
        <Key className="bg-ink-faint" dashed>
          Average of the last {TRAIL} tanks
        </Key>
        <span className="ml-auto text-xs text-ink-faint">
          {points.length} fills &middot; {measured.length} measured
        </span>
      </div>
    </div>
  );
}

function YAxis({
  ticks,
  y,
  height,
  format,
}: {
  ticks: number[];
  y: (v: number) => number;
  height: number;
  format: (t: number) => string;
}) {
  return (
    <div className="relative w-9 shrink-0 sm:w-11" style={{ height }}>
      {ticks.map((t) => (
        <span
          key={t}
          className="absolute right-0 -translate-y-1/2 text-[11px] tabular-nums text-ink-faint"
          style={{ top: y(t) }}
        >
          {format(t)}
        </span>
      ))}
    </div>
  );
}

/** Recessive reference lines. Never competing with the marks. */
function Grid({ ticks, y }: { ticks: number[]; y: (v: number) => number }) {
  return (
    <>
      {ticks.map((t) => (
        <div
          key={t}
          aria-hidden
          className="absolute h-px w-full bg-edge"
          style={{ top: y(t) }}
        />
      ))}
    </>
  );
}

/**
 * Transparent buttons over the marks, one per band.
 *
 * Bigger than the dots on purpose: a 8px marker is a poor target, and the band
 * is the whole column. They carry the aria-label, so a screen reader gets the
 * values a sighted reader gets from the hover readout.
 */
function HitBands({
  points,
  bandPct,
  onHover,
  label,
}: {
  points: FuelFill[];
  bandPct: number;
  onHover: (i: number | null) => void;
  label: (f: FuelFill) => string;
}) {
  return (
    <>
      {points.map((f, i) => (
        <button
          key={f.id}
          type="button"
          aria-label={label(f)}
          onMouseEnter={() => onHover(i)}
          onMouseLeave={() => onHover(null)}
          onFocus={() => onHover(i)}
          onBlur={() => onHover(null)}
          className="absolute top-0 h-full rounded focus:outline-none focus:ring-2 focus:ring-ink-muted"
          style={{ left: `${i * bandPct}%`, width: `${bandPct}%` }}
        />
      ))}
    </>
  );
}

function Key({
  className,
  dashed = false,
  children,
}: {
  className: string;
  dashed?: boolean;
  children: ReactNode;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        aria-hidden
        className={`h-0.5 w-4 rounded-full ${className} ${dashed ? "opacity-70" : ""}`}
      />
      <span className="text-xs text-ink-faint">{children}</span>
    </span>
  );
}

/**
 * Fewer than two measured segments is not an error and not an empty chart --
 * it is a series that has not started yet, and saying so is more useful than
 * drawing one dot.
 */
function NotEnoughYet({ fills }: { fills: FuelFill[] }) {
  const full = fills.filter((f) => f.isFullTank === 1).length;
  return (
    <div className="rounded-xl border border-edge bg-surface p-6">
      <h3 className="font-semibold text-ink">Consumption</h3>
      <p className="mt-2 text-sm text-ink-muted">
        {fills.length === 0
          ? "No fill-ups recorded yet."
          : full === 0
            ? "Only part fills so far. Consumption can only be measured between two full tanks."
            : "One full tank recorded. The first figure appears at the next one."}
      </p>
      <p className="mt-2 text-sm text-ink-faint">
        Log one when you add the expense: pick this vehicle, tick
        &ldquo;Refueling&rdquo;, and key in the odometer and litres.
      </p>
    </div>
  );
}
