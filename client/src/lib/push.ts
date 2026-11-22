import { get, post } from "./api";

export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function urlB64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** Chiede il permesso e registra la sottoscrizione push dell'utente collegato. */
export async function enablePush() {
  if (!pushSupported()) throw new Error("Notifiche non supportate su questo dispositivo");
  const s = await get<any>("/api/public/settings");
  if (!s.pushPublicKey) throw new Error("Le notifiche push non sono ancora configurate dal salone");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Permesso negato: abilita le notifiche nelle impostazioni del browser");
  const reg = (await navigator.serviceWorker.getRegistration()) || (await navigator.serviceWorker.register("/sw.js"));
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(s.pushPublicKey) }));
  await post("/api/account/push/subscribe", sub.toJSON());
}
