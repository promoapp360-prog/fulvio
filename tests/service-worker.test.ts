import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../client/public/sw.js", import.meta.url), "utf8");
function setup(online = true) {
  const handlers: Record<string, (e: any) => void> = {};
  const writes: string[] = [], deleted: string[] = [];
  let networkCalls = 0;
  const origin = "https://dogs-planet.test";
  const cached = () => new Response("cached");
  const context = {
    URL, Response, location: { origin },
    self: { addEventListener: (name: string, fn: (e: any) => void) => { handlers[name] = fn; }, clients: { claim: async () => {} } },
    caches: {
      keys: async () => ["dp-v3", "dp-v4-homepage", "unrelated-cache"],
      delete: async (key: string) => { deleted.push(key); return true; },
      match: async () => cached(),
      open: async () => ({ put: async (key: any) => { writes.push(typeof key === "string" ? key : key.url); } }),
    },
    fetch: async () => { networkCalls++; if (!online) throw new Error("offline"); return new Response("fresh"); },
  };
  vm.runInNewContext(source, context);
  async function request(path: string, mode = "cors") {
    const tasks: Promise<any>[] = [];
    let answer: Promise<Response> | undefined;
    handlers.fetch({
      request: { url: origin + path, method: "GET", mode },
      respondWith: (response: Promise<Response>) => { answer = response; },
      waitUntil: (task: Promise<any>) => tasks.push(task),
    });
    const response = await answer;
    await Promise.all(tasks);
    return response;
  }
  return { handlers, request, writes, deleted, calls: () => networkCalls };
}

test("PWA: gli asset senza hash vengono aggiornati dalla rete", async () => {
  const worker = setup();
  assert.equal(await (await worker.request("/brand/poppy-fidelity-detail.webp"))?.text(), "fresh");
  assert.equal(worker.writes.length, 1);
});
test("PWA: gli asset sono ancora disponibili offline", async () => {
  const worker = setup(false);
  assert.equal(await (await worker.request("/brand/logo.webp"))?.text(), "cached");
});
test("PWA: API, aree riservate e moduli di sviluppo non vengono intercettati", async () => {
  const worker = setup();
  for (const path of ["/api/public/settings", "/admin", "/account", "/src/main.tsx", "/@vite/client", "/node_modules/.vite/deps/react.js"]) {
    assert.equal(await worker.request(path), undefined, path);
  }
  assert.equal(worker.calls(), 0);
});
test("PWA: i bundle con hash mantengono la cache efficiente", async () => {
  const worker = setup();
  assert.equal(await (await worker.request("/assets/index-ABcdef12.js"))?.text(), "cached");
  assert.equal(worker.calls(), 0);
});
test("PWA: l'aggiornamento elimina solo le vecchie cache Dog's Planet", async () => {
  const worker = setup();
  let task: Promise<any> | undefined;
  worker.handlers.activate({ waitUntil: (p: Promise<any>) => { task = p; } });
  await task;
  assert.deepEqual(worker.deleted, ["dp-v3"]);
});
