// Pulizia geometrica, senza generazione AI o ritocchi al cane.
// Gli originali restano invariati. Le maschere escludono solo i frammenti
// della brand board esterni alla sagoma di Poppy e agli accessori originali.
import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../client/public/brand/", import.meta.url));
const masks = {
  toelettatura: "M0 38H30L34 34L40 30L45 27L49 20L53 16L59 13L64 11L69 10L70 5L74 1H84L89 4L91 8L96 6L101 7L105 11L107 11L110 12L115 13L119 10L123 8L131 8L141 10L150 14L159 18L164 24L168 32L174 38H198V168H8V150H0Z",
  "self-service": "M0 44H15L18 35L19 27L22 20L25 12L39 6L52 0H68L74 7L78 10L96 11L106 12L111 8L116 4L124 3L133 5L146 13L156 24L159 34L162 44H182V170H0Z",
  pensione: "M0 13H76L88 5L102 0H121L139 9L154 20H214V154H0Z",
};

for (const kind of ["toelettatura", "self-service", "pensione", "fidelity", "pet-shop"]) {
  const input = path.join(dir, `mascotte-${kind}.png`);
  const { width, height } = await sharp(input).metadata();
  let image = sharp(input).ensureAlpha();
  if (masks[kind]) {
    const mask = Buffer.from(`<svg width="${width}" height="${height}"><path d="${masks[kind]}" fill="white"/></svg>`);
    image = image.composite([{ input: mask, blend: "dest-in" }]);
  }
  // Stessa cornice e linea di base; nessuna immagine viene ingrandita.
  const cleaned = await image.png().toBuffer();
  // Variante ravvicinata per le card della home: si toglie soltanto il margine
  // bianco esterno. Nessun ingrandimento, ridisegno o ritocco dei pixel di Poppy.
  const detail = await sharp(cleaned).flatten({ background: "#ffffff" })
    .trim({ background: "#ffffff", threshold: 14 })
    .extend({ top: 4, bottom: 4, left: 4, right: 4, background: "#ffffff" }).png().toBuffer();
  await sharp(detail).png().toFile(path.join(dir, `poppy-${kind}-detail.png`));
  await sharp(detail).webp({ lossless: true }).toFile(path.join(dir, `poppy-${kind}-detail.webp`));
  const { data, info } = await sharp(cleaned).resize(208, 168, {
    fit: "inside", withoutEnlargement: true,
  }).png().toBuffer({ resolveWithObject: true });
  const canvas = await sharp({
    create: { width: 240, height: 200, channels: 4, background: "#ffffff" },
  }).composite([{ input: data, left: Math.round((240 - info.width) / 2), top: 184 - info.height }]).png().toBuffer();
  await sharp(canvas).png().toFile(path.join(dir, `poppy-${kind}.png`));
  await sharp(canvas).webp({ lossless: true }).toFile(path.join(dir, `poppy-${kind}.webp`));
}
