import { eq } from "drizzle-orm";
import { db } from "../db";
import { pages, settings } from "../../shared/schema";
import { PRIVACY_DRAFT, COOKIE_DRAFT } from "./legal-documents";

/** Aggiornamento mirato dei soli frammenti standard obsoleti, senza sostituire le informative personalizzate. */
export async function applyBookingContent() {
  const paragraph = (draft: string, start: string) => draft.split("\n").find(line => line.startsWith(start))!;
  await db.transaction(async tx => {
    const inserted = await tx.insert(settings).values({ key: "registered_booking_content", value: { applied: true } }).onConflictDoNothing().returning();
    if (!inserted.length) return;
    const patches: Record<string, [string, string][]> = {
      "privacy-policy": [
        ["nome, cognome, email, telefono, dati necessari", "nome, cognome, email, telefono, comune, provincia, CAP, data di nascita, dati necessari"],
        ["età/data di nascita, servizi, note e foto facoltativa.", "data di nascita, alimentazione, benessere, servizi, note e foto richiesta nella scheda. Muta e nodi riguardano il singolo appuntamento."],
        ["**Richieste di appuntamento, ospiti o registrati:**", "**Richieste di appuntamento:** nuove richieste solo da account registrati; storico ospiti conservato."],
        ["**Foto del cane:** conferimento facoltativo per", "**Foto del cane:** richiesta nella scheda, riutilizzata per"],
        ["Una richiesta ospite non crea credenziali; l’associazione successiva", "Le precedenti richieste ospiti non hanno creato credenziali; l’associazione successiva"],
        ["La casella “Dichiaro di aver preso visione dell’informativa privacy” è obbligatoria per documentare la lettura prima della richiesta, non è un consenso obbligatorio al trattamento precontrattuale. Il sistema registra versione, data/ora e prova della presa visione. Il marketing ha una casella distinta e vuota; l’invio funziona anche senza selezionarla.",
          paragraph(PRIVACY_DRAFT, "La casella")],
      ],
      "cookie-policy": [
        ["- **dp-booking-date, dp-booking-time — sessionStorage tecnico:** conservano solo giorno e ora scelti nel passaggio tra prenotazione e accesso, per la sessione della scheda del browser; non salvano nome, telefono o foto.",
          paragraph(COOKIE_DRAFT, "- **dp-booking-draft") + "\n" + paragraph(COOKIE_DRAFT, "- **dp-install-eligible")],
      ],
    };
    for (const [slug, replacements] of Object.entries(patches)) {
      const [page] = await tx.select().from(pages).where(eq(pages.slug, slug));
      if (!page?.body) continue;
      let body = page.body;
      for (const [before, after] of replacements) body = body.replace(before, after);
      if (slug === "privacy-policy" && !body.includes("Necessità e proporzionalità dei campi obbligatori"))
        body += "\n\n**Da convalidare con il titolare:** necessità e proporzionalità dei campi obbligatori di registrazione, inclusi data di nascita e foto. L'informativa resta una bozza da convalidare.";
      if (body !== page.body) await tx.update(pages).set({ body, updatedAt: new Date() }).where(eq(pages.id, page.id));
    }
  });
}
