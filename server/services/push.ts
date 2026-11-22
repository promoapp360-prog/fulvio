import webpush from "web-push";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { pushSubscriptions } from "../../shared/schema";
import { BUSINESS } from "../../shared/constants";

const enabled = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
if (enabled) webpush.setVapidDetails(`mailto:${BUSINESS.email}`, process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);

export const pushEnabled = () => enabled;

export async function pushToUsers(userIds: number[], payload: { title: string; body?: string; url?: string }) {
  if (!enabled || userIds.length === 0) return 0;
  const subs = await db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, userIds));
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 60 * 60 * 24 });
      sent++;
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
    }
  }
  return sent;
}
