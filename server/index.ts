import express from "express";
import http from "node:http";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import compression from "compression";
import helmet from "helmet";
import { eq } from "drizzle-orm";
import { db, pool } from "./db";
import { pages } from "../shared/schema";
import { runMigrations } from "./migrate";
import { seedIfEmpty } from "./seed";
import { setupSession, csrfGuard } from "./auth";
import { errorHandler } from "./util";
import { readStored } from "./services/storage";
import { getSettings } from "./services/settings";
import { startJobs } from "./jobs";
import authRoutes from "./routes/auth";
import publicRoutes from "./routes/public";
import accountRoutes from "./routes/account";
import adminRoutes from "./routes/admin";
import webhooks from "./webhooks";

const isProd = process.env.NODE_ENV === "production";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  // Su Replit le migrazioni di produzione sono gestite dalla pubblicazione.
  if (!isProd) await runMigrations();
  await seedIfEmpty();

  const app = express();
  const server = http.createServer(app);
  app.disable("x-powered-by");
  app.use(helmet({
    // L'anteprima Replit incorpora l'app in un iframe; in produzione
    // rimane attiva la protezione originale contro il framing.
    frameguard: isProd ? { action: "sameorigin" } : false,
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "frame-ancestors": isProd ? ["'self'"] : null,
        "script-src": ["'self'", "'unsafe-inline'", "https://www.googletagmanager.com", "https://connect.facebook.net", ...(isProd ? [] : ["'unsafe-eval'"])],
        "img-src": ["'self'", "data:", "blob:", "https:"],
        "frame-src": ["'self'", "https://www.google.com", "https://maps.google.com", "https://www.youtube.com", "https://www.youtube-nocookie.com", "https://player.vimeo.com"],
        "connect-src": ["'self'", "https://www.google-analytics.com", "https://*.google-analytics.com", "https://www.facebook.com", ...(isProd ? [] : ["ws:", "wss:"])],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
        "form-action": ["'self'", "https://checkout.stripe.com"],
        "upgrade-insecure-requests": isProd ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  app.use(compression());

  // il webhook Stripe richiede il body grezzo: va montato prima del parser JSON
  app.use("/api/webhooks", webhooks);
  app.use("/api", csrfGuard);
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));
  setupSession(app);

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/auth", authRoutes);
  app.use("/api/public", publicRoutes);
  app.use("/api/account", accountRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api", (_req, res) => res.status(404).json({ error: "Endpoint inesistente" }));

  // file caricati (Object Storage o cartella locale), con cache lunga
  app.get("/files/*", async (req, res) => {
    const key = (req.params as any)[0] as string;
    const buf = await readStored(key).catch(() => null);
    if (!buf) return res.status(404).end();
    const ext = path.extname(key).slice(1);
    res.type(ext === "pdf" ? "application/pdf" : ext);
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    res.send(buf);
  });

  // SEO tecnico
  app.get("/robots.txt", (req, res) => {
    const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
    res.type("text/plain").send(`User-agent: *\nDisallow: /admin\nDisallow: /account\nDisallow: /api\nSitemap: ${base}/sitemap.xml\n`);
  });
  app.get("/sitemap.xml", (req, res) => {
    const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
    const urls = ["/", ...Object.keys(ROUTE_PAGES).filter((x) => x !== "/"), "/installa-app"];
    res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${base}${u}</loc></url>`).join("")}</urlset>`);
  });

  if (!isProd) {
    const { createServer } = await import("vite");
    const vite = await createServer({ configFile: path.join(ROOT, "vite.config.ts"), server: { middlewareMode: true, hmr: { server } }, appType: "custom" });
    app.use(vite.middlewares);
    app.use("*", async (req, res, next) => {
      try {
        let html = fs.readFileSync(path.join(ROOT, "client/index.html"), "utf8");
        html = await vite.transformIndexHtml(req.originalUrl, html);
        res.status(200).set({ "Content-Type": "text/html" }).end(await injectMeta(html, req.originalUrl));
      } catch (e) { vite.ssrFixStacktrace(e as Error); next(e); }
    });
  } else {
    const dist = path.join(ROOT, "dist/public");
    if (!fs.existsSync(path.join(dist, "index.html"))) throw new Error("Build mancante: esegui `npm run build` prima di `npm start`.");
    app.use("/assets", express.static(path.join(dist, "assets"), { maxAge: "1y", immutable: true }));
    app.use(express.static(dist, { maxAge: "1h", index: false }));
    const template = fs.readFileSync(path.join(dist, "index.html"), "utf8");
    app.get("*", async (req, res, next) => {
      try { res.set("Cache-Control", "no-cache").type("html").send(await injectMeta(template, req.originalUrl)); } catch (e) { next(e); }
    });
  }

  app.use(errorHandler);
  const port = Number(process.env.PORT || 5000);
  server.listen(port, "0.0.0.0", () => console.log(`Dog's Planet in ascolto su http://0.0.0.0:${port} (${isProd ? "produzione" : "sviluppo"})`));
  startJobs();

  const shutdown = () => { server.close(() => pool.end().finally(() => process.exit(0))); };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

// ---------- meta tag SEO per pagina (lato server, senza SSR completo) ----------
const ROUTE_PAGES: Record<string, string> = {
  "/": "home", "/chi-siamo": "chi-siamo", "/toelettatura": "toelettatura", "/servizi": "servizi", "/self-service": "self-service",
  "/pensione-casalinga": "pensione-casalinga", "/fidelity-card": "fidelity-card", "/pet-shop": "pet-shop", "/contatti": "contatti",
  "/richiedi-prenotazione": "richiedi-prenotazione", "/privacy-policy": "privacy-policy", "/cookie-policy": "cookie-policy", "/condizioni-del-servizio": "condizioni-del-servizio", "/installa-app": "installa-app",
};
const metaCache = new Map<string, { t: number; title: string; desc: string }>();
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

async function injectMeta(html: string, url: string) {
  const pathname = url.split("?")[0].replace(/\/$/, "") || "/";
  const slug = ROUTE_PAGES[pathname];
  const s = await getSettings();
  let title = s.seo.defaultTitle, desc = s.seo.defaultDescription;
  if (slug) {
    const c = metaCache.get(slug);
    if (c && Date.now() - c.t < 300_000) { title = c.title; desc = c.desc; }
    else {
      const [pg] = await db.select({ title: pages.title, seoTitle: pages.seoTitle, seoDescription: pages.seoDescription }).from(pages).where(eq(pages.slug, slug));
      if (pg) { title = pg.seoTitle || (slug === "home" ? title : `${pg.title} | Dog's Planet`); desc = pg.seoDescription || desc; }
      metaCache.set(slug, { t: Date.now(), title, desc });
    }
  }
  const base = process.env.PUBLIC_URL || "";
  const robots = pathname.startsWith("/admin") || pathname.startsWith("/account") ? "noindex, nofollow" : "index, follow";
  return html.replace("<!--META-->", [
    `<title>${esc(title)}</title>`, `<meta name="description" content="${esc(desc)}">`, `<meta name="robots" content="${robots}">`,
    `<link rel="canonical" href="${base}${pathname}">`, `<meta property="og:title" content="${esc(title)}">`, `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:type" content="website">`, s.seo.searchConsoleVerification ? `<meta name="google-site-verification" content="${esc(s.seo.searchConsoleVerification)}">` : "", `<meta property="og:image" content="${base}/brand/og-image.jpg">`, `<meta property="og:locale" content="it_IT">`,
  ].join("\n    "));
}

main().catch((e) => { console.error("Avvio non riuscito:", e); process.exit(1); });
