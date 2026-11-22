// Storage file: Replit Object Storage se configurato (persistente anche nei deploy), altrimenti cartella locale ./uploads.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";

const LOCAL_DIR = path.resolve(process.cwd(), "uploads");
let objectClient: any = null;

async function client() {
  const bucketId = process.env.REPLIT_OBJECT_BUCKET || process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || process.env.REPLIT_DEFAULT_BUCKET_ID;
  if (!bucketId) return null;
  if (objectClient) return objectClient;
  const mod: any = await import("@replit/object-storage");
  objectClient = new mod.Client({ bucketId });
  return objectClient;
}

export type StoredFile = { key: string; url: string; mime: string; size: number; width?: number; height?: number };

async function persist(buffer: Buffer, folder: string, ext: string) {
  const key = `${folder}/${new Date().toISOString().slice(0, 7)}/${crypto.randomBytes(24).toString("hex")}.${ext}`;
  const c = await client();
  if (c) {
    const r = await c.uploadFromBytes(key, buffer);
    if (r && r.ok === false) throw new Error("Upload su Object Storage non riuscito");
  } else {
    const full = path.join(LOCAL_DIR, key);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, buffer);
  }
  return key;
}

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
  const key = await persist(out, folder, ext);
  return { key, url: `/files/${key}`, mime: outMime, size: out.length, width, height };
}

/** Foto cane solo JPEG/PNG/WebP, ruotata secondo EXIF, WebP e <=1 MB. */
export async function storeDogPhoto(buffer: Buffer, mime: string): Promise<StoredFile> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) throw new Error("Carica una foto JPG, PNG o WebP.");
  if (!await client()) throw new Error("Lo spazio privato per le foto dei cani non è configurato.");
  const source = sharp(buffer, { failOn: "error", limitInputPixels: 24_000_000 });
  const meta = await source.metadata();
  if (!["jpeg", "png", "webp"].includes(meta.format || "") || !meta.width || !meta.height) throw new Error("Il file non è una foto valida.");
  let output: Buffer | null = null, width = 0, height = 0;
  for (const maxWidth of [1600, 1280, 960]) {
    const pipeline = sharp(buffer, { failOn: "error", limitInputPixels: 24_000_000 })
      .rotate().resize({ width: maxWidth, height: maxWidth, fit: "inside", withoutEnlargement: true });
    for (const quality of [78, 68, 58, 48]) {
      const candidate = await pipeline.clone().webp({ quality, effort: 4 }).toBuffer({ resolveWithObject: true });
      if (!output || candidate.data.length < output.length) { output = candidate.data; width = candidate.info.width; height = candidate.info.height; }
      if (candidate.data.length <= 950_000) { output = candidate.data; width = candidate.info.width; height = candidate.info.height; break; }
    }
    if (output && output.length <= 950_000) break;
  }
  if (!output || output.length > 1_000_000) throw new Error("La foto non può essere compressa sotto 1 MB.");
  const key = await persist(output, "dog-photos", "webp");
  return { key, url: "", mime: "image/webp", size: output.length, width, height };
}

export async function readStored(key: string): Promise<Buffer | null> {
  if (key.includes("..") || key.startsWith("/") || key.includes("\\")) return null;
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
