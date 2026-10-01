import assert from "node:assert/strict";
import test from "node:test";

import { createStore, loadSample } from "../src/store.js";

function storeWithTwoMilestones() {
  const store = createStore(loadSample());
  store.reportEvent("M1", { party: "licensee", date: "2026-09-20" });
  store.confirmEvent("M1", { party: "licensor", date: "2026-09-22" });
  store.reportEvent("M2", { party: "licensee", date: "2026-09-25" });
  store.confirmEvent("M2", { party: "licensor", date: "2026-09-28" });
  return store;
}

test("争议只冻结被点名的付款，无关义务照常履行", () => {
  const store = storeWithTwoMilestones();
  const dispute = store.openDispute({
    payment_ids: ["P2"],
    reason: "二期终点数据需复核",
    opened_by: "licensor",
    date: "2026-09-29",
  });
  assert.equal(dispute.id, "D1");
  assert.deepEqual(store.suspensions(), ["P2"]);
  assert.equal(store.state.payments.P1.status, "scheduled", "P1 不受牵连");

  store.issueInvoice("P1", { date: "2026-09-29" });
  store.recordPayment("P1", { date: "2026-10-01" });
  assert.equal(store.state.payments.P1.status, "paid");

  assert.throws(() => store.issueInvoice("P2", { date: "2026-09-29" }), /不能开票/);
});


test("争议解除后付款恢复原状态", () => {
  const store = storeWithTwoMilestones();
  store.openDispute({ payment_ids: ["P2"], reason: "数据复核", opened_by: "licensor", date: "2026-09-29" });
  store.resolveDispute("D1", { date: "2026-10-05", resolution: "release" });
  assert.equal(store.state.payments.P2.status, "scheduled");
  const invoice = store.issueInvoice("P2", { date: "2026-10-06" });
  assert.equal(invoice.gross_minor, 4000000000);
});

test("数据更正只调整相关付款并留痕", () => {
  const store = storeWithTwoMilestones();
  store.issueInvoice("P2", { date: "2026-09-29" });
  store.openDispute({ payment_ids: ["P2"], reason: "终点事件数更正", opened_by: "licensee", date: "2026-09-30" });
  store.resolveDispute("D1", {
    date: "2026-10-03",
    resolution: "adjust",
    corrected_amounts: { P2: 35000000 },
  });
  const p2 = store.state.payments.P2;
  assert.equal(p2.amount_minor, 3500000000);
  assert.equal(p2.adjustments.length, 1);
  assert.deepEqual(
    [p2.adjustments[0].from_minor, p2.adjustments[0].to_minor],
    [4000000000, 3500000000],
  );
  assert.equal(p2.invoice.gross_minor, 3500000000, "已开票付款更正后重开发票");
  assert.equal(store.recompute("P2").ok, true);
  assert.equal(store.state.payments.P1.status, "scheduled", "无关付款保持原状");
});

test("已付款项不能冻结，结案争议不能重复处理", () => {
  const store = storeWithTwoMilestones();
  store.issueInvoice("P1", { date: "2026-09-23" });
  store.recordPayment("P1", { date: "2026-09-24" });
  assert.throws(
    () => store.openDispute({ payment_ids: ["P1"], reason: "反悔", opened_by: "licensee", date: "2026-09-25" }),
    /不能冻结/,
  );
  store.openDispute({ payment_ids: ["P2"], reason: "复核", opened_by: "licensor", date: "2026-09-25" });
  store.resolveDispute("D1", { date: "2026-09-26", resolution: "release" });
  assert.throws(() => store.resolveDispute("D1", { date: "2026-09-27", resolution: "release" }), /已结案/);
});

test("销售分成计提与更正只影响对应期间", () => {
  const store = createStore(loadSample());
  const { payment, breakdown } = store.accrueRoyalty({
    period: "2026Q3",
    net_sales: 600000000,
    date: "2026-10-05",
  });
  assert.equal(payment.id, "R-2026Q3");
  assert.equal(payment.amount_minor, 5200000000);
  assert.equal(payment.due_date, "2026-10-30");
  assert.equal(payment.fx_lock.rate, 7.11, "按季度末锁汇");
  assert.equal(breakdown.length, 2);

  store.issueInvoice("R-2026Q3", { date: "2026-10-06" });
  store.openDispute({
    payment_ids: ["R-2026Q3"],
    reason: "净销售额口径更正为5.5亿美元",
    opened_by: "licensee",
    date: "2026-10-07",
  });
  store.resolveDispute("D1", {
    date: "2026-10-08",
    resolution: "adjust",
    corrected_amounts: { "R-2026Q3": 46000000 },
  });
  assert.equal(store.state.payments["R-2026Q3"].invoice.gross_minor, 4600000000);
  assert.equal(store.state.payments.P0.status, "scheduled", "首付款义务不受销售数据更正影响");
});
