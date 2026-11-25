import { get, post } from "./api";

type OneSignalClient = {
  init(options: Record<string, unknown>): Promise<void>;
  login(externalId: string): Promise<void>;
  logout(): Promise<void>;
  Notifications: { requestPermission(): Promise<boolean>; isPushSupported(): boolean; permission: boolean };
  User: { PushSubscription: { id?: string | null; optedIn: boolean; optIn(): Promise<void>; optOut(): Promise<void> } };
};

declare global {
  interface Window { OneSignalDeferred?: Array<(sdk: OneSignalClient) => void>; }
}

let sdkPromise: Promise<OneSignalClient> | null = null;

async function loadSdk(userId: number) {
  const config = await get("/api/public/onesignal/config");
  if (!config?.configured || !config.appId) throw new Error("OneSignal non è ancora configurato per il dominio pubblico.");
  if (!sdkPromise) {
    sdkPromise = new Promise<OneSignalClient>((resolve, reject) => {
      window.OneSignalDeferred = window.OneSignalDeferred || [];
      let settled = false;
      window.OneSignalDeferred.push(async (sdk) => {
        try {
          await sdk.init({
            appId: config.appId,
            safari_web_id: config.safariWebId,
            serviceWorkerPath: "push/onesignal/OneSignalSDKWorker.js",
            serviceWorkerParam: { scope: "/push/onesignal/" },
            notifyButton: { enable: false },
            autoResubscribe: false,
          });
          if (!settled) { settled = true; resolve(sdk); }
        } catch (error) { if (!settled) { settled = true; reject(error); } }
      });
      let script = document.querySelector<HTMLScriptElement>('script[data-onesignal-sdk="true"]');
      if (!script) {
        script = document.createElement("script");
        script.src = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
        script.defer = true; script.dataset.onesignalSdk = "true";
        script.onerror = () => { if (!settled) { settled = true; sdkPromise = null; reject(new Error("Non riesco a caricare il servizio notifiche.")); } };
        document.head.appendChild(script);
      }
      window.setTimeout(() => { if (!settled) { settled = true; sdkPromise = null; reject(new Error("OneSignal non ha risposto. Riprova più tardi.")); } }, 15_000);
    });
  }
  const sdk = await sdkPromise;
  await sdk.login(String(userId));
  return sdk;
}

export async function oneSignalStatus(userId: number) {
  const status = await post("/api/account/push/onesignal/status");
  if (status.configured && status.preference && status.subscribed) {
    const sdk = await loadSdk(userId).catch(() => null);
    if (sdk && !sdk.User.PushSubscription.optedIn) return { ...status, subscribed: false };
  }
  return status;
}

export async function enableOneSignal(userId: number) {
  const config = await get("/api/public/onesignal/config");
  if (!config?.enabled) throw new Error("Le notifiche OneSignal non sono attive per il sito.");
  const sdk = await loadSdk(userId);
  if (!sdk.Notifications.isPushSupported()) throw new Error("Questo browser non supporta le notifiche push.");
  const allowed = await sdk.Notifications.requestPermission();
  if (!allowed) throw new Error("Notifiche non autorizzate. Puoi continuare a usare l’area personale.");
  await sdk.User.PushSubscription.optIn();
  let subscriptionId = sdk.User.PushSubscription.id;
  for (let i = 0; !subscriptionId && i < 20; i++) {
    await new Promise(resolve => setTimeout(resolve, 250));
    subscriptionId = sdk.User.PushSubscription.id;
  }
  if (!subscriptionId) throw new Error("Il browser non ha ancora creato una sottoscrizione OneSignal.");
  const registration = await navigator.serviceWorker.getRegistration("/");
  const oldSubscription = await registration?.pushManager.getSubscription();
  await post("/api/account/push/onesignal/subscribe", {
    subscriptionId,
    ...(oldSubscription?.endpoint ? { endpoint: oldSubscription.endpoint } : {}),
  });
  if (oldSubscription) await oldSubscription.unsubscribe().catch(() => false);
}

export async function disableOneSignal() {
  if (sdkPromise) {
    const sdk = await sdkPromise.catch(() => null);
    if (sdk) await sdk.User.PushSubscription.optOut().catch(() => {});
  }
  await post("/api/account/push/disable");
}

export async function logoutOneSignal() {
  if (!sdkPromise) return;
  const sdk = await sdkPromise.catch(() => null);
  if (sdk) await sdk.logout().catch(() => {});
}
