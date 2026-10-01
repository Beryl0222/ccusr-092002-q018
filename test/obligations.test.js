import assert from "node:assert/strict";
import test from "node:test";

import { createStore, loadSample } from "../src/store.js";

test("下一项义务按到期日排序并标注承担方", () => {
  const store = createStore(loadSample());
  const obligations = store.nextObligations("2026-10-01");
  assert.equal(obligations[0].type, "payment");
  assert.equal(obligations[0].id, "P0");
  assert.equal(obligations[0].responsible, "licensee");
  assert.equal(obligations[0].due_date, "2026-10-08");

  const royalty = obligations.find((o) => o.type === "royalty_report");
  assert.equal(royalty.due_date, "2026-10-30");
  assert.equal(royalty.responsible, "licensee");

  const m1 = obligations.find((o) => o.type === "milestone_event" && o.id === "M1");
  assert.equal(m1.responsible, "licensee");
  const m6 = obligations.find((o) => o.type === "milestone_event" && o.id === "M6");
  assert.equal(m6.responsible, "licensor", "专利义务归许可方");
  const m2 = obligations.find((o) => o.type === "milestone_event" && o.id === "M2");
  assert.equal(m2, undefined, "依赖未满足的里程碑不列为当前义务");
});


test("申报后确认义务转给对方并带确认期限", () => {
  const store = createStore(loadSample());
  store.reportEvent("M1", { party: "licensee", date: "2026-09-20" });
  const obligations = store.nextObligations("2026-10-01");
  const confirmation = obligations.find((o) => o.type === "milestone_confirmation");
  assert.equal(confirmation.id, "M1");
  assert.equal(confirmation.responsible, "licensor");
  assert.equal(confirmation.due_date, "2026-10-05", "申报日后15天为确认期限");
  assert.equal(obligations[0].id, "M1", "确认义务排在首付款之前");
});

test("逾期付款被标记，冻结付款不再催收", () => {
  const store = createStore(loadSample());
  const overdue = store.nextObligations("2026-10-09").find((o) => o.id === "P0");
  assert.equal(overdue.overdue, true);

  store.reportEvent("M1", { party: "licensee", date: "2026-09-20" });
  store.confirmEvent("M1", { party: "licensor", date: "2026-09-22" });
  store.openDispute({ payment_ids: ["P1"], reason: "复核", opened_by: "licensor", date: "2026-09-29" });
  const suspended = store.nextObligations("2026-10-09").find((o) => o.id === "P1");
  assert.equal(suspended.status, "suspended");
  assert.equal(suspended.responsible, null);
  assert.equal(suspended.overdue, false);
});

test("提醒只覆盖窗口期内的到期义务", () => {
  const store = createStore(loadSample());
  store.reportEvent("M1", { party: "licensee", date: "2026-09-20" });
  const due = store.reminders("2026-10-01", 30);
  const ids = due.map((o) => `${o.type}:${o.id}`);
  assert.ok(ids.includes("milestone_confirmation:M1"));
  assert.ok(ids.includes("payment:P0"));
  assert.ok(ids.some((id) => id.startsWith("royalty_report:")));
  assert.ok(!ids.some((id) => id.startsWith("milestone_event:")), "无到期日的事件不进入提醒");
  const far = store.reminders("2026-10-01", 3);
  assert.equal(far.length, 0, "窗口收窄后近期无到期义务");
});
