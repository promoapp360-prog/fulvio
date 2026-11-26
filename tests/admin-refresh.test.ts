import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import AdminArea from "../client/src/pages/admin/AdminLayout";

function render(role: "admin" | "operator" | "customer" | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["me"], role ? { id: 999999, role, firstName: "Prova", permissions: [] } : null);
  client.setQueryData(["dashboard"], { counts: {} });
  try {
    return renderToStaticMarkup(createElement(QueryClientProvider, { client },
      createElement(Router, { ssrPath: "/admin/inesistente" }, createElement(AdminArea))));
  } finally { client.clear(); }
}

test("admin: Aggiorna visibile una volta anche per operatori, con target di almeno 44px", () => {
  for (const role of ["admin", "operator"] as const) {
    const html = render(role);
    assert.equal((html.match(/title="Aggiorna i dati della schermata"/g) || []).length, 1);
    assert.match(html, /<button[^>]*min-h-11[^>]*>.*?Aggiorna<\/button>/s);
  }
});

test("admin: Aggiorna non viene esposto a clienti o utenti non autenticati", () => {
  for (const role of ["customer", null] as const) assert.ok(!render(role).includes("Aggiorna i dati della schermata"));
});
