import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Settlements } from "../client/src/pages/admin/Staff";
import { todayISO, addDaysISO } from "../client/src/lib/format";
import { settlementWeek } from "../server/logic";
import { settlementTotals, settlementOutstanding } from "../shared/staff-settlements";

test("lo storico consente di annullare un pagamento anche fuori dalla settimana visualizzata", () => {
  const today = todayISO();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["settle-preview", today], { week: settlementWeek(today), operators: [] });
  qc.setQueryData(["settlements", addDaysISO(today, -90), today], [{
    id: 999999, operatorName: "Operatore sintetico", weekStart: addDaysISO(today, -14), weekEnd: addDaysISO(today, -8),
    status: "pagato", stato: "Pagato", hours: "2,00", minutes: 120, grossCents: 2400, adjustmentsCents: 0, totalCents: 2400,
  }]);
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(Settlements)));
  qc.clear();
  assert.ok(html.includes("Operatore sintetico"));
  assert.match(html, /<button\b[^>]*>Annulla pagamento<\/button>/, "Manca l’azione sul pagamento nello storico");
});

test("contabilità: storico annullato escluso da totali e residui, senza alterare importi originali", () => {
  const rows = [
    { status: "annullata", grossCents: 3000, adjustmentsCents: -500, totalCents: 2500 },
    { status: "pagato", grossCents: 3000, adjustmentsCents: -500, totalCents: 2500 },
    { status: "da_pagare", grossCents: 4000, adjustmentsCents: 500, totalCents: 4500 },
  ];
  assert.deepEqual(settlementTotals(rows), { grossCents: 7000, adjustmentsCents: 0, totalCents: 7000, paidCents: 2500, outstandingCents: 4500 });
  assert.equal(settlementOutstanding(rows[0]), 0);
  assert.equal(settlementOutstanding(rows[1]), 0);
  assert.equal(rows[0].totalCents, 2500);
});
