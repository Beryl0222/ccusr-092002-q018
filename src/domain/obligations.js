import { addDays } from "./dates.js";
import { unmetDependencies } from "./milestones.js";

// 下一项义务由哪一方承担：汇总待确认里程碑、待推进事件、未结付款与季度销售报告，
// 按到期日排序；提醒则是在此基础上按窗口期过滤。

const PAYMENT_KIND_LABEL = {
  upfront: "首付款",
  milestone: "里程碑付款",
  royalty: "销售分成",
};

function previousQuarterReportDue(today, dueDay) {
  const [year, month] = today.split("-").map(Number);
  const prevQuarterEndMonth = Math.floor((month - 1) / 3) * 3; // 0/3/6/9
  const dueMonth = (prevQuarterEndMonth % 12) + 1;
  return `${year}-${String(dueMonth).padStart(2, "0")}-${String(dueDay).padStart(2, "0")}`;
}

export function nextObligations(deal, state, today) {
  const items = [];
  const reviewWindow = deal.reminders?.review_window_days ?? 15;

  for (const milestone of deal.milestones ?? []) {
    const current = state.milestones[milestone.id];
    if (!current) continue;
    if (current.status === "reported") {
      const other = (deal.parties ?? []).find((p) => p.id !== current.reported_by);
      items.push({
        type: "milestone_confirmation",
        id: milestone.id,
        title: `确认里程碑事件：${milestone.event}`,
        responsible: other?.id ?? null,
        due_date: addDays(current.reported_on, reviewWindow),
        status: current.status,
        overdue: false,
        detail: `${current.reported_by} 已于 ${current.reported_on} 申报，待对方确认`,
      });
    } else if (
      current.status === "pending" &&
      unmetDependencies(deal, state.milestones, milestone.id).length === 0
    ) {
      items.push({
        type: "milestone_event",
        id: milestone.id,
        title: `推进里程碑：${milestone.event}`,
        responsible: milestone.responsible ?? "licensee",
        due_date: null,
        status: current.status,
        overdue: false,
        detail: "依赖已满足，待事件发生并申报",
      });
    }
  }

  for (const payment of Object.values(state.payments)) {
    if (payment.status === "paid") continue;
    const suspended = payment.status === "suspended";
    items.push({
      type: "payment",
      id: payment.id,
      title: `${PAYMENT_KIND_LABEL[payment.kind] ?? payment.kind}（${payment.currency} ${(payment.amount_minor / 100).toFixed(2)}）`,
      responsible: suspended ? null : payment.payer,
      counterparty: payment.payee,
      due_date: payment.due_date,
      status: payment.status,
      overdue: !suspended && payment.due_date < today,
      detail: suspended ? "争议冻结中，仅暂停本笔付款" : null,
    });
  }

  if (deal.royalties) {
    const dueDay = deal.reminders?.royalty_report_due_day ?? 30;
    const due = previousQuarterReportDue(today, dueDay);
    items.push({
      type: "royalty_report",
      id: `RR-${today}`,
      title: "提交季度净销售额报告",
      responsible: deal.royalties.payer,
      due_date: due,
      status: "pending",
      overdue: due < today,
      detail: null,
    });
  }

  items.sort((a, b) => {
    if (a.due_date === null && b.due_date === null) return a.type < b.type ? -1 : 1;
    if (a.due_date === null) return 1;
    if (b.due_date === null) return -1;
    if (a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
    return a.type < b.type ? -1 : 1;
  });
  return items;
}

export function reminders(deal, state, today, windowDays) {
  const limit = addDays(today, windowDays);
  return nextObligations(deal, state, today).filter(
    (item) => item.due_date !== null && item.due_date <= limit,
  );
}
