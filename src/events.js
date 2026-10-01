export const EVENT_TYPES = {
  clinical: "临床",
  regulatory: "注册",
  sales: "销售",
  patent: "专利",
};

export function partyIds(deal) {
  return deal.parties.map((p) => p.id);
}

export function findEvent(deal, eventId) {
  const event = deal.events.find((e) => e.id === eventId);
  if (!event) throw new Error(`未知事件: ${eventId}`);
  return event;
}

// 事件须双方确认后才可驱动里程碑。
export function isConfirmed(deal, event) {
  return partyIds(deal).every((id) => Boolean(event.confirmations[id]));
}

export function pendingConfirmations(deal, event) {
  return partyIds(deal).filter((id) => !event.confirmations[id]);
}

export function confirmEvent(deal, eventId, party, confirmation) {
  if (!partyIds(deal).includes(party)) throw new Error(`未知当事方: ${party}`);
  const next = structuredClone(deal);
  const event = findEvent(next, eventId);
  if (!event.occurred_on) throw new Error(`事件 ${eventId} 尚未发生，不能确认`);
  if (event.confirmations[party]) throw new Error(`${party} 已确认事件 ${eventId}`);
  event.confirmations[party] = { by: confirmation.by, at: confirmation.at };
  return next;
}

// 数据更正：改写发生日期并清空双方确认，相关付款随之暂停，直到重新确认。
export function correctEvent(deal, eventId, correction) {
  const next = structuredClone(deal);
  const event = findEvent(next, eventId);
  if (!event.occurred_on) throw new Error(`事件 ${eventId} 尚未发生，不能更正`);
  event.corrections.push({
    from: event.occurred_on,
    to: correction.occurred_on,
    by: correction.by,
    reason: correction.reason,
    at: correction.at,
  });
  event.occurred_on = correction.occurred_on;
  event.confirmations = {};
  return next;
}

// 更正后未经双方重新确认的事件，其关联付款视为暂停。
export function hasPendingCorrection(deal, event) {
  return event.corrections.length > 0 && !isConfirmed(deal, event);
}
