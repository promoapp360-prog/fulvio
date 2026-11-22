import { post } from "./api";
import { deviceInfo, registerPwa } from "./pwa";

export const pushSupported = () => deviceInfo().push;
function keyBytes(base64: string) {
  const raw = atob(base64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - base64.length % 4) % 4));
  const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
  if (bytes.length !== 65 || bytes[0] !== 4) throw new Error("Configurazione notifiche non valida.");
  return bytes;
}
export async function pushStatus() {
  const reg = await registerPwa();
  const sub = await reg.pushManager.getSubscription();
  return post<{ configured: boolean; preference: boolean; subscribed: boolean }>("/api/account/push/status", { endpoint: sub?.endpoint || null });
}

/** Solo dal click esplicito. La richiesta permesso precede qualsiasi attesa di rete. */
export async function enablePush(publicKey: string | null) {
  if (!pushSupported()) throw new Error("Su iPhone apri prima l’app dalla schermata Home; negli altri casi usa un browser compatibile.");
  if (!publicKey) throw new Error("Le notifiche push non sono ancora configurate dal salone.");
  const applicationServerKey = keyBytes(publicKey);
  if (Notification.permission === "denied") throw new Error("Permesso bloccato: puoi modificarlo nelle impostazioni del browser.");
  const permissionRequest = Notification.permission === "granted" ? Promise.resolve("granted") : Notification.requestPermission();
  const permission = await permissionRequest;
  if (permission !== "granted") throw new Error("Notifiche non autorizzate. Puoi continuare a usare l’area personale.");
  const reg = await registerPwa();
  const old = await reg.pushManager.getSubscription();
  const subscription = old || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
  try { await post("/api/account/push/subscribe", subscription.toJSON()); }
  catch (error) {
    if (!old) await subscription.unsubscribe().catch(() => false);
    throw error;
  }
}

export async function disablePush(currentDeviceSubscribed: boolean) {
  await post("/api/account/push/disable");
  // Non tocca un'eventuale sottoscrizione locale appartenente a un altro utente.
  if (currentDeviceSubscribed && "serviceWorker" in navigator) {
    const reg = await navigator.serviceWorker.getRegistration();
    await (await reg?.pushManager.getSubscription())?.unsubscribe().catch(() => false);
  }
}
