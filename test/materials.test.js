import assert from "node:assert/strict";
import test from "node:test";

import { createStore, loadSample } from "../src/store.js";

test("约定解锁里程碑的材料在确认前不对对方开放", () => {
  const store = createStore(loadSample());
  assert.equal(store.materialAccess("DOC-CMC-01", "licensor", "2026-09-19").allowed, true, "所有方始终可读");
  const blocked = store.materialAccess("DOC-CMC-01", "licensee", "2026-09-19");
  assert.equal(blocked.allowed, false);
  assert.match(blocked.reason, /M1/);

  store.reportEvent("M1", { party: "licensee", date: "2026-09-20" });
  store.confirmEvent("M1", { party: "licensor", date: "2026-09-22" });
  assert.equal(store.materialAccess("DOC-CMC-01", "licensee", "2026-09-23").allowed, true);
});



test("授权范围外的当事方被拒绝且访问留痕", () => {
  const store = createStore(loadSample());
  const denied = store.materialAccess("DOC-FIN-03", "licensor", "2026-09-19");
  assert.equal(denied.allowed, false);
  assert.match(denied.reason, /不在授权范围/);
  assert.equal(store.materialAccess("DOC-FIN-03", "licensee", "2026-09-19").allowed, true);

  const log = store.materialsLog();
  assert.equal(log.length, 2);
  assert.deepEqual(log.map((entry) => entry.allowed), [false, true]);
});

test("材料总览按当事方标注当前可访问性", () => {
  const store = createStore(loadSample());
  const overview = store.materialsOverview();
  const cmc = overview.find((m) => m.id === "DOC-CMC-01");
  assert.deepEqual(cmc.access, { licensor: true, licensee: false });
  assert.throws(() => store.materialAccess("DOC-XXX", "licensor", "2026-09-19"), /未找到材料/);
});
