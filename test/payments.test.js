import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { findPayment, invoiceFor, paymentDueDate, paymentStatus, recomputePayment, royaltyAmount } from "../src/payments.js";
import { suspendedPaymentIds } from "../src/disputes.js";

const deal = JSON.parse(await readFile(new URL("../contracts/license_deal.json", import.meta.url), "utf8")).sample;
const AS_OF = "2026-10-01";

test("首付款复算：锁汇折算与预提税", () => {
  const calc = recomputePayment(deal, findPayment(deal, "P1"));
  assert.equal(calc.gross, 40000000);
  assert.deepEqual(calc.fx, { locked: true, pair: "USD/CNY", rate: 7.1, locked_at: "2026-01-15T09:30:00+08:00" });
  assert.equal(calc.settlement.gross, 284000000);
  assert.equal(calc.withholding.amount, 28400000);
  assert.equal(calc.net, 255600000);
  assert.equal(calc.due_on, "2026-02-09");
});

test("含税倒算：收款方净得约定金额", () => {
  const calc = recomputePayment(deal, findPayment(deal, "P4"));
  assert.equal(calc.settlement.gross, 634500000);
  assert.equal(calc.withholding.invoiced, 705000000);
  assert.equal(calc.withholding.amount, 70500000);
  assert.equal(calc.net, 634500000);
});

test("未锁汇付款只能算到待锁汇", () => {
  const calc = recomputePayment(deal, findPayment(deal, "P3"));
  assert.equal(calc.fx.locked, false);
  assert.equal(calc.settlement, null);
  assert.equal(calc.net, null);
});

test("阶梯销售分成", () => {
  const tiers = [
    { up_to: 100000000, rate: 0.08 },
    { up_to: null, rate: 0.12 },
  ];
  assert.equal(royaltyAmount(tiers, 120000000), 10400000);
  assert.equal(royaltyAmount(tiers, 80000000), 6400000);
  const calc = recomputePayment(deal, findPayment(deal, "P5"));
  assert.equal(calc.gross, 10400000);
  assert.equal(calc.settlement.gross, 74048000);
  assert.equal(calc.net, 66643200);
});

test("应付日锚定规则", () => {
  assert.equal(paymentDueDate(deal, findPayment(deal, "P1")), "2026-02-09"); // 签约 +30
  assert.equal(paymentDueDate(deal, findPayment(deal, "P2")), "2026-04-18"); // E1 +45
  assert.equal(paymentDueDate(deal, findPayment(deal, "P3")), null); // M3 未达成
  assert.equal(paymentDueDate(deal, findPayment(deal, "P4")), null); // E2 未确认
  assert.equal(paymentDueDate(deal, findPayment(deal, "P5")), "2026-08-15"); // 固定日
});

test("付款状态：已付/暂停/待触发/逾期", () => {
  const suspended = suspendedPaymentIds(deal);
  assert.equal(paymentStatus(deal, findPayment(deal, "P1"), AS_OF, suspended), "paid");
  assert.equal(paymentStatus(deal, findPayment(deal, "P2"), AS_OF, suspended), "suspended");
  assert.equal(paymentStatus(deal, findPayment(deal, "P3"), AS_OF, suspended), "pendingTrigger");
  assert.equal(paymentStatus(deal, findPayment(deal, "P5"), AS_OF, suspended), "overdue");
});

test("发票金额与复算一致", () => {
  const invoice = invoiceFor(deal, findPayment(deal, "P1"));
  assert.equal(invoice.invoice_no, "INV-BD-2026-008-P1");
  assert.equal(invoice.currency, "CNY");
  assert.deepEqual(
    invoice.lines.map((l) => l.amount),
    [284000000, -28400000],
  );
  assert.equal(invoice.total_due, 255600000);
});

test("未锁汇付款无法开票", () => {
  assert.throws(() => invoiceFor(deal, findPayment(deal, "P3")), /尚未锁汇/);
});
