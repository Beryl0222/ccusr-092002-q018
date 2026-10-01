import { DomainError } from "./errors.js";

// 区域与适应症的层级树：上位范围天然覆盖下位范围。
// 授权范围（资产 × 区域 × 适应症 × 权利 × 排他性）组成权利图，
// 任何两笔分属不同当事方的排他授权若范围重叠，即为矛盾。

export const TERRITORY_TREE = {
  全球: ["美国", "欧盟", "中国", "日本", "英国"],
  欧盟: ["德国", "法国", "意大利", "西班牙"],
};

export const INDICATION_TREE = {
  实体瘤: ["非小细胞肺癌", "胃癌", "结直肠癌"],
  血液肿瘤: ["弥漫大B细胞淋巴瘤", "多发性骨髓瘤"],
};

export function expandScope(tree, term) {
  const out = new Set([term]);
  const walk = (node) => {
    for (const child of tree[node] ?? []) {
      if (!out.has(child)) {
        out.add(child);
        walk(child);
      }
    }
  };
  walk(term);
  return out;
}

export function scopesOverlap(tree, a, b) {
  const expanded = expandScope(tree, a);
  for (const term of expandScope(tree, b)) {
    if (expanded.has(term)) return true;
  }
  return false;
}

export function grantsOverlap(a, b) {
  if (a.asset !== b.asset) return false;
  if (!a.rights.some((right) => b.rights.includes(right))) return false;
  if (!scopesOverlap(TERRITORY_TREE, a.territory, b.territory)) return false;
  return a.indications.some((left) =>
    b.indications.some((right) => scopesOverlap(INDICATION_TREE, left, right)),
  );
}

export function detectConflicts(grants) {
  const conflicts = [];
  for (let i = 0; i < grants.length; i += 1) {
    for (let j = i + 1; j < grants.length; j += 1) {
      const a = grants[i];
      const b = grants[j];
      if (a.party === b.party) continue;
      if (a.exclusivity === "非独占" && b.exclusivity === "非独占") continue;
      if (!grantsOverlap(a, b)) continue;
      conflicts.push({
        grant_a: a.id,
        grant_b: b.id,
        parties: [a.party, b.party],
        reason: `权利范围重叠且至少一方为排他授权（${a.exclusivity}/${b.exclusivity}）`,
      });
    }
  }
  return conflicts;
}

export function buildRightsGraph(deal) {
  const grants = deal.grants ?? [];
  return { deal_id: deal.deal_id, grants, conflicts: detectConflicts(grants) };
}

export function assertConsistent(deal) {
  const conflicts = detectConflicts(deal.grants ?? []);
  if (conflicts.length > 0) {
    const pairs = conflicts.map((c) => `${c.grant_a}×${c.grant_b}`).join(", ");
    throw new DomainError(`权利图存在冲突: ${pairs}`, 409);
  }
  return true;
}

// 回答“谁能在哪个市场做什么”。
export function whoCanDoWhat(graph, { territory, action, asset }) {
  return graph.grants
    .filter(
      (grant) =>
        (!asset || grant.asset === asset) &&
        grant.rights.includes(action) &&
        scopesOverlap(TERRITORY_TREE, grant.territory, territory),
    )
    .map((grant) => ({
      party: grant.party,
      asset: grant.asset,
      territory: grant.territory,
      indications: grant.indications,
      exclusivity: grant.exclusivity,
      grant_id: grant.id,
    }));
}
