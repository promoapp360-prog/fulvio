// Collaudo locale con Chromium già disponibile: nessun agente o pacchetto aggiuntivo.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { addDays, todayRome } from "../server/time";

if (process.env.NODE_ENV !== "development") throw new Error("Solo sviluppo");
const run = crypto.randomUUID(), root = path.resolve("../../generated-artifacts");
const profile = path.join(root, `browser-${run}`), photo = path.join(root, `photo-${run}.webp`);
await fs.mkdir(profile, { recursive: true });
await sharp({ create: { width: 200, height: 200, channels: 3, background: "#208ead" } }).webp().toFile(photo);
const browser = spawn("chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
let socket: WebSocket | undefined;
let sequence = 0;
const pending = new Map<number, { resolve: (value: any) => void; reject: (value: any) => void }>();
let sid = "";
const errors: string[] = [];
const send = (method: string, params: any = {}, sessionId = sid): Promise<any> => new Promise((resolve, reject) => {
  const id = ++sequence; pending.set(id, { resolve, reject }); socket!.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
const evaluate = async (expression: string) => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result?.value;
};
async function wait(expression: string, label: string, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await evaluate(expression)) return; await delay(150); }
  throw new Error(`Attesa scaduta: ${label}`);
}
const clickText = (text: string) => evaluate(`(()=>{const el=[...document.querySelectorAll('button,a,label')].find(x=>x.textContent.trim()===${JSON.stringify(text)});if(!el)throw Error('Controllo non trovato');el.click();return true})()`);
const width = async (w: number) => {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 768 });
  await delay(150);
  assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), true, `Overflow a ${w}px`);
};
const capture = async (name: string) => {
  const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await fs.writeFile(path.join(root, name + ".png"), Buffer.from(data, "base64"));
};
async function fill(label: string, value: string, index = 0) {
  await evaluate(`(()=>{const labels=[...document.querySelectorAll('label')].filter(x=>x.querySelector('input:not([type=file]),select,textarea')&&x.textContent.trim().startsWith(${JSON.stringify(label)}));const el=labels[${index}]?.querySelector('input,select,textarea');if(!el)throw Error('Campo non trovato: '+${JSON.stringify(label)});const proto=el instanceof HTMLSelectElement?HTMLSelectElement.prototype:el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event(el instanceof HTMLSelectElement?'change':'input',{bubbles:true}));return true})()`);
}
try {
  let port = "";
  for (let attempt = 0; attempt < 50 && !port; attempt++) {
    try { port = (await fs.readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; } catch { await delay(100); }
  }
  assert.ok(port, "Chromium non avviato");
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json() as any;
  socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => { socket!.addEventListener("open", () => resolve()); socket!.addEventListener("error", reject); });
  socket.addEventListener("message", event => {
    const message = JSON.parse(String(event.data));
    if (message.id) { const request = pending.get(message.id); pending.delete(message.id); message.error ? request?.reject(new Error(message.error.message)) : request?.resolve(message.result); }
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
  });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" }, "");
  sid = (await send("Target.attachToTarget", { targetId, flatten: true }, "")).sessionId;
  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: "window.__pushCalls=0;if(window.Notification){const original=Notification.requestPermission;Notification.requestPermission=function(...args){window.__pushCalls++;return original.apply(this,args)}}"});
  await width(320);
  await send("Page.navigate", { url: "http://127.0.0.1:18633/richiedi-prenotazione" });
  await wait("document.body.textContent.includes('Sono già cliente')", "scelta accesso");
  if (await evaluate("!!document.querySelector('[data-cookie-banner]')")) await clickText("Rifiuta");
  assert.equal(await evaluate("!!document.querySelector('[data-install-prompt]')"), false);
  await capture("phase-two-entry-320");
  await evaluate("document.querySelector('a[href^=\"/registrazione?\"]').click()");
  await wait("!!document.querySelector('form input[autocomplete=\"new-password\"]')", "registrazione");
  await width(390);
  for (const [label, value, index] of [
    ["Nome", `Collaudo-${run}`, 0], ["Cognome", "Sintetico", 0], ["Email", `collaudo-${run}@example.test`, 0],
    ["Telefono", "3330000000", 0], ["Password", crypto.randomBytes(24).toString("base64url"), 0], ["Comune", "Cernusco sul Naviglio", 0],
    ["Provincia", "MI", 0], ["CAP", "20063", 0], ["La tua data", "1990-01-01", 0], ["Nome", `Prova-${run}`, 1],
    ["Peso circa", "12", 0], ["Data di nascita", "2020-01-01", 0], ["Tipo di pelo", "liscio", 0], ["Lunghezza del pelo", "corto", 0],
    ["Problematiche", "Nessuna", 0], ["Dermatiti", "Nessuna", 0], ["Intolleranze", "Nessuna", 0], ["Sensibilità", "Nessuna", 0],
    ["Altre esigenze", "Nessuna", 0], ["Altri animali", "Nessuno", 0], ["Alimentazione", "Alimentazione di prova", 0],
  ] as [string, string, number][]) await fill(label, value, index);
  await evaluate("document.querySelector('[role=combobox]').focus()");
  await delay(100);
  await evaluate("[...document.querySelectorAll('[role=option]')].find(x=>x.textContent==='Meticcio').click()");
  await evaluate("document.querySelector('[aria-label=\"Mostra password\"]').click()");
  assert.equal(await evaluate("document.querySelector('input[autocomplete=\"new-password\"]').type"), "text");
  await evaluate("document.querySelector('[aria-label=\"Nascondi password\"]').click()");
  const doc = await send("DOM.getDocument");
  const node = await send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "input[type=file]" });
  await send("DOM.setFileInputFiles", { nodeId: node.nodeId, files: [photo] });
  await wait("document.body.textContent.includes('Foto pronta:')", "compressione foto");
  assert.equal(await evaluate("document.querySelector('button.btn-primary[disabled]')!==null"), true);
  await evaluate("document.querySelector('input[type=checkbox][required]').click()");
  await evaluate("[...document.querySelectorAll('label')].find(x=>x.textContent.trim().startsWith('Acconsento a ricevere')).querySelector('input').click()");
  assert.equal(await evaluate("document.querySelector('form').checkValidity()"), true, "Form completo non valido");
  assert.equal(await evaluate("window.__pushCalls"), 0);
  await width(320); await width(768); await width(1440); await capture("phase-two-register-desktop");
  await clickText("Completa la registrazione");
  await wait("location.pathname==='/richiedi-prenotazione'&&document.body.textContent.includes('Quali servizi desideri?')", "ritorno automatico alla prenotazione");
  if (await evaluate("!!document.querySelector('[data-install-prompt]')")) await evaluate("document.querySelector('[aria-label=\"Rimanda l’installazione\"]').click()");
  console.log("PASS BROWSER registrazione, password visibile/nascosta, foto, privacy e ritorno alla richiesta");
  const choose = async (word: string) => evaluate(`(()=>{const label=[...document.querySelectorAll('label')].find(x=>x.querySelector('input[type=checkbox]')&&(x.querySelector('b')?.textContent||x.textContent).toLowerCase().includes(${JSON.stringify(word)}));if(!label)throw Error('Servizio non trovato');label.querySelector('input').click()})()`);
  await choose("stripping");
  assert.equal(await evaluate("[...document.querySelectorAll('label')].find(x=>x.textContent.includes('Lavaggio professionale'))?.querySelector('input')?.disabled"), true);
  await choose("stripping"); await choose("pensione casalinga");
  await clickText("Scegli giorno ed orario");
  let date = "", time = "";
  for (let offset = 1; offset <= 14; offset++) {
    const day = addDays(todayRome(), offset);
    const available = await evaluate(`(async()=>{const dogs=await(await fetch('/api/account/dogs')).json();const services=await(await fetch('/api/public/services')).json();const bath=services.find(x=>x.slug==='lavaggio-professionale');return await(await fetch('/api/account/booking-availability?dogId='+dogs[0].id+'&serviceIds='+bath.id+'&date=${day}')).json()})()`);
    if (available.slots?.length) { date = day; time = available.slots[0]; break; }
  }
  assert.ok(date, "Nessuna disponibilità reale");
  const dateLabel = new Date(`${date}T12:00:00Z`).toLocaleDateString("it-IT", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });
  if (!await evaluate(`!!document.querySelector('button[aria-label=${JSON.stringify(dateLabel)}]')`)) await evaluate("document.querySelector('button[aria-label=\"Mese successivo\"]').click()");
  await evaluate(`document.querySelector('button[aria-label=${JSON.stringify(dateLabel)}]').click()`);
  await wait(`Array.from(document.querySelectorAll('button')).some(x=>x.textContent.trim()===${JSON.stringify(time)})`, "orari reali");
  await width(390); await capture("phase-two-calendar-mobile");
  await clickText(time); await clickText("Continua");
  await fill("È in muta?", "no"); await fill("Ci sono nodi?", "si");
  await fill("Note per il salone", `Collaudo browser ${run}`);
  await fill("Soggiorno dal", addDays(date, 1)); await fill("Al", addDays(date, 2));
  await clickText("Vai al riepilogo");
  await wait("document.body.textContent.includes('Riepilogo della richiesta')", "riepilogo");
  for (const size of [320, 768, 1440]) await width(size);
  await width(390); await capture("phase-two-summary-mobile");
  assert.equal(await evaluate("document.querySelectorAll('input[type=file]').length"), 0);
  assert.equal(await evaluate("document.querySelectorAll('input[type=checkbox][required]').length"), 0);
  await clickText("Invia richiesta");
  await wait("document.body.textContent.includes('Richiesta inviata!')", "invio richiesta", 30000);
  await wait("!!document.querySelector('[data-push-preferences]')", "invito push dopo prima richiesta");
  assert.equal(await evaluate("window.__pushCalls"), 0, "Permesso richiesto senza click");
  assert.equal(await evaluate("document.querySelector('[data-push-preferences] input[type=checkbox]').checked"), false);
  await capture("phase-two-success-mobile");
  assert.deepEqual(errors, []);
  console.log("PASS BROWSER stripping + bagno, calendario reale, info del giorno, riepilogo e invio lavaggio + pensione");
  console.log("PASS BROWSER nessun overflow a 320/390/768/1440; push solo dopo richiesta, senza permesso automatico");
} catch (error) {
  if (socket?.readyState === WebSocket.OPEN) {
    await capture("phase-two-browser-last");
    console.log(await evaluate("document.querySelector('main')?.innerText.slice(0,2500) || document.body.innerText.slice(0,2500)"));
  }
  throw error;
} finally {
  try { if (socket?.readyState === WebSocket.OPEN) { await Promise.race([send("Browser.close", {}, ""), delay(1000)]); socket.close(); } } catch { browser.kill(); }
  browser.kill();
  const cleanup = spawnSync("pnpm", ["--filter", "@workspace/dogs-planet", "exec", "tsx", "tests/customer-booking.integration.ts", `--cleanup=${run}`], { cwd: path.resolve("../.."), encoding: "utf8" });
  console.log(cleanup.stdout.trim());
  await fs.rm(profile, { recursive: true, force: true }); await fs.rm(photo, { force: true });
  assert.equal(cleanup.status, 0, cleanup.stderr);
}
