/** Nessun ricaricamento automatico: l'utente può avere una richiesta non inviata. */
export function watchPwaUpdates(
  registration: Pick<ServiceWorkerRegistration, "update">,
  onUpdate: () => void,
  environment = {
    worker: navigator.serviceWorker,
    page: document,
    browser: window,
    online: () => navigator.onLine,
  },
) {
  let controlled = !!environment.worker.controller;
  let checking = false;
  let stopped = false;
  const check = async () => {
    if (stopped || checking || environment.page.visibilityState !== "visible" || !environment.online()) return;
    checking = true;
    try { await registration.update(); } catch { /* Offline o pubblicazione in corso: riprova al prossimo controllo. */ }
    finally { checking = false; }
  };
  const changed = () => {
    if (controlled) onUpdate();
    controlled = true; // La prima installazione non è un aggiornamento.
  };
  environment.worker.addEventListener("controllerchange", changed);
  environment.page.addEventListener("visibilitychange", check);
  environment.browser.addEventListener("online", check);
  const interval = environment.browser.setInterval(check, 5 * 60_000);
  void check();
  return () => {
    stopped = true;
    environment.browser.clearInterval(interval);
    environment.worker.removeEventListener("controllerchange", changed);
    environment.page.removeEventListener("visibilitychange", check);
    environment.browser.removeEventListener("online", check);
  };
}
