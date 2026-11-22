export function deviceInfo() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || !!(navigator as Navigator & { standalone?: boolean }).standalone;
  return {
    ios, standalone,
    android: /android/i.test(navigator.userAgent),
    secure: window.isSecureContext,
    embedded: window.self !== window.top,
    push: window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && (!ios || standalone),
  };
}

let registration: Promise<ServiceWorkerRegistration> | undefined;
export function registerPwa() {
  if (!window.isSecureContext || !("serviceWorker" in navigator)) return Promise.reject(new Error("Apri il sito con una connessione HTTPS in un browser compatibile."));
  if (!registration) {
    registration = navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then(async (reg) => {
      const ready = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("L’app non è ancora pronta. Riprova tra poco.")), 12000)),
      ]);
      window.dispatchEvent(new Event("dp:pwa-ready"));
      return ready || reg;
    }).catch(error => { registration = undefined; throw error; });
  }
  return registration;
}
