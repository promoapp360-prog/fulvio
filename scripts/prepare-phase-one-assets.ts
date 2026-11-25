import sharp from "sharp";
import path from "node:path";

const brand = path.resolve("client/public/brand");
const input = path.resolve("../../generated-artifacts/poppy-lavori-transparent.png");
await sharp(input).trim().resize({ width: 640, withoutEnlargement: true }).png({ palette: true, colours: 192, effort: 10 })
  .toFile(path.join(brand, "poppy-lavori-transparent.png"));
await sharp(input).trim().resize({ width: 640, withoutEnlargement: true }).webp({ quality: 86 })
  .toFile(path.join(brand, "poppy-lavori-transparent.webp"));

// Intervento limitato alla tessera: nessuna rigenerazione del cane.
const source = path.join(brand, "poppy-fidelity-transparent.png");
const { width = 163, height = 177 } = await sharp(source).metadata();
const star = (cx: number, cy: number) => Array.from({ length: 10 }, (_, i) => {
  const angle = -Math.PI / 2 + i * Math.PI / 5;
  const radius = i % 2 ? 2.7 : 6;
  return `${cx + Math.cos(angle) * radius},${cy + Math.sin(angle) * radius}`;
}).join(" ");
const overlay = Buffer.from(`<svg width="${width}" height="${height}" viewBox="0 0 163 177" xmlns="http://www.w3.org/2000/svg">
  <g transform="rotate(-9 103 128)">
    <rect x="62" y="112" width="78" height="29" rx="1" fill="#0088be"/>
    ${[70, 85, 100, 115, 130].map(x => `<polygon points="${star(x, 126)}" fill="#ffdc35"/>`).join("")}
  </g>
</svg>`);
const fidelity = await sharp(source).composite([{ input: overlay }]).png().toBuffer();
await sharp(fidelity).toFile(path.join(brand, "poppy-fidelity-five-stars.png"));
await sharp(fidelity).webp({ quality: 95 }).toFile(path.join(brand, "poppy-fidelity-five-stars.webp"));
console.log("Preparati Poppy cantiere e tessera a cinque stelle, originali conservati.");
