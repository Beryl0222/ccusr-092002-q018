import { require } from "./errors.js";
import { computeInvoice } from "./payments.js";

// 争议与数据更正：只暂停被点名的付款，绝不连带冻结无关义务。

export function openDispute(state, { paymentIds, reason, openedBy, date }) {
  require(Array.isArray(paymentIds) && paymentIds.length > 0, "争议须指定至少一笔付款");
  require(reason, "争议须说明理由");
  for (const pid of paymentIds) {
    const payment = state.payments[pid];
    require(payment, `未找到付款: ${pid}`, 404);
    require(
      payment.status === "scheduled" || payment.status === "invoiced",
      `付款 ${pid} 状态为 ${payment.status}，不能冻结`,
      409,
    );
  }
  const id = `D${(state.counter.dispute += 1)}`;
  for (const pid of paymentIds) {
    const payment = state.payments[pid];
    payment.previous_status = payment.status;
    payment.status = "suspended";
  }
  const dispute = {
    id,
    payment_ids: [...paymentIds],
    reason,
    opened_by: openedBy,
    opened_on: date,
    status: "open",
    resolution: null,
  };
  state.disputes.push(dispute);
  return dispute;
}

export function resolveDispute(state, disputeId, { date, resolution, correctedAmounts = {}, homeCurrency }) {
  const dispute = state.disputes.find((d) => d.id === disputeId);
  require(dispute, `未找到争议: ${disputeId}`, 404);
  require(dispute.status === "open", `争议 ${disputeId} 已结案`, 409);
  require(resolution === "release" || resolution === "adjust", "resolution 须为 release 或 adjust");
  for (const pid of dispute.payment_ids) {
    const payment = state.payments[pid];
    if (resolution === "adjust" && correctedAmounts[pid] !== undefined) {
      const corrected = correctedAmounts[pid];
      payment.adjustments.push({
        date,
        reason: dispute.reason,
        from_minor: payment.amount_minor,
        to_minor: corrected,
      });
      payment.amount_minor = corrected;
      if (payment.previous_status === "invoiced") {
        payment.invoice = computeInvoice(
          { amountMinor: payment.amount_minor, currency: payment.currency },
          { fxLock: payment.fx_lock, homeCurrency, withholdingRate: payment.withholding_rate },
        );
      }
    }
    payment.status = payment.previous_status;
    payment.previous_status = null;
  }
  dispute.status = "resolved";
  dispute.resolution = { type: resolution, date, corrected_amounts: correctedAmounts };
  return dispute;
}

export function activeSuspensions(state) {
  return Object.values(state.payments)
    .filter((payment) => payment.status === "suspended")
    .map((payment) => payment.id);
}
