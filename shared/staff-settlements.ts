type SettlementAmount = { status: string; totalCents: number; grossCents: number; adjustmentsCents: number };
export const settlementOutstanding = (settlement: Pick<SettlementAmount, "status" | "totalCents">) =>
  settlement.status === "da_pagare" ? settlement.totalCents : 0;

/** Cancelled records retain their original amounts but never count as payable. */
export function settlementTotals(rows: readonly SettlementAmount[]) {
  return rows.reduce((totals, row) => {
    if (row.status === "annullata") return totals;
    totals.grossCents += row.grossCents;
    totals.adjustmentsCents += row.adjustmentsCents;
    totals.totalCents += row.totalCents;
    if (row.status === "pagato") totals.paidCents += row.totalCents;
    totals.outstandingCents += settlementOutstanding(row);
    return totals;
  }, { grossCents: 0, adjustmentsCents: 0, totalCents: 0, paidCents: 0, outstandingCents: 0 });
}
