import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, refetchOnWindowFocus: false, retry: (n, e: any) => n < 1 && !(e?.status >= 400 && e?.status < 500) },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);

if ("serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" })
        .then((registration) => registration.update())
        .catch(() => console.warn("Aggiornamento PWA non disponibile: riproveremo al prossimo avvio."));
    });
  } else {
    // Rimuove solo un eventuale worker Dog's Planet, senza toccare altre app,
    // sessioni, consensi, carrelli o dati. Nessun reload forzato sui moduli aperti.
    navigator.serviceWorker.getRegistrations().then(async (registrations) => {
      await Promise.all(registrations.filter((registration) => {
        const worker = registration.active || registration.waiting || registration.installing;
        return worker && new URL(worker.scriptURL).origin === location.origin && new URL(worker.scriptURL).pathname === "/sw.js";
      }).map((registration) => registration.unregister()));
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith("dp-")).map((key) => caches.delete(key)));
    }).catch(() => console.warn("Pulizia cache anteprima non disponibile."));
  }
}
