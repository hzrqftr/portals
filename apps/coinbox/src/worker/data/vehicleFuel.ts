import {
  fuelSegmentSql,
  mapFuelSegment,
  type FuelSegmentRaw,
  type FuelSegmentRow,
} from "@portals/core/worker";
import { LedgerScopedRepo } from "./base";

/**
 * The fuel drill-down behind a row of the fuel consumption card.
 *
 * ===========================================================================
 * THE SECOND CROSS-PORTAL READ IN THIS PORTAL, AND WHY IT NEEDS TWO GUARDS
 * ===========================================================================
 *
 * The consumption card is the other. This one reads further into Odometry -- every
 * fill for a vehicle, with the litres a garage co-member is entitled to see --
 * and joins Coinbox's own money to it, which they are NOT. So the two guards
 * are not belt and braces; they answer two different questions, and each has
 * to be removable on its own for the isolation suite to prove either:
 *
 *   1. `assertUsableVehicle()` -- a `garage_members` join for THIS caller. It
 *      decides whether the vehicle exists at all as far as they are concerned,
 *      and it returns the garage id off the vehicle row, in the same statement
 *      that authorised it. Never off the scope, which has no garageId and must
 *      never grow one. Remove this and a stranger reads a stranger's fills.
 *   2. `t.ledger_id = ?` on EVERY money join. Remove this and a co-member --
 *      someone legitimately in the garage, who can already see the car in
 *      Odometry -- reads what the owner paid at the pump. That is the exact
 *      leak the two-axis design exists to prevent.
 *
 * `fuel_fills` carries no cost column, on purpose (migration 0013). The price
 * here is derived by joining this ledger's own transactions to the fill, which
 * is why Odometry can never show one and this can.
 */

/** A fill, plus what it cost -- null when the money is not this ledger's. */
export interface FuelFillWithCost extends FuelSegmentRow {
  /**
   * Null for two different reasons that both mean "no price to show": the fill
   * was logged with no ledger entry behind it, or the entry belongs to someone
   * else in the garage. Neither is an error, and they are deliberately not
   * distinguishable here -- saying which would itself leak that the other
   * person has an entry.
   */
  amountSen: number | null;
}

export interface FuelTotals {
  fillCount: number;
  /** Segments with a figure. Always <= fillCount, and often far less at first. */
  measuredCount: number;
  /** Litres bought across every fill, whatever the tank state. */
  litresMilli: number;
  /** Distance across CLOSED segments only -- what the average is divided by. */
  segmentDistanceKm: number;
  segmentLitresMilli: number;
  /** Distance-weighted, not the mean of the per-segment rates. */
  avgLPer100km: number | null;
  avgKmPerLitre: number | null;
  /** Spend on fills that are this ledger's, all time. */
  fuelSpendSen: number;
  /** Averaged over litres, so a big fill counts for more than a splash. */
  avgSenPerLitre: number | null;
  latestSenPerLitre: number | null;
}

export interface VehicleFuel {
  vehicleId: string;
  fills: FuelFillWithCost[];
  totals: FuelTotals;
}

/**
 * BIND ORDER IS POSITIONAL IN THE STATEMENT TEXT.
 *
 * `fuelSegmentSql`'s own CTE comes first and takes (vehicleId, garageId); the
 * ledger id belongs to the LEFT JOIN below, which appears after it. Reorder
 * these and the statement compares a ledger id against a garage id and quietly
 * returns rows with no prices at all -- which reads as "nothing was logged"
 * rather than as a bug.
 */
const FILLS_SQL = fuelSegmentSql({
  extraSelect: ", t.amount_sen AS amount_sen",
  // LEFT JOIN, with the ledger predicate in the ON clause rather than a WHERE.
  // In a WHERE it silently becomes an inner join and drops every fill that is
  // not this ledger's -- hiding a co-member's fills entirely instead of showing
  // them without a price.
  extraJoin: "LEFT JOIN transactions t ON t.id = seg.transaction_id AND t.ledger_id = ?",
});

/**
 * Totals over the same segments, aggregated in SQL rather than looped over in
 * the Worker (invariant 4).
 *
 * SQLite allows a WITH inside a FROM subquery -- checked against the real local
 * D1, not assumed -- which is what lets the segment CTE be reused whole rather
 * than restated here, where a second copy could drift from the first.
 *
 * `COUNT(l_per_100km)` counts non-null values, so it is the number of CLOSED
 * segments rather than the number of fills. That distinction is the whole
 * reason `is_full_tank` exists.
 */
