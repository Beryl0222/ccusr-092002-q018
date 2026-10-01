import { createHash } from "node:crypto";
import { require } from "./errors.js";

// 修订追溯：每次修订生成一个新版本，内容哈希与前序哈希串联成链，可校验篡改。

export function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function contentHash(payload) {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

export function initVersions(deal, seed) {
  const version = seed ?? {
    n: 1,
    effective_date: "1970-01-01",
    reason: "初始签署",
    approved_by: (deal.parties ?? []).map((p) => p.id),
  };
  return [
    {
      n: version.n,
      effective_date: version.effective_date,
      reason: version.reason,
      approved_by: version.approved_by,
      supersedes: null,
      hash: contentHash({ deal, n: version.n, supersedes: null }),
    },
  ];
}

export function applyAmendment(state, { reason, approved_by, effective_date, changes }) {
  const parties = (state.deal.parties ?? []).map((p) => p.id);
  require(
    parties.every((party) => (approved_by ?? []).includes(party)),
    "修订须经双方批准",
  );
  require(changes && typeof changes === "object" && Object.keys(changes).length > 0, "缺少修订内容");
  const previous = state.versions[state.versions.length - 1];
  const nextDeal = structuredClone(state.deal);
  for (const [key, value] of Object.entries(changes)) {
    nextDeal[key] = value;
  }
  const n = previous.n + 1;
  const record = {
    n,
    effective_date,
    reason,
    approved_by,
    supersedes: previous.hash,
    hash: contentHash({ deal: nextDeal, n, supersedes: previous.hash }),
  };
  state.deal = nextDeal;
  state.versions.push(record);
  return record;
}

export function traceAmendments(state) {
  return state.versions.map((version) => ({ ...version }));
}

export function verifyChain(state, currentDeal) {
  for (let i = 1; i < state.versions.length; i += 1) {
    if (state.versions[i].supersedes !== state.versions[i - 1].hash) {
      return { ok: false, broken_at: state.versions[i].n };
    }
  }
  const last = state.versions[state.versions.length - 1];
  const recomputed = contentHash({ deal: currentDeal, n: last.n, supersedes: last.supersedes });
  return recomputed === last.hash ? { ok: true } : { ok: false, broken_at: last.n };
}
