import assert from "node:assert/strict";
import test from "node:test";

import { createServer } from "../src/service.js";
import { createStore, loadSample } from "../src/store.js";

async function withServer(t) {
  const server = createServer(createStore(loadSample()));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

async function post(base, path, payload) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: await response.json() };
}

async function get(base, path) {
  const response = await fetch(`${base}${path}`);
  return { status: response.status, body: await response.json() };
}

test("健康检查与未知路径", async (t) => {
  const base = await withServer(t);
  const health = await get(base, "/health");
  assert.equal(health.status, 200);
  assert.equal(health.body.service, "drug-license-obligations");
  const missing = await get(base, "/nope");
  assert.equal(missing.status, 404);
});

test("权利查询：谁能在哪个市场做什么", async (t) => {
  const base = await withServer(t);
  const us = await get(base, `/api/rights?territory=${encodeURIComponent("美国")}&action=${encodeURIComponent("商业化")}`);
  assert.equal(us.status, 200);
  assert.deepEqual(us.body.holders.map((h) => h.party), ["licensee"]);
  const bad = await get(base, "/api/rights");
  assert.equal(bad.status, 400);
  const conflicts = await get(base, "/api/rights/conflicts");
  assert.deepEqual(conflicts.body.conflicts, []);
});

test("里程碑申报确认后付款排程、开票、复算", async (t) => {
  const base = await withServer(t);
  await post(base, "/api/milestones/M1/report", { party: "licensee", date: "2026-09-20" });
  const selfConfirm = await post(base, "/api/milestones/M1/confirm", { party: "licensee", date: "2026-09-22" });
  assert.equal(selfConfirm.status, 400);
  const confirmed = await post(base, "/api/milestones/M1/confirm", { party: "licensor", date: "2026-09-22" });
  assert.equal(confirmed.status, 200);

  const early = await post(base, "/api/milestones/M3/report", { party: "licensee", date: "2026-09-23" });
  assert.equal(early.status, 409, "依赖未确认不能申报");

  const payments = await get(base, "/api/payments");
  const p1 = payments.body.payments.find((p) => p.id === "P1");
  assert.equal(p1.due_date, "2026-10-22");
  assert.equal(p1.fx_lock.rate, 7.11);

  const invoice = await post(base, "/api/payments/P1/invoice", { date: "2026-09-23" });
  assert.equal(invoice.body.net_minor, 1800000000);
  const recompute = await get(base, "/api/payments/P1/recompute");
  assert.equal(recompute.body.ok, true);
  const paid = await post(base, "/api/payments/P1/pay", { date: "2026-09-24" });
  assert.equal(paid.body.status, "paid");
});


test("争议接口只冻结相关付款", async (t) => {
  const base = await withServer(t);
  await post(base, "/api/milestones/M1/report", { party: "licensee", date: "2026-09-20" });
  await post(base, "/api/milestones/M1/confirm", { party: "licensor", date: "2026-09-22" });
  const dispute = await post(base, "/api/disputes", {
    payment_ids: ["P1"],
    reason: "终点数据复核",
    opened_by: "licensor",
    date: "2026-09-29",
  });
  assert.equal(dispute.body.id, "D1");
  const frozen = await post(base, "/api/payments/P1/invoice", { date: "2026-09-29" });
  assert.equal(frozen.status, 409);
  const p0 = await post(base, "/api/payments/P0/invoice", { date: "2026-09-29" });
  assert.equal(p0.status, 200, "无关的首付款照常开票");
  const resolved = await post(base, "/api/disputes/D1/resolve", { date: "2026-10-01", resolution: "release" });
  assert.equal(resolved.body.status, "resolved");
});

test("义务、提醒、委员会、材料与审计接口", async (t) => {
  const base = await withServer(t);
  const obligations = await get(base, "/api/obligations/next?today=2026-10-01");
  assert.equal(obligations.body.obligations[0].id, "P0");

  const reminders = await get(base, "/api/reminders?today=2026-10-01&window=30");
  assert.ok(reminders.body.reminders.length > 0);

  const quorum = await get(base, `/api/committee/quorum?topic=${encodeURIComponent("竞品联合用药方案")}&attendees=L1,L2,N1,N3`);
  assert.equal(quorum.body.ok, true);
  const vote = await post(base, "/api/committee/vote", {
    topic: "竞品联合用药方案",
    votes: { L1: "赞成", L2: "赞成", N1: "反对", N3: "赞成" },
    attendees: ["L1", "L2", "N1", "N3"],
  });
  assert.equal(vote.body.outcome, "deadlock");
  const escalation = await post(base, "/api/committee/escalate", { topic: "竞品联合用药方案", round: 0 });
  assert.equal(escalation.body.step, "JDC复议");

  const denied = await post(base, "/api/materials/DOC-CMC-01/access", { party: "licensee", date: "2026-09-19" });
  assert.equal(denied.body.allowed, false);

  const amendment = await post(base, "/api/amendments", {
    reason: "提醒窗口由30天改为45天",
    approved_by: ["licensor", "licensee"],
    effective_date: "2026-10-01",
    changes: { reminders: { window_days: 45, review_window_days: 15, royalty_report_due_day: 30 } },
  });
  assert.equal(amendment.body.n, 2);
  const audit = await get(base, "/api/audit");
  assert.equal(audit.body.versions.length, 2);
  assert.equal(audit.body.verification.ok, true);
});
