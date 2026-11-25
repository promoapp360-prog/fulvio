// Direct local Chromium, using only the synthetic sessions supplied by the integration test.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export async function verifyFidelityUI(opts: { admin: string; customer: string; name: string; phone: string; startingPoints: number; beforeClaim: () => Promise<void> }) {
  const root = path.resolve("../../generated-artifacts"), profile = path.join(root, `fidelity-browser-${crypto.randomUUID()}`);
  await fs.mkdir(profile, { recursive: true });
  const browser = spawn("chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  const base = "http://127.0.0.1:18633", delay = (ms: number) => new Promise(r => setTimeout(r, ms));
  let socket: WebSocket | undefined, seq = 0, sid = "";
  const pending = new Map<number, any>(), errors: string[] = [];
  const send = (method: string, params: any = {}, sessionId = sid): Promise<any> => new Promise((resolve, reject) => {
    const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout CDP: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timer }); socket!.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const evaluate = async (expression: string) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  };
  const wait = async (expression: string, label: string) => {
    const end = Date.now() + 20000;
    while (Date.now() < end) { if (await evaluate(expression)) return; await delay(150); }
    throw new Error("Attesa scaduta: " + label);
  };
  const click = (text: string) => evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)throw Error('Pulsante non trovato');e.click()})()`);
  const input = (selector: string, value: string) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Input non trovato');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  const fill = (label: string, value: string) => evaluate(`(()=>{const e=[...document.querySelectorAll('label')].find(e=>e.textContent.trim().startsWith(${JSON.stringify(label)}))?.querySelector('input');if(!e)throw Error('Campo non trovato');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  const navigate = async (url: string, cookie: string) => {
    await send("Network.clearBrowserCookies");
    const separator = cookie.indexOf("=");
    await send("Network.setCookie", { url: base, name: cookie.slice(0, separator), value: cookie.slice(separator + 1) });
    await send("Page.navigate", { url: base + url });
  };
  const screen = async (width: number, name?: string) => {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 }); await delay(200);
    assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), `Overflow a ${width}px`);
    if (name) { const r = await send("Page.captureScreenshot", { format: "png" }); await fs.writeFile(path.join(root, name + ".png"), Buffer.from(r.data, "base64")); }
  };
  try {
    let port = "";
    for (let i = 0; i < 50 && !port; i++) { try { port = (await fs.readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; } catch { await delay(100); } }
    assert.ok(port, "Chromium non disponibile");
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json() as any;
    socket = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => { socket!.addEventListener("open", () => resolve()); socket!.addEventListener("error", reject); });
    socket.addEventListener("message", event => {
      const m = JSON.parse(String(event.data));
      if (m.id) { const p = pending.get(m.id); clearTimeout(p?.timer); pending.delete(m.id); m.error ? p?.reject(new Error(m.error.message)) : p?.resolve(m.result); }
      if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.text);
    });
    const { targetId } = await send("Target.createTarget", { url: "about:blank" }, "");
    sid = (await send("Target.attachToTarget", { targetId, flatten: true }, "")).sessionId;
    await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
    await navigate("/admin/fidelity", opts.admin);
    await wait("document.body.innerText.includes('Nuovo cliente Self-Service')", "pagina Fidelity admin");
    await input('input[aria-label="Cerca tessera"]', opts.name);
    await click("Nuovo cliente Self-Service");
    await fill("Nome", opts.name + "-UI"); await fill("Telefono", opts.phone); await fill("Punti iniziali", "12");
    await click("Crea cliente e tessera");
    await wait("document.querySelector('[role=dialog]')?.innerText.includes('12 punti')", "cliente creato dalla UI");
    await input('input[placeholder="+/- punti"]', "3"); await input('input[placeholder="Motivo"]', "Omaggio");
    await click("Registra rettifica");
    await wait("document.querySelector('[role=dialog]')?.innerText.includes('15 punti')", "rettifica salvata");
    await fill("Validità dei prossimi accumuli", "9"); await click("Salva regola personale");
    await wait("document.body.innerText.includes('Regola salvata')", "regola personale salvata");
    for (const w of [320, 390, 768, 1440]) await screen(w, w === 320 || w === 1440 ? `phase-three-admin-${w}` : undefined);
    const rows = await (await fetch(base + "/api/admin/loyalty/cards?q=" + encodeURIComponent(opts.name + "-UI"), { headers: { cookie: opts.admin } })).json() as any;
    const card = rows.rows.find((c: any) => c.name === opts.name + "-UI");
    assert.equal(card.points, 15); assert.equal(card.expiryMonths, 9);
    await opts.beforeClaim();
    await navigate("/account/fidelity", opts.customer);
    await wait("document.body.innerText.includes('Hai già una tessera Self-Service?')", "Fidelity cliente");
    await fill("Numero tessera", card.code); await click("Associa la tessera");
    await wait(`document.body.innerText.includes(${JSON.stringify(`Tessera ${card.code}: verifica del salone in attesa.`)})`, "richiesta associazione");
    await screen(390, "phase-three-customer-390");
    await navigate("/admin/fidelity", opts.admin);
    await wait("document.body.innerText.includes('Associazioni da verificare')", "gestione associazioni");
    await click("Associazioni da verificare");
    await wait(`document.body.innerText.includes(${JSON.stringify(card.code)})`, "richiesta visibile al salone");
    const section = `[...document.querySelectorAll('section')].find(s=>s.querySelector('h2')?.textContent.includes(${JSON.stringify(card.code)}))`;
    assert.equal(await evaluate(`${section}?.querySelector('button')?.disabled`), true);
    await evaluate(`${section}.querySelector('input[type=checkbox]').click()`);
    await evaluate(`${section}.querySelector('button').click()`);
    await wait(`!document.body.innerText.includes(${JSON.stringify(card.code)})`, "associazione approvata dalla UI");
    await navigate("/account/fidelity", opts.customer);
    await wait(`document.body.innerText.includes(${JSON.stringify(`${opts.startingPoints + 15} punti`)})`, "saldo aggiornato nel cliente");
    for (const w of [320, 390, 768, 1440]) await screen(w);
    assert.deepEqual(errors, []);
    console.log("PASS browser: creazione Self-Service, rettifica, scadenza personale, richiesta cliente e conferma admin; nessun overflow a 320/390/768/1440px");
  } catch (error) {
    console.error("DIALOGO DI COLLAUDO:", await evaluate("document.querySelector('[role=dialog]')?.innerText || 'Nessun dialogo aperto'").catch(() => "Browser non disponibile"));
    throw error;
  } finally {
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error("Browser chiuso")); }
    socket?.close(); browser.kill("SIGTERM"); await delay(300);
    await fs.rm(profile, { recursive: true, force: true });
  }
}
