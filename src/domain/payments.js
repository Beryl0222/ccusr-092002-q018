import { require } from "./errors.js";
import { fxToScaled, mulFx, mulRate, toMinor } from "./money.js";

// 汇率锁定：取锁定日（含）之前最近的一条牌价，锁定记录随付款保存。
export function lockFxRate(rates, pair, lockDate) {
  const candidates = (rates ?? [])
    .filter((rate) => rate.pair === pair && rate.date <= lockDate)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  require(candidates.length > 0, `缺少 ${pair} 在 ${lockDate} 或之前的汇率`);
  const chosen = candidates[0];
  return { pair, rate: chosen.rate, rate_date: chosen.date, locked_on: lockDate };
}

export function findWithholdingRate(table, payerCountry, payeeCountry) {
  const row = (table ?? []).find(
    (r) => r.payer_country === payerCountry && r.payee_country === payeeCountry,
  );
  return row ? row.rate : 0;
}

// 发票 = 应付总额 − 预提税 = 实付净额；同时按锁定汇率折算本位币。
// 所有输入（金额、税率、汇率）都保存在付款记录里，财务可逐笔复算。
export function computeInvoice({ amountMinor, currency }, { fxLock, homeCurrency, withholdingRate }) {
  const gross = amountMinor;
  const withholding = mulRate(gross, withholdingRate);
  const net = gross - withholding;
  const scaled = fxToScaled(fxLock.rate);
  return {
    currency,
    gross_minor: gross,
    withholding_rate: withholdingRate,
    withholding_minor: withholding,
    net_minor: net,
    fx: {
      pair: fxLock.pair,
      rate: fxLock.rate,
      rate_date: fxLock.rate_date,
      locked_on: fxLock.locked_on,
      home_currency: homeCurrency,
      gross_home_minor: mulFx(gross, scaled),
      withholding_home_minor: mulFx(withholding, scaled),
      net_home_minor: mulFx(net, scaled),
    },
  };
}

export function makePaymentRecord({
  id,
  kind,
  source,
  amount,
  currency,
  payer,
  payee,
  dueDate,
  fxLock,
  withholdingRate,
}) {
  return {
    id,
    kind,
    source,
    status: "scheduled",
    amount_minor: toMinor(amount),
    currency,
    payer,
    payee,
    due_date: dueDate,
    fx_lock: fxLock,
    withholding_rate: withholdingRate,
    invoice: null,
    invoiced_on: null,
    paid_on: null,
    adjustments: [],
  };
}

export function issueInvoiceRecord(payment, homeCurrency) {
  require(payment.status === "scheduled", `付款 ${payment.id} 当前状态为 ${payment.status}，不能开票`, 409);
  payment.invoice = computeInvoice(
    { amountMinor: payment.amount_minor, currency: payment.currency },
    { fxLock: payment.fx_lock, homeCurrency, withholdingRate: payment.withholding_rate },
  );
  payment.status = "invoiced";
  return payment.invoice;
}

export function recordPaymentReceived(payment, { date }) {
  require(payment.status === "invoiced", `付款 ${payment.id} 尚未开票，不能登记收款`, 409);
  payment.status = "paid";
  payment.paid_on = date;
  return payment;
}

// 财务复算：用付款记录里保存的原始输入重算发票，逐项比对账面值。
export function recomputePayment(payment, homeCurrency) {
  if (!payment.invoice) {
    return { ok: false, mismatches: ["尚未开票，无发票可复算"] };
  }
  const expected = computeInvoice(
    { amountMinor: payment.amount_minor, currency: payment.currency },
    { fxLock: payment.fx_lock, homeCurrency, withholdingRate: payment.withholding_rate },
  );
  const mismatches = [];
  for (const key of ["gross_minor", "withholding_minor", "net_minor"]) {
    if (payment.invoice[key] !== expected[key]) {
      mismatches.push(`${key}: 账面 ${payment.invoice[key]} ≠ 复算 ${expected[key]}`);
    }
  }
  for (const key of ["gross_home_minor", "withholding_home_minor", "net_home_minor"]) {
    if (payment.invoice.fx[key] !== expected.fx[key]) {
      mismatches.push(`fx.${key}: 账面 ${payment.invoice.fx[key]} ≠ 复算 ${expected.fx[key]}`);
    }
  }
  return { ok: mismatches.length === 0, mismatches, expected };
}

// 销售分成：按档位累进计算（类似税档）。
export function computeRoyalty(tiers, netSalesMinor) {
  let remaining = netSalesMinor;
  let lower = 0;
  let total = 0;
  const breakdown = [];
  for (const tier of tiers) {
    const upper = tier.up_to === null ? Infinity : toMinor(tier.up_to);
    const width = Math.max(0, Math.min(remaining, upper - lower));
    if (width > 0) {
      const amount = mulRate(width, tier.rate);
      breakdown.push({ up_to: tier.up_to, rate: tier.rate, base_minor: width, amount_minor: amount });
      total += amount;
    }
    remaining -= width;
    lower = upper;
    if (remaining <= 0) break;
  }
  return { total_minor: total, breakdown };
}
