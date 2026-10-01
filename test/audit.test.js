import assert from "node:assert/strict";
import test from "node:test";

import { createStore, loadSample } from "../src/store.js";

test("初始版本起账且哈希链可校验", () => {
  const store = createStore(loadSample());
  const trail = store.auditTrail();
  assert.equal(trail.length, 1);
  assert.equal(trail[0].n, 1);
  assert.equal(trail[0].supersedes, null);
  assert.equal(store.verifyAudit().ok, true);
});

test("修订须双方批准", () => {
  const store = createStore(loadSample());
  assert.throws(
    () =>
      store.applyAmendment({
        reason: "单方调整",
        approved_by: ["licensor"],
        effective_date: "2026-10-01",
        changes: { reminders: { window_days: 45 } },
      }),
    /双方批准/,
  );
});


test("修订生成新版本并串联哈希链", () => {
  const store = createStore(loadSample());
  const before = store.auditTrail()[0].hash;
  const record = store.applyAmendment({
    reason: "提醒窗口由30天改为45天",
    approved_by: ["licensor", "licensee"],
    effective_date: "2026-10-01",
    changes: { reminders: { window_days: 45, review_window_days: 15, royalty_report_due_day: 30 } },
  });
  assert.equal(record.n, 2);
  assert.equal(record.supersedes, before);
  assert.equal(store.state.deal.reminders.window_days, 45);
  assert.equal(store.verifyAudit().ok, true);
  assert.equal(store.auditTrail().length, 2);
});


test("引入权利冲突的修订被拒绝且不落账", () => {
  const store = createStore(loadSample());
  const conflicting = {
    id: "G9",
    party: "licensor",
    asset: "LB-101",
    territory: "美国",
    indications: ["胃癌"],
    rights: ["商业化"],
    exclusivity: "独占",
  };
  assert.throws(
    () =>
      store.applyAmendment({
        reason: "试图回收美国商业化权",
        approved_by: ["licensor", "licensee"],
        effective_date: "2026-10-01",
        changes: { grants: [...store.state.deal.grants, conflicting] },
      }),
    /权利冲突/,
  );
  assert.equal(store.auditTrail().length, 1, "冲突修订不产生新版本");
});


test("修订新增里程碑后立即可推进，篡改内容会被链校验发现", () => {
  const store = createStore(loadSample());
  const milestones = [
    ...store.state.deal.milestones,
    {
      id: "M7",
      category: "sales",
      event: "年度净销售额首次超过15亿美元",
      responsible: "licensee",
      depends_on: ["M5"],
      payment: { id: "P7", amount: 90000000, currency: "USD", payer: "licensee", payee: "licensor", due_days: 60 },
    },
  ];
  store.applyAmendment({
    reason: "增加第二档销售里程碑",
    approved_by: ["licensor", "licensee"],
    effective_date: "2026-10-01",
    changes: { milestones },
  });
  assert.equal(store.state.milestones.M7.status, "pending");
  assert.equal(store.verifyAudit().ok, true);

  store.state.deal.title = "被篡改的标题";
  assert.equal(store.verifyAudit().ok, false, "内容被篡改后链校验失败");
});
