import { partyIds } from "./events.js";

// 修订须双方批准，版本号递增，变更逐条留痕。
export function applyAmendment(deal, amendment) {
  const missing = partyIds(deal).filter((id) => !amendment.approved_by.includes(id));
  if (missing.length > 0) throw new Error(`修订缺少当事方批准: ${missing.join(", ")}`);
  if (amendment.version !== deal.version + 1) throw new Error(`修订版本应为 ${deal.version + 1}，收到 ${amendment.version}`);
  const next = structuredClone(deal);
  for (const change of amendment.changes) setByPath(next, change.path, change.to);
  next.version = amendment.version;
  next.amendments.push(amendment);
  return next;
}

// 路径形如 "payments.P3.amount"，中间段按数组元素的 id 匹配。
function setByPath(deal, path, value) {
  const segments = path.split(".");
  let node = deal;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    node = Array.isArray(node) ? node.find((item) => item.id === segment) : node[segment];
    if (node == null) throw new Error(`修订路径不存在: ${path}`);
  }
  const last = segments[segments.length - 1];
  if (Array.isArray(node) || !(last in node)) throw new Error(`修订路径不存在: ${path}`);
  node[last] = value;
}

export function amendmentHistory(deal) {
  return [...deal.amendments].sort((a, b) => a.version - b.version);
}

// 某日期生效的版本：取生效日不晚于该日的最高版本，否则为初始版本 1。
export function versionAt(deal, dateStr) {
  let version = 1;
  for (const amendment of amendmentHistory(deal)) {
    if (amendment.effective_on <= dateStr) version = amendment.version;
  }
  return version;
}
