import { createECDH, timingSafeEqual } from "node:crypto";

/** Una chiave pubblica da sola NON rende attivo il servizio. Nessun valore segreto viene esposto. */
export function validateVapid(env: Record<string, string | undefined>) {
  try {
    const pub = env.VAPID_PUBLIC_KEY?.trim(), priv = env.VAPID_PRIVATE_KEY?.trim();
    if (!pub || !priv) return { configured: false, publicKey: null };
    const expected = Buffer.from(pub, "base64url"), privateKey = Buffer.from(priv, "base64url");
    if (expected.length !== 65 || privateKey.length !== 32) return { configured: false, publicKey: null };
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(privateKey);
    const actual = ecdh.getPublicKey();
    const configured = actual.length === expected.length && timingSafeEqual(actual, expected);
    return { configured, publicKey: configured ? pub : null };
  } catch { return { configured: false, publicKey: null }; }
}
export const pushConfiguration = validateVapid(process.env);

/** Accetta solo i servizi Web Push dei browser, non URL arbitrari da chiamare dal server. */
export function validPushEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") &&
      (url.hostname === "fcm.googleapis.com" || url.hostname.endsWith(".push.services.mozilla.com") ||
       url.hostname.endsWith(".push.apple.com") || url.hostname.endsWith(".notify.windows.com"));
  } catch { return false; }
}
