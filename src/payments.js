import { addDays, isBefore } from "./dates.js";
import { findEvent, isConfirmed } from "./events.js";
import { milestoneAchievedOn } from "./milestones.js";

export function round2(amount) {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function findPayment(deal, paymentId) {
  const payment = deal.payments.find((p) => p.id === paymentId);
  if (!payment) throw new Error(`未知付款: ${paymentId}`);
  return payment;
}

// 阶梯销售分成：up_to 为 null 表示上不封顶。
export function royaltyAmount(tiers, netSales) {
  let lower = 0;
  let total = 0;
  for (const tier of tiers) {
    const upper = tier.up_to ?? Number.POSITIVE_INFINITY;
    if (upper <= lower) throw new Error("分成阶梯必须递增");
    const taxable = Math.max(0, Math.min(netSales, upper) - lower);
    total += taxable * tier.rate;
    lower = upper;
  }
  return round2(total);
}

export function grossAmount(payment) {
  if (payment.type === "销售分成") {
    if (!payment.sales_report) throw new Error(`付款 ${payment.id} 缺少销售报告`);
    return royaltyAmount(payment.royalty_tiers, payment.sales_report.net_sales);
  }
  return payment.amount;
}

// 应付日锚定：签约日 / 固定日 / 事件日 / 里程碑达成日，加偏移天数；锚未成就返回 null。
export function paymentDueDate(deal, payment) {
  const rule = payment.due_rule;
  if (!rule) return null;
  const offset = rule.offset_days ?? 0;
  if (rule.anchor === "signing") return addDays(deal.signed_on, offset);
  if (rule.anchor === "fixed") return rule.due_on;
  if (rule.anchor.startsWith("event:")) {
    const event = findEvent(deal, rule.anchor.slice("event:".length));
    return isConfirmed(deal, event) ? addDays(event.occurred_on, offset) : null;
  }
  if (rule.anchor.startsWith("milestone:")) {
    const achievedOn = milestoneAchievedOn(deal, rule.anchor.slice("milestone:".length));
    return achievedOn ? addDays(achievedOn, offset) : null;
  }
  throw new Error(`未知应付日锚点: ${rule.anchor}`);
}

function needsFx(payment) {
  return payment.settlement_currency && payment.settlement_currency !== payment.currency;
}

// 复算一笔付款：总额 → 锁汇折算 → 预提税 → 净额，财务可凭存储条款逐步重算。
export function recomputePayment(deal, payment) {
  const gross = grossAmount(payment);
  const result = {
    payment_id: payment.id,
    type: payment.type,
    gross,
    currency: payment.currency,
    due_on: paymentDueDate(deal, payment),
    fx: null,
    settlement: null,
    withholding: null,
    net: null,
  };
  let settlementGross = gross;
  let settlementCurrency = payment.currency;
  if (needsFx(payment)) {
    settlementCurrency = payment.settlement_currency;
    if (!payment.fx_lock) {
      result.fx = { locked: false, pair: `${payment.currency}/${payment.settlement_currency}` };
      return result; // 待锁汇：结算金额未定
    }
    const expectedPair = `${payment.currency}/${payment.settlement_currency}`;
    if (payment.fx_lock.pair !== expectedPair) {
      throw new Error(`锁汇货币对 ${payment.fx_lock.pair} 与付款币种 ${expectedPair} 不符`);
    }
    settlementGross = round2(gross * payment.fx_lock.rate);
    result.fx = { locked: true, pair: expectedPair, rate: payment.fx_lock.rate, locked_at: payment.fx_lock.locked_at };
  }
  result.settlement = { gross: settlementGross, currency: settlementCurrency };
  const withholding = payment.withholding;
  if (withholding && withholding.rate > 0) {
    if (withholding.gross_up) {
      // 含税倒算：付款方承担预提税，收款方净得约定金额。
      const invoiced = round2(settlementGross / (1 - withholding.rate));
      result.withholding = {
        jurisdiction: withholding.jurisdiction,
        rate: withholding.rate,
        gross_up: true,
        invoiced,
        amount: round2(invoiced - settlementGross),
      };
      result.net = settlementGross;
    } else {
      const amount = round2(settlementGross * withholding.rate);
      result.withholding = { jurisdiction: withholding.jurisdiction, rate: withholding.rate, gross_up: false, amount };
      result.net = round2(settlementGross - amount);
    }
  } else {
    result.net = settlementGross;
  }
  return result;
}

// 发票：付款行 + 预提税行，金额取自复算结果，保证票账一致。
export function invoiceFor(deal, payment) {
  const calc = recomputePayment(deal, payment);
  if (!calc.settlement) throw new Error(`付款 ${payment.id} 尚未锁汇，无法开票`);
  const grossUp = calc.withholding?.gross_up === true;
  const base = grossUp ? calc.withholding.invoiced : calc.settlement.gross;
  const lines = [{ label: `${payment.type}（${payment.id}${grossUp ? "，含税倒算" : ""}）`, amount: base }];
  if (calc.withholding) {
    lines.push({ label: `预提税（${calc.withholding.jurisdiction} ${calc.withholding.rate * 100}%）`, amount: -calc.withholding.amount });
  }
  return {
    invoice_no: `INV-${deal.deal_id}-${payment.id}`,
    deal_id: deal.deal_id,
    payer: payment.payer,
    payee: payment.payee,
    currency: calc.settlement.currency,
    due_on: calc.due_on,
    fx: calc.fx,
    lines,
    total_due: calc.withholding?.gross_up ? calc.withholding.invoiced - calc.withholding.amount : calc.net,
  };
}

export const PAYMENT_STATUS = {
  paid: "已支付",
  suspended: "已暂停",
  pendingTrigger: "待触发",
  pendingFx: "待锁汇",
  overdue: "已逾期",
  due: "应付",
};

export function paymentStatus(deal, payment, asOf, suspendedIds) {
  if (payment.paid_on) return "paid";
  if (suspendedIds?.has(payment.id)) return "suspended";
  const dueOn = paymentDueDate(deal, payment);
  if (!dueOn) return "pendingTrigger";
  if (needsFx(payment) && !payment.fx_lock) return "pendingFx";
  if (asOf && isBefore(dueOn, asOf)) return "overdue";
  return "due";
}

export function paymentSummary(deal, asOf, suspendedIds) {
  return deal.payments.map((p) => ({
    id: p.id,
    type: p.type,
    status: paymentStatus(deal, p, asOf, suspendedIds),
    due_on: paymentDueDate(deal, p),
    gross: p.type === "销售分成" && p.sales_report ? grossAmount(p) : p.amount,
    currency: p.currency,
    payer: p.payer,
    payee: p.payee,
  }));
}
