import { indicationsOverlap, territoriesOverlap } from "./rights.js";

// 材料权限由权利图推导：共享材料对权利覆盖该范围的当事方开放，许可方作为来源方始终可见。
export function materialAccess(deal, material) {
  if (material.classification === "许可方保留") return ["licensor"];
  const allowed = new Set(["licensor"]);
  for (const right of deal.rights) {
    const inScope =
      right.asset_id === material.scope.asset_id &&
      territoriesOverlap(deal.territory_tree, right.territory, material.scope.territory) &&
      indicationsOverlap(right.indication, material.scope.indication);
    if (inScope) allowed.add(right.grantee);
  }
  return deal.parties.map((p) => p.id).filter((id) => allowed.has(id));
}

export function canAccessMaterial(deal, partyId, materialId) {
  const material = deal.materials.find((m) => m.id === materialId);
  if (!material) throw new Error(`未知材料: ${materialId}`);
  return materialAccess(deal, material).includes(partyId);
}
