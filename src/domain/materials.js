import { require } from "./errors.js";

// 材料权限：所有方始终可读；约定解锁里程碑的材料须待其确认后才向对方开放；
// 每次访问尝试都留痕。

export function canAccess(deal, state, materialId, party) {
  const material = (deal.materials ?? []).find((m) => m.id === materialId);
  require(material, `未找到材料: ${materialId}`, 404);
  if (material.owner === party) {
    return { allowed: true, reason: "材料所有方" };
  }
  if (material.unlock_after) {
    const milestone = state.milestones[material.unlock_after];
    if (!milestone || milestone.status !== "confirmed") {
      return { allowed: false, reason: `需待里程碑 ${material.unlock_after} 确认后开放` };
    }
  }
  if ((material.allowed_parties ?? []).includes(party)) {
    return { allowed: true, reason: "授权范围内" };
  }
  return { allowed: false, reason: "不在授权范围" };
}

export function accessMaterial(deal, state, materialId, { party, date }) {
  const result = canAccess(deal, state, materialId, party);
  state.materialsLog.push({
    material: materialId,
    party,
    date,
    allowed: result.allowed,
    reason: result.reason,
  });
  return result;
}
