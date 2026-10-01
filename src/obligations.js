import { addDays, isBefore } from "./dates.js";
import { isConfirmed, pendingConfirmations } from "./events.js";
import { paymentDueDate, grossAmount } from "./payments.js";
import { suspendedPaymentIds } from "./disputes.js";

// 汇总当前可见义务：到期付款、待双方确认的事件、待升级的僵局；已暂停付款不出现。
export function nextObligations(deal, asOf) {
  const suspended = suspendedPaymentIds(deal);
  const obligations = [];
  for (const payment of deal.payments) {
    if (payment.paid_on || suspended.has(payment.id)) continue;
    const dueOn = paymentDueDate(deal, payment);
    if (!dueOn) continue;
    obligations.push({
      kind: "付款",
      ref_id: payment.id,
      party: payment.payer,
      due_on: dueOn,
      overdue: isBefore(dueOn, asOf),
      description: `${payment.type} ${grossAmount(payment)} ${payment.currency}`,
    });
  }
  for (const event of deal.events) {
    if (!event.occurred_on || isConfirmed(deal, event)) continue;
    const dueOn = addDays(event.occurred_on, deal.confirmation_window_days);
    for (const party of pendingConfirmations(deal, event)) {
      obligations.push({
        kind: "事件确认",
        ref_id: event.id,
        party,
        due_on: dueOn,
        overdue: isBefore(dueOn, asOf),
        description: `确认事件：${event.title}`,
      });
    }
  }
  for (const motion of deal.jdc.motions.filter((m) => m.status === "僵局升级")) {
    obligations.push({
      kind: "僵局升级",
      ref_id: motion.id,
      party: "双方",
      due_on: asOf,
      overdue: true,
      description: `议题「${motion.title}」升级至${motion.escalate_to}`,
    });
  }
  return obligations.sort((a, b) => (a.due_on === b.due_on ? a.ref_id.localeCompare(b.ref_id) : a.due_on < b.due_on ? -1 : 1));
}

// 项目负责人视角：某一方承担的下一项义务。
export function nextObligationFor(deal, party, asOf) {
  return nextObligations(deal, asOf).find((o) => o.party === party) ?? null;
}

// 提醒窗口：未来 withinDays 天内到期或已逾期的义务。
export function reminders(deal, asOf, withinDays = 30) {
  const horizon = addDays(asOf, withinDays);
  return nextObligations(deal, asOf).filter((o) => o.overdue || o.due_on <= horizon);
}
