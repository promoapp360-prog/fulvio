import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./index.css";
import { registerPwa } from "./lib/pwa";
import PwaUpdate from "./components/PwaUpdate";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, refetchOnWindowFocus: false, retry: (n, e: any) => n < 1 && !(e?.status >= 400 && e?.status < 500) },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <PwaUpdate />
    </QueryClientProvider>
  </React.StrictMode>,
);

if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    registerPwa().catch(() => console.warn("Installazione PWA non disponibile in questo contesto browser."));
  });
}
