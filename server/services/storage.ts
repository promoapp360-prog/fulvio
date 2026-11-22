// Storage file: Replit Object Storage se configurato (persistente anche nei deploy), altrimenti cartella locale ./uploads.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";

const LOCAL_DIR = path.resolve(process.cwd(), "uploads");
let objectClient: any = null;

async function client() {
  if (!process.env.REPLIT_OBJECT_BUCKET && !process.env.REPLIT_DEFAULT_BUCKET_ID) return null;
  if (objectClient) return objectClient;
  const mod: any = await import("@replit/object-storage");
  objectClient = new mod.Client(process.env.REPLIT_OBJECT_BUCKET ? { bucketId: process.env.REPLIT_OBJECT_BUCKET } : undefined);
  return objectClient;
}

export type StoredFile = { key: string; url: string; mime: string; size: number; width?: number; height?: number };

/** Ottimizza le immagini (max 1600px, WebP) prima di salvarle: niente file pesanti. */
export async function storeUpload(buffer: Buffer, mime: string, folder = "media"): Promise<StoredFile> {
  let out = buffer; let outMime = mime; let ext = (mime.split("/")[1] || "bin").replace("jpeg", "jpg");
  let width: number | undefined; let height: number | undefined;
  if (mime.startsWith("image/") && !mime.includes("svg") && !mime.includes("gif")) {
    const img = sharp(buffer, { failOn: "none" }).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true });
    out = await img.webp({ quality: 80 }).toBuffer();
    const meta = await sharp(out).metadata();
    width = meta.width; height = meta.height; outMime = "image/webp"; ext = "webp";
  }
  const key = `${folder}/${new Date().toISOString().slice(0, 7)}/${crypto.randomBytes(10).toString("hex")}.${ext}`;
  const c = await client();
  if (c) {
    const r = await c.uploadFromBytes(key, out);
    if (r && r.ok === false) throw new Error("Upload su Object Storage non riuscito");
  } else {
    const full = path.join(LOCAL_DIR, key);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, out);
  }
  return { key, url: `/files/${key}`, mime: outMime, size: out.length, width, height };
}

export async function readStored(key: string): Promise<Buffer | null> {
  if (key.includes("..")) return null;
  const c = await client();
  if (c) {
    const r = await c.downloadAsBytes(key);
    if (!r || r.ok === false) return null;
    const v = r.value;
    return Array.isArray(v) ? v[0] : v;
  }
  const full = path.join(LOCAL_DIR, key);
  if (!full.startsWith(LOCAL_DIR) || !fs.existsSync(full)) return null;
  return fs.readFileSync(full);
}

export async function deleteStored(key: string) {
  const c = await client();
  if (c) await c.delete(key).catch(() => {});
  else fs.rmSync(path.join(LOCAL_DIR, key), { force: true });
}
