import test from "node:test";
import assert from "node:assert/strict";
import { watchPwaUpdates } from "../client/src/lib/pwa-updates";

function setup(controlled = true, online = true, visible = true) {
  const worker = Object.assign(new EventTarget(), { controller: controlled ? {} : null });
  const page = Object.assign(new EventTarget(), { visibilityState: visible ? "visible" : "hidden" });
  let tick = () => {};
  let checks = 0, notifications = 0, cleared = false;
  const browser = Object.assign(new EventTarget(), {
    setInterval: (callback: () => void, delay: number) => {
      assert.equal(delay, 300_000);
      tick = callback;
      return 1;
    },
    clearInterval: () => { cleared = true; },
  });
  const stop = watchPwaUpdates(
    { update: async () => { checks++; return {} as ServiceWorkerRegistration; } },
    () => { notifications++; },
    { worker, page, browser, online: () => online } as any,
  );
  return { worker, page, browser, stop, tick: () => tick(), checks: () => checks, notifications: () => notifications, cleared: () => cleared };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test("PWA: segnala un aggiornamento senza ricaricare la pagina", () => {
  const context = setup();
  context.worker.dispatchEvent(new Event("controllerchange"));
  assert.equal(context.notifications(), 1);
  context.stop();
});

test("PWA: la prima installazione non mostra un falso aggiornamento", () => {
  const context = setup(false);
  context.worker.dispatchEvent(new Event("controllerchange"));
  assert.equal(context.notifications(), 0);
  context.worker.dispatchEvent(new Event("controllerchange"));
  assert.equal(context.notifications(), 1);
  context.stop();
});

test("PWA: controlla subito, al ritorno nell’app e periodicamente", async () => {
  const context = setup();
  assert.equal(context.checks(), 1);
  await settle();
  context.page.dispatchEvent(new Event("visibilitychange"));
  assert.equal(context.checks(), 2);
  await settle();
  context.tick();
  assert.equal(context.checks(), 3);
  context.stop();
});

test("PWA: non controlla aggiornamenti offline o con app nascosta", () => {
  for (const context of [setup(true, false), setup(true, true, false)]) {
    context.tick();
    context.browser.dispatchEvent(new Event("online"));
    assert.equal(context.checks(), 0);
    context.stop();
  }
});

test("PWA: rimuove timer e listener quando il componente viene chiuso", async () => {
  const context = setup();
  await settle();
  context.stop();
  context.worker.dispatchEvent(new Event("controllerchange"));
  context.page.dispatchEvent(new Event("visibilitychange"));
  context.tick();
  assert.equal(context.notifications(), 0);
  assert.equal(context.checks(), 1);
  assert.equal(context.cleared(), true);
});
