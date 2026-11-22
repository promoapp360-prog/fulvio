// Scontorno: si utilizza soltanto l'alfa della maschera, MAI i suoi colori.
// I pixel RGB di Poppy sono quelli del file originale, senza ricostruzioni.
import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../client/public/", import.meta.url));
const cores = {
  toelettatura: [109, 68, 53, 44], "self-service": [98, 88, 55, 83],
  pensione: [111, 116, 91, 35], fidelity: [80, 92, 56, 84], "pet-shop": [70, 103, 54, 84],
};
for (const [kind, [cx, cy, rx, ry]] of Object.entries(cores)) {
  const input = path.join(root, `brand/poppy-${kind}-detail.png`);
  const output = path.join(root, `brand/poppy-${kind}-transparent.png`);
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const mask = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (mask.info.width !== info.width || mask.info.height !== info.height) throw new Error(`Maschera non allineata: ${kind}`);
  const alpha = Uint8Array.from({ length: info.width * info.height }, (_, i) => mask.data[i * 4 + 3]);
  const paper = (i) => Math.min(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) > 242;
  const core = (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1;
  const seen = new Uint8Array(alpha.length), queue = [];
  function visit(x, y) {
    if (x < 0 || y < 0 || x >= info.width || y >= info.height || core(x, y)) return;
    const i = y * info.width + x;
    if (seen[i] || !paper(i)) return;
    seen[i] = 1; queue.push(i);
  }
  for (let x = 0; x < info.width; x++) { visit(x, 0); visit(x, info.height - 1); }
  for (let y = 0; y < info.height; y++) { visit(0, y); visit(info.width - 1, y); }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q], x = i % info.width, y = Math.floor(i / info.width);
    visit(x - 1, y); visit(x + 1, y); visit(x, y - 1); visit(x, y + 1);
  }
  for (let i = 0; i < alpha.length; i++) {
    const rgb = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
    // Conserva anche accessori originali (tetto, cuore, bolle), non solo il cane.
    if (Math.max(...rgb) - Math.min(...rgb) > 55 && Math.min(...rgb) < 220) alpha[i] = 255;
    // Eventuali frammenti verdi del prato della brand board, esterni al cane.
    if (rgb[1] > rgb[0] + 8 && rgb[1] > rgb[2] + 8 && !core(i % info.width, Math.floor(i / info.width))) alpha[i] = 0;
    if (seen[i]) {
      const x = i % info.width, y = Math.floor(i / info.width);
      const edge = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([a, b]) => a >= 0 && b >= 0 && a < info.width && b < info.height && !paper(b * info.width + a));
      if (!edge || alpha[i] < 128) alpha[i] = 0;
    }
    data[i * 4 + 3] = alpha[i];
  }
  const png = await sharp(data, { raw: info }).png().toBuffer();
  await sharp(png).png().toFile(output);
  await sharp(png).webp({ lossless: true }).toFile(output.replace(".png", ".webp"));
}
// Il logo ufficiale è già trasparente: non si ridisegna e non si modifica.
// Le icone hanno un fondo uniforme di sistema, senza pannelli bianchi interni.
for (const [name, size, markWidth] of [
  ["icon-192", 192, 160], ["icon-512", 512, 420], ["maskable-512", 512, 358],
  ["apple-touch-icon", 180, 148], ["favicon", 32, 28],
]) {
  const { data, info } = await sharp(path.join(root, "brand/symbol.png")).resize({ width: markWidth }).png().toBuffer({ resolveWithObject: true });
  await sharp({ create: { width: size, height: size, channels: 4, background: "#E6F7FF" } })
    .composite([{ input: data, left: Math.round((size - info.width) / 2), top: Math.round((size - info.height) / 2) }])
    .png().toFile(path.join(root, `icons/${name}.png`));
}