const TOTALS_SQL = `
SELECT COUNT(*)                                               AS fill_count,
       COUNT(f.l_per_100km)                                   AS measured_count,
       COALESCE(SUM(f.litres_milli), 0)                       AS litres_milli,
       COALESCE(SUM(CASE WHEN f.l_per_100km IS NOT NULL
                         THEN f.distance_km END), 0)          AS segment_km,
       COALESCE(SUM(CASE WHEN f.l_per_100km IS NOT NULL
                         THEN f.segment_litres_milli END), 0) AS segment_litres_milli,
       COALESCE(SUM(f.amount_sen), 0)                         AS fuel_spend_sen,
       COALESCE(SUM(CASE WHEN f.amount_sen IS NOT NULL
                         THEN f.litres_milli END), 0)         AS priced_litres_milli
  FROM (${FILLS_SQL}) f
`;

export class VehicleFuelRepo extends LedgerScopedRepo {
  async load(vehicleId: string): Promise<VehicleFuel> {
    // GUARD 1. Throws NotFound -- never Forbidden, which would confirm the id
    // exists somewhere. The garage id it returns is the one this query proved
    // the caller into, and it is what every statement below binds.
    const { garageId } = await this.assertUsableVehicle(vehicleId);

    const [fills, totals] = await Promise.all([
      this.fills(vehicleId, garageId),
      this.totals(vehicleId, garageId),
    ]);

    // The newest priced fill, for "what it costs at the pump lately". Taken
    // from the ordered list rather than re-queried, because `fills` is already
    // sorted by odometer descending and a second query could disagree with it.
    const latest = fills.find((f) => f.amountSen !== null && f.litresMilli > 0);
    totals.latestSenPerLitre =
      latest && latest.amountSen !== null
        ? Math.round(latest.amountSen / (latest.litresMilli / 1000))
        : null;

    return { vehicleId, fills, totals };
  }

  private async fills(vehicleId: string, garageId: string): Promise<FuelFillWithCost[]> {
    const res = await this.raw
      .prepare(FILLS_SQL)
      // vehicle, garage, ledger -- the order they appear in the statement text.
      .bind(vehicleId, garageId, this.ledgerId)
      .all<FuelSegmentRaw & { amount_sen: number | null }>();

    return res.results.map((r) => ({ ...mapFuelSegment(r), amountSen: r.amount_sen }));
  }

  private async totals(vehicleId: string, garageId: string): Promise<FuelTotals> {
    const r = await this.raw
      .prepare(TOTALS_SQL)
      .bind(vehicleId, garageId, this.ledgerId)
      .first<{
        fill_count: number;
        measured_count: number;
        litres_milli: number;
        segment_km: number;
        segment_litres_milli: number;
        fuel_spend_sen: number;
        priced_litres_milli: number;
      }>();

    const km = r?.segment_km ?? 0;
    const segLitres = r?.segment_litres_milli ?? 0;
    const spend = r?.fuel_spend_sen ?? 0;
    const pricedLitres = r?.priced_litres_milli ?? 0;

    // Every division below is guarded rather than tidied up. A vehicle with one
    // fill has closed no segment, and two fills at one odometer is a real
    // data-entry outcome. Null is the honest answer; the UI renders a dash.
    const avgLPer100km = km > 0 ? ((segLitres / 1000) * 100) / km : null;

    return {
      fillCount: r?.fill_count ?? 0,
      measuredCount: r?.measured_count ?? 0,
      litresMilli: r?.litres_milli ?? 0,
      segmentDistanceKm: km,
      segmentLitresMilli: segLitres,
      avgLPer100km,
      avgKmPerLitre: avgLPer100km !== null && avgLPer100km > 0 ? 100 / avgLPer100km : null,
      fuelSpendSen: spend,
      // Weighted by litres, not the mean of the per-fill prices: a 45-litre
      // fill and a 5-litre splash are not two equal observations of the price.
      avgSenPerLitre: pricedLitres > 0 ? Math.round(spend / (pricedLitres / 1000)) : null,
      latestSenPerLitre: null, // set in load(), from the ordered fills
    };
  }

}
