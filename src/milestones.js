import { findEvent, isConfirmed } from "./events.js";

export const MILESTONE_STATUS = {
  achieved: "已达成",
  waiting: "待事件确认",
  blocked: "被依赖阻塞",
};

function findMilestone(deal, id) {
  const milestone = deal.milestones.find((m) => m.id === id);
  if (!milestone) throw new Error(`未知里程碑: ${id}`);
  return milestone;
}

// 递归求值里程碑状态，带循环检测；无触发事件的里程碑视为签约即达成。
export function evaluateMilestones(deal) {
  const memo = new Map();
  const visiting = new Set();
  const evaluate = (milestone) => {
    if (memo.has(milestone.id)) return memo.get(milestone.id);
    if (visiting.has(milestone.id)) throw new Error(`里程碑依赖存在循环: ${milestone.id}`);
    visiting.add(milestone.id);
    const depsAchieved = milestone.depends_on.every((id) => evaluate(findMilestone(deal, id)) === "achieved");
    let status;
    if (!depsAchieved) {
      status = "blocked";
    } else if (!milestone.trigger_event) {
      status = "achieved";
    } else {
      status = isConfirmed(deal, findEvent(deal, milestone.trigger_event)) ? "achieved" : "waiting";
    }
    visiting.delete(milestone.id);
    memo.set(milestone.id, status);
    return status;
  };
  const result = {};
  for (const milestone of deal.milestones) result[milestone.id] = evaluate(milestone);
  return result;
}

// 达成日期用于付款锚定：无触发事件的锚到签约日，否则锚到事件发生日。
export function milestoneAchievedOn(deal, milestoneId) {
  const milestone = findMilestone(deal, milestoneId);
  if (evaluateMilestones(deal)[milestoneId] !== "achieved") return null;
  if (!milestone.trigger_event) return deal.signed_on;
  return findEvent(deal, milestone.trigger_event).occurred_on;
}
