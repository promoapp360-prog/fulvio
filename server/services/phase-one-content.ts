import { eq } from "drizzle-orm";
import { db } from "../db";
import { pages, settings, emailTemplates } from "../../shared/schema";
import { PUBLIC_COPY, publicText } from "../../shared/public-copy";
import { clearSettingsCache } from "./settings";

/** Revisione editoriale autorizzata: non modifica account, prenotazioni o consensi. */
export async function applyPhaseOneContent() {
  await db.transaction(async tx => {
    const inserted = await tx.insert(settings).values({ key: "public_content_phase_one", value: { applied: true } })
      .onConflictDoNothing().returning();
    if (!inserted.length) return;
    for (const [key, patch] of [
      ["site", { heroTitle: PUBLIC_COPY.heroTitle, heroText: PUBLIC_COPY.heroText }],
      ["business", { email: "info@dogsplanet.it" }],
    ] as const) {
      const [current] = await tx.select().from(settings).where(eq(settings.key, key));
      await tx.insert(settings).values({ key, value: { ...current?.value as object, ...patch } })
        .onConflictDoUpdate({ target: settings.key, set: { value: { ...current?.value as object, ...patch }, updatedAt: new Date() } });
    }
    for (const page of await tx.select().from(pages)) {
      let body = publicText(page.body || "");
      if (page.slug === "toelettatura") body = body.replace(/## Come funziona[\s\S]*?(?=\n## |\n\nIl prezzo definitivo|$)/, "").trim();
      if (page.slug === "self-service") body = `${PUBLIC_COPY.selfService}\n\n## Come funziona\n\n${PUBLIC_COPY.selfServiceHow}`;
      if (page.slug === "fidelity-card") body = PUBLIC_COPY.fidelityPage;
      if (page.slug === "pet-shop") body = PUBLIC_COPY.shop;
      await tx.update(pages).set({
        title: page.slug === "pet-shop" ? "#LaPappadiPoppy" : publicText(page.title),
        subtitle: page.subtitle ? publicText(page.subtitle) : page.subtitle,
        body: publicText(body),
        seoTitle: page.seoTitle ? publicText(page.seoTitle) : page.seoTitle,
        seoDescription: page.seoDescription ? publicText(page.seoDescription) : page.seoDescription,
        updatedAt: new Date(),
      }).where(eq(pages.id, page.id));
    }
    for (const template of await tx.select().from(emailTemplates)) {
      await tx.update(emailTemplates).set({ subject: publicText(template.subject), body: publicText(template.body) })
        .where(eq(emailTemplates.key, template.key));
    }
  });
  clearSettingsCache();
}
