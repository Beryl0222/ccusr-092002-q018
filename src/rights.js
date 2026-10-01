// 权利图：资产 × 区域 × 适应症 的授权单元格，回答“谁能在哪个市场做什么”。
export const ALL_INDICATIONS = "全部适应症";
export const EXCLUSIVE = "独占";
export const RETAINED = "保留";

// 沿区域树向下展开，返回该区域及其全部下级区域。
export function expandTerritory(tree, territory) {
  const result = new Set([territory]);
  const queue = [territory];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const child of tree[current] ?? []) {
      if (!result.has(child)) {
        result.add(child);
        queue.push(child);
      }
    }
  }
  return result;
}

export function territoriesOverlap(tree, a, b) {
  const expandedB = expandTerritory(tree, b);
  return [...expandTerritory(tree, a)].some((t) => expandedB.has(t));
}

export function indicationsOverlap(a, b) {
  return a === ALL_INDICATIONS || b === ALL_INDICATIONS || a === b;
}

function rightsOverlap(deal, a, b) {
  return (
    a.asset_id === b.asset_id &&
    territoriesOverlap(deal.territory_tree, a.territory, b.territory) &&
    indicationsOverlap(a.indication, b.indication)
  );
}

// 独占授权意味着同一单元格内不得存在其他方（含许可方保留）的任何权利。
export function detectConflicts(deal) {
  const conflicts = [];
  const rights = deal.rights;
  for (let i = 0; i < rights.length; i += 1) {
    for (let j = i + 1; j < rights.length; j += 1) {
      const a = rights[i];
      const b = rights[j];
      if (!rightsOverlap(deal, a, b)) continue;
      const cell = { asset_id: a.asset_id, territory: `${a.territory}∩${b.territory}`, indication: `${a.indication}∩${b.indication}` };
      if (a.grantee === b.grantee) {
        if (a.exclusivity === EXCLUSIVE && b.exclusivity === EXCLUSIVE) {
          conflicts.push({ right_ids: [a.id, b.id], reason: "重复独占授权", cell });
        }
        continue;
      }
      if (a.exclusivity === EXCLUSIVE || b.exclusivity === EXCLUSIVE) {
        conflicts.push({ right_ids: [a.id, b.id], reason: "独占范围与他方权利重叠", cell });
      }
    }
  }
  return conflicts;
}

function matches(deal, right, query) {
  return (
    right.asset_id === query.asset_id &&
    territoriesOverlap(deal.territory_tree, right.territory, query.territory) &&
    indicationsOverlap(right.indication, query.indication)
  );
}

// 授权区域完整覆盖查询单元格时，许可方才视为未保留该单元格。
function covers(deal, right, query) {
  const granted = expandTerritory(deal.territory_tree, right.territory);
  const asked = expandTerritory(deal.territory_tree, query.territory);
  const territoryCovered = [...asked].every((t) => granted.has(t));
  return territoryCovered && (right.indication === ALL_INDICATIONS || right.indication === query.indication);
}

export function queryRights(deal, query) {
  const grants = deal.rights.filter((r) => matches(deal, r, query));
  const exclusive = grants.find((r) => r.exclusivity === EXCLUSIVE && covers(deal, r, query));
  const licensorRetained = !(exclusive && exclusive.grantee !== "licensor");
  return { grants, exclusive_holder: exclusive?.grantee ?? null, licensor_retained: licensorRetained };
}

const ALL_ACTIVITIES = ["开发", "生产", "商业化"];

// “谁能在哪个市场做什么”：返回该单元格内各方及其可从事的活动。
export function whoCanDo(deal, query) {
  const { grants, licensor_retained } = queryRights(deal, query);
  const entries = grants
    .filter((r) => !query.activity || r.activities.includes(query.activity))
    .map((r) => ({ party: r.grantee, exclusivity: r.exclusivity, activities: r.activities, right_id: r.id }));
  const licensorListed = entries.some((e) => e.party === "licensor");
  if (licensor_retained && !licensorListed && (!query.activity || ALL_ACTIVITIES.includes(query.activity))) {
    entries.push({ party: "licensor", exclusivity: RETAINED, activities: ALL_ACTIVITIES, right_id: null });
  }
  return entries;
}
