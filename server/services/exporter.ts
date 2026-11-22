// Esportazioni Excel (.xlsx) e PDF con logo Dog's Planet (punti 14 e 27).
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { Response } from "express";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

export type Column = { key: string; label: string; width?: number; money?: boolean; align?: "left" | "right" };
export type Sheet = { name: string; columns: Column[]; rows: Record<string, unknown>[]; totals?: Record<string, unknown> };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
function logoPath() {
  for (const p of ["client/public/brand/logo.png", "dist/public/brand/logo.png"]) { const f = path.join(ROOT, p); if (fs.existsSync(f)) return f; }
  return null;
}
const safe = (s: string) => s.replace(/[^\w.-]+/g, "_");
const fmtCell = (v: unknown, c: Column) => v == null ? "" : c.money ? (Number(v) / 100).toLocaleString("it-IT", { style: "currency", currency: "EUR" }) : v instanceof Date ? v.toLocaleString("it-IT", { timeZone: "Europe/Rome" }) : String(v);

export async function sendXlsx(res: Response, filename: string, sheets: Sheet[]) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Dog's Planet – PromoApp";
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31));
    ws.columns = s.columns.map((c) => ({ header: c.label, key: c.key, width: c.width ?? Math.max(12, c.label.length + 2) }));
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B3D91" } };
    for (const r of s.rows) ws.addRow(Object.fromEntries(s.columns.map((c) => [c.key, c.money && r[c.key] != null ? Number(r[c.key]) / 100 : r[c.key]])));
    if (s.totals) { const tr = ws.addRow(Object.fromEntries(s.columns.map((c) => [c.key, c.money && s.totals![c.key] != null ? Number(s.totals![c.key]) / 100 : s.totals![c.key]]))); tr.font = { bold: true }; }
    s.columns.forEach((c, i) => { if (c.money) ws.getColumn(i + 1).numFmt = '"€" #,##0.00'; });
  }
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${safe(filename)}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

export function sendPdf(res: Response, filename: string, title: string, subtitle: string, sheets: Sheet[], footer?: string) {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36, info: { Title: title, Author: "Dog's Planet" } });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${safe(filename)}.pdf"`);
  doc.pipe(res);
  const logo = logoPath();
  const header = () => {
    if (logo) doc.image(logo, 36, 24, { height: 46 });
    doc.fillColor("#0B3D91").font("Helvetica-Bold").fontSize(16).text(title, 160, 30, { align: "right" });
    doc.fillColor("#475569").font("Helvetica").fontSize(9).text(subtitle, 160, 52, { align: "right" });
    doc.moveTo(36, 80).lineTo(doc.page.width - 36, 80).strokeColor("#00B6C8").lineWidth(1.5).stroke();
    doc.y = 92;
  };
  header();
  const usable = doc.page.width - 72;
  for (const s of sheets) {
    if (sheets.length > 1) { doc.fillColor("#0B3D91").font("Helvetica-Bold").fontSize(12).text(s.name, 36, doc.y + 6); doc.moveDown(0.3); }
    const totalW = s.columns.reduce((a, c) => a + (c.width ?? 12), 0);
    const widths = s.columns.map((c) => ((c.width ?? 12) / totalW) * usable);
    const row = (vals: string[], bold = false, fill?: string) => {
      const h = Math.max(...vals.map((v, i) => doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8).heightOfString(v, { width: widths[i] - 6 }))) + 6;
      if (doc.y + h > doc.page.height - 50) { doc.addPage(); header(); }
      const y = doc.y; let x = 36;
      if (fill) doc.rect(36, y, usable, h).fill(fill);
      vals.forEach((v, i) => {
        const c = s.columns[i];
        doc.fillColor(fill === "#0B3D91" ? "#FFFFFF" : "#0A2350").font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8)
          .text(v, x + 3, y + 3, { width: widths[i] - 6, align: c.money || c.align === "right" ? "right" : "left" });
        x += widths[i];
      });
      doc.y = y + h;
    };
    row(s.columns.map((c) => c.label), true, "#0B3D91");
    s.rows.forEach((r, i) => row(s.columns.map((c) => fmtCell(r[c.key], c)), false, i % 2 ? "#F1F8FF" : undefined));
    if (s.totals) row(s.columns.map((c) => fmtCell(s.totals![c.key], c)), true, "#E6F7FF");
    doc.moveDown(1);
  }
  doc.fillColor("#64748b").font("Helvetica").fontSize(7).text(footer || "Documento gestionale interno Dog's Planet – non costituisce documento fiscale.", 36, doc.page.height - 40, { width: usable, align: "center" });
  doc.end();
}
