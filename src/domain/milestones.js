import { assertIsoDate } from "./dates.js";
import { require } from "./errors.js";

// 里程碑状态机：pending → reported → confirmed（或 reported → pending 的异议回退）。
// 事件须由一方申报、对方确认（双方确认原则），且全部依赖确认后才可申报。

export function initMilestoneState(deal) {
  const state = {};
  for (const milestone of deal.milestones ?? []) {
    state[milestone.id] = {
      status: "pending",
      reported_by: null,
      reported_on: null,
      confirmed_by: null,
      confirmed_on: null,
      evidence: null,
      history: [],
    };
  }
  return state;
}

export function getMilestone(deal, id) {
  const milestone = (deal.milestones ?? []).find((m) => m.id === id);
  require(milestone, `未找到里程碑: ${id}`, 404);
  return milestone;
}

export function unmetDependencies(deal, state, id) {
  return getMilestone(deal, id).depends_on.filter((dep) => state[dep]?.status !== "confirmed");
}

export function dependenciesMet(deal, state, id) {
  return unmetDependencies(deal, state, id).length === 0;
}

function requireParty(deal, party) {
  require((deal.parties ?? []).some((p) => p.id === party), `未知当事方: ${party}`);
}

export function reportEvent(deal, state, id, { party, date, evidence = null }) {
  const milestone = getMilestone(deal, id);
  const current = state[id];
  requireParty(deal, party);
  assertIsoDate(date);
  require(current.status === "pending", `里程碑 ${id} 当前状态为 ${current.status}，不能申报`, 409);
  const missing = unmetDependencies(deal, state, id);
  require(missing.length === 0, `里程碑 ${id} 的依赖尚未确认: ${missing.join(", ")}`, 409);
  current.status = "reported";
  current.reported_by = party;
  current.reported_on = date;
  current.evidence = evidence;
  current.history.push({ action: "report", party, date });
  return { id, status: current.status, event: milestone.event };
}

export function confirmEvent(deal, state, id, { party, date }) {
  const milestone = getMilestone(deal, id);
  const current = state[id];
  requireParty(deal, party);
  assertIsoDate(date);
  require(current.status === "reported", `里程碑 ${id} 尚未申报，不能确认`, 409);
  require(party !== current.reported_by, "确认方须为对方（双方确认原则）");
  current.status = "confirmed";
  current.confirmed_by = party;
  current.confirmed_on = date;
  current.history.push({ action: "confirm", party, date });
  return { id, status: current.status, confirmed_on: date, payment: milestone.payment ?? null };
}

export function rejectEvent(deal, state, id, { party, date, reason = null }) {
  const current = state[id];
  getMilestone(deal, id);
  requireParty(deal, party);
  assertIsoDate(date);
  require(current.status === "reported", `里程碑 ${id} 未处于待确认状态`, 409);
  require(party !== current.reported_by, "异议须由对方提出");
  const rejectedReportOf = current.reported_by;
  current.status = "pending";
  current.reported_by = null;
  current.reported_on = null;
  current.evidence = null;
  current.history.push({ action: "reject", party, date, reason });
  return { id, status: current.status, rejected_report_of: rejectedReportOf };
}

export function milestoneBoard(deal, state) {
  return (deal.milestones ?? []).map((milestone) => ({
    id: milestone.id,
    category: milestone.category,
    event: milestone.event,
    responsible: milestone.responsible ?? "licensee",
    status: state[milestone.id].status,
    depends_on: milestone.depends_on,
    blocked_by: unmetDependencies(deal, state, milestone.id),
    payment_id: milestone.payment?.id ?? null,
    history: state[milestone.id].history,
  }));
}
