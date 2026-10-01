import assert from "node:assert/strict";
import test from "node:test";

import { createStore, loadSample } from "../src/store.js";

// 端到端连锁场景：首付款 → 里程碑逐级确认 → 争议局部冻结 → 数据更正 → 修订追溯。
test("监管事件延迟引发的连锁义务可逐笔追踪", () => {
  const store = createStore(loadSample());

  // 首付款自生效日排程并锁汇
  const p0 = store.state.payments.P0;
  assert.equal(p0.due_date, "2026-10-08");
  assert.equal(p0.fx_lock.rate, 7.11);
  const invoice0 = store.issueInvoice("P0", { date: "2026-09-20" });
  assert.equal(invoice0.net_minor, 7200000000);
  assert.equal(invoice0.fx.net_home_minor, 51192000000);
  store.recordPayment("P0", { date: "2026-09-25" });

  // 依赖未满足时 M3 不能申报
  store.reportEvent("M1", { party: "licensee", date: "2026-09-20" });
  store.confirmEvent("M1", { party: "licensor", date: "2026-09-22" });
  store.reportEvent("M2", { party: "licensee", date: "2026-09-25" });
  assert.throws(
    () => store.reportEvent("M3", { party: "licensee", date: "2026-09-26" }),
    /依赖尚未确认/,
  );
  store.confirmEvent("M2", { party: "licensor", date: "2026-09-28" });
  store.reportEvent("M3", { party: "licensee", date: "2026-09-29" });

  // M1、M2 的付款已排程，M3 待确认
  assert.equal(store.state.payments.P1.due_date, "2026-10-22");
  assert.equal(store.state.payments.P2.status, "scheduled");
  assert.equal(store.state.payments.P3, undefined);

  // 监管复核只冻结 P2，P1 照常开票收款
  store.openDispute({
    payment_ids: ["P2"],
    reason: "二期主要终点数据需监管复核",
    opened_by: "licensor",
    date: "2026-09-30",
  });
  store.issueInvoice("P1", { date: "2026-10-01" });
  store.recordPayment("P1", { date: "2026-10-05" });
  assert.equal(store.state.payments.P1.status, "paid");
  assert.equal(store.state.payments.P2.status, "suspended");

  // 复核结论是数据更正：P2 调减至 3500 万美元并解冻
  store.resolveDispute("D1", {
    date: "2026-10-06",
    resolution: "adjust",
    corrected_amounts: { P2: 35000000 },
  });
  assert.equal(store.state.payments.P2.status, "scheduled");
  assert.equal(store.recompute("P2").ok, false, "更正后尚未重开发票");
  store.issueInvoice("P2", { date: "2026-10-07" });
  assert.equal(store.recompute("P2").ok, true);

  // 修订增加里程碑，版本链完整
  store.applyAmendment({
    reason: "增加第二档销售里程碑",
    approved_by: ["licensor", "licensee"],
    effective_date: "2026-10-08",
    changes: {
      milestones: [
        ...store.state.deal.milestones,
        {
          id: "M7",
          category: "sales",
          event: "年度净销售额首次超过15亿美元",
          responsible: "licensee",
          depends_on: ["M5"],
          payment: { id: "P7", amount: 90000000, currency: "USD", payer: "licensee", payee: "licensor", due_days: 60 },
        },
      ],
    },
  });
  assert.equal(store.verifyAudit().ok, true);
  assert.equal(store.auditTrail().length, 2);

  // 项目负责人视角：下一项义务与承担方
  const obligations = store.nextObligations("2026-10-09");
  const confirmation = obligations.find((o) => o.type === "milestone_confirmation");
  assert.equal(confirmation.id, "M3");
  assert.equal(confirmation.responsible, "licensor");
  const p2 = obligations.find((o) => o.id === "P2");
  assert.equal(p2.responsible, "licensee");
  assert.equal(p2.status, "invoiced");

  // 台账逐笔可复算
  for (const entry of store.ledger()) {
    if (entry.invoice) assert.equal(entry.verification, true, `${entry.id} 复算须一致`);
  }
});
