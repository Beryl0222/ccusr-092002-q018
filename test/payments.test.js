import assert from "node:assert/strict";
import test from "node:test";

import {
  computeInvoice,
  computeRoyalty,
  issueInvoiceRecord,
  lockFxRate,
  makePaymentRecord,
  recomputePayment,
  recordPaymentReceived,
} from "../src/domain/payments.js";
import { toMinor } from "../src/domain/money.js";
import { loadSample } from "../src/store.js";

const RATES = loadSample().fx.rates;

test("汇率锁定取锁定日或之前最近牌价", () => {
  const locked = lockFxRate(RATES, "USD/CNY", "2026-09-20");
  assert.equal(locked.rate, 7.11);
  assert.equal(locked.rate_date, "2026-09-15");
  assert.equal(locked.locked_on, "2026-09-20");
  assert.equal(lockFxRate(RATES, "USD/CNY", "2026-10-01").rate, 7.09);
  assert.throws(() => lockFxRate(RATES, "USD/CNY", "2026-08-01"), /缺少 USD\/CNY/);
});

test("发票 = 总额 − 预提税，并按锁定汇率折算本位币", () => {
  const invoice = computeInvoice(
    { amountMinor: toMinor(20000000), currency: "USD" },
    {
      fxLock: { pair: "USD/CNY", rate: 7.11, rate_date: "2026-09-15", locked_on: "2026-09-22" },
      homeCurrency: "CNY",
      withholdingRate: 0.1,
    },
  );
  assert.equal(invoice.gross_minor, 2000000000);
  assert.equal(invoice.withholding_minor, 200000000);
  assert.equal(invoice.net_minor, 1800000000);
  assert.equal(invoice.fx.gross_home_minor, 14220000000);
  assert.equal(invoice.fx.net_home_minor, 12798000000);
});

test("销售分成按档位累进", () => {
  const tiers = loadSample().royalties.tiers;
  const mid = computeRoyalty(tiers, toMinor(600000000));
  assert.equal(mid.total_minor, toMinor(52000000));
  assert.equal(mid.breakdown.length, 2);
  const top = computeRoyalty(tiers, toMinor(2000000000));
  assert.equal(top.total_minor, toMinor(240000000));
  assert.equal(top.breakdown.length, 3);
  const low = computeRoyalty(tiers, toMinor(100000000));
  assert.equal(low.total_minor, toMinor(8000000));
  assert.equal(low.breakdown.length, 1);
});

function invoicedPayment() {
  const payment = makePaymentRecord({
    id: "PX",
    kind: "milestone",
    source: "M1",
    amount: 20000000,
    currency: "USD",
    payer: "licensee",
    payee: "licensor",
    dueDate: "2026-10-22",
    fxLock: { pair: "USD/CNY", rate: 7.11, rate_date: "2026-09-15", locked_on: "2026-09-22" },
    withholdingRate: 0.1,
  });
  issueInvoiceRecord(payment, "CNY");
  return payment;
}

test("财务可复算：账面与重算一致，篡改即现形", () => {
  const payment = invoicedPayment();
  assert.equal(recomputePayment(payment, "CNY").ok, true);
  payment.amount_minor += 100;
  const check = recomputePayment(payment, "CNY");
  assert.equal(check.ok, false);
  assert.ok(check.mismatches.some((line) => line.includes("gross_minor")));
});


test("状态机约束：未开票不能收款，冻结不能开票", () => {
  const payment = invoicedPayment();
  recordPaymentReceived(payment, { date: "2026-10-22" });
  assert.equal(payment.status, "paid");

  const fresh = makePaymentRecord({
    id: "PY",
    kind: "milestone",
    source: "M2",
    amount: 100,
    currency: "USD",
    payer: "licensee",
    payee: "licensor",
    dueDate: "2026-11-01",
    fxLock: { pair: "USD/CNY", rate: 7.11, rate_date: "2026-09-15", locked_on: "2026-09-22" },
    withholdingRate: 0.1,
  });
  assert.throws(() => recordPaymentReceived(fresh, { date: "2026-10-01" }), /尚未开票/);
  fresh.status = "suspended";
  assert.throws(() => issueInvoiceRecord(fresh, "CNY"), /不能开票/);
});
