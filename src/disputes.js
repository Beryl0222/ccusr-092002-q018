import { findEvent, hasPendingCorrection, partyIds } from "./events.js";
import { findPayment } from "./payments.js";

// 争议只暂停其直接关联的付款，不连带冻结其他义务。
export function openDispute(deal, { target_type, target_id, raised_by, reason, opened_on }) {
  if (!partyIds(deal).includes(raised_by)) throw new Error(`未知当事方: ${raised_by}`);
  resolveTarget(deal, target_type, target_id); // 校验目标存在
  const next = structuredClone(deal);
  next.disputes.push({
    id: `D${next.disputes.length + 1}`,
    target_type,
    target_id,
    raised_by,
    reason,
    opened_on,
    status: "处理中",
  });
  return next;
}

export function resolveDispute(deal, disputeId, resolution) {
  const next = structuredClone(deal);
  const dispute = next.disputes.find((d) => d.id === disputeId);
  if (!dispute) throw new Error(`未知争议: ${disputeId}`);
  if (dispute.status !== "处理中") throw new Error(`争议 ${disputeId} 已了结`);
  dispute.status = "已解决";
  dispute.resolution = resolution;
  return next;
}

function resolveTarget(deal, targetType, targetId) {
  if (targetType === "payment") return findPayment(deal, targetId);
  if (targetType === "milestone") {
    const milestone = deal.milestones.find((m) => m.id === targetId);
    if (!milestone) throw new Error(`未知里程碑: ${targetId}`);
    return milestone;
  }
  if (targetType === "event") return findEvent(deal, targetId);
  throw new Error(`未知争议目标类型: ${targetType}`);
}

// 目标 → 受影响付款：付款本身 / 里程碑对应的付款 / 事件触发的里程碑付款。
function paymentsForTarget(deal, targetType, targetId) {
  if (targetType === "payment") return [targetId];
  if (targetType === "milestone") {
    const milestone = deal.milestones.find((m) => m.id === targetId);
    return milestone?.payment_id ? [milestone.payment_id] : [];
  }
  return deal.milestones.filter((m) => m.trigger_event === targetId && m.payment_id).map((m) => m.payment_id);
}

export function suspendedPaymentIds(deal) {
  const suspended = new Set();
  for (const dispute of deal.disputes.filter((d) => d.status === "处理中")) {
    for (const id of paymentsForTarget(deal, dispute.target_type, dispute.target_id)) suspended.add(id);
  }
  for (const event of deal.events.filter((e) => hasPendingCorrection(deal, e))) {
    for (const id of paymentsForTarget(deal, "event", event.id)) suspended.add(id);
  }
  return suspended;
}
