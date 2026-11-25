import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import nodemailer from "nodemailer";
import { emailLayout, inlineEmailAssets, p } from "../server/services/email-layout";
import { DEFAULT_TEMPLATES } from "../server/services/templates";
import { renderTemplate } from "../server/logic";

test("ogni template ha Poppy, logo originale, firma amichevole e contatti", () => {
  for (const template of Object.values(DEFAULT_TEMPLATES)) {
    const html = emailLayout(template.subject, p(renderTemplate(template.body, { nome: "Cliente", cane: "Ospite" })));
    assert.ok(html.includes('src="cid:poppy@dogsplanet.it"'));
    assert.ok(html.includes('src="cid:dogsplanet-logo@dogsplanet.it"'));
    assert.ok(html.includes("Una zampina di saluto"));
    assert.ok(html.includes("Poppy e Fulvio"));
    assert.ok(html.includes("info@dogsplanet.it"));
    assert.equal(inlineEmailAssets(html).length, 2);
    assert.ok(html.includes('name="viewport"'));
    assert.ok(html.includes("max-width:600px"));
  }
});

test("gli asset sono file PNG originali esistenti, senza chiamate a immagini esterne", async () => {
  for (const asset of inlineEmailAssets(emailLayout("Prova", p("Ciao!")))) {
    const data = await fs.readFile(asset.path);
    assert.equal(data.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(asset.contentDisposition, "inline");
  }
  assert.deepEqual(inlineEmailAssets("<p>Vecchio messaggio</p>"), []);
});

test("titolo, testo e pulsante restano sanificati; link e footer facoltativi preservati", () => {
  const html = emailLayout('<script>titolo</script>', p("<b>Cliente</b>"), { label: "Apri <area>", url: "https://example.test/account?a=1&b=2" }, '<p id="revoca">Preferenze</p>');
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;b&gt;Cliente&lt;/b&gt;"));
  assert.ok(html.includes("Apri &lt;area&gt;"));
  assert.ok(html.includes("a=1&amp;b=2"));
  assert.ok(html.includes('id="revoca"'));
});

test("la preview amministrativa usa immagini browser, non CID irrisolvibili", () => {
  const html = emailLayout("Anteprima", p("Testo admin"), undefined, "", true);
  assert.ok(!html.includes('src="cid:'));
  assert.ok(html.includes("/brand/poppy-toelettatura-transparent.png"));
});

test("il messaggio MIME contiene realmente i due allegati inline, senza usare SMTP", async () => {
  const html = emailLayout("Un saluto", p("Ciao da Poppy!"));
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  const result = await transport.sendMail({
    from: "info@dogsplanet.it", to: "anteprima@example.invalid", subject: "Anteprima",
    html, attachments: inlineEmailAssets(html),
  });
  const message = result.message.toString();
  assert.match(message, /multipart\/related/);
  assert.match(message, /Content-ID: <poppy@dogsplanet.it>/);
  assert.match(message, /Content-ID: <dogsplanet-logo@dogsplanet.it>/);
  assert.match(message, /Content-Disposition: inline/);
  transport.close();
});
