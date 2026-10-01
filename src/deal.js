import { EVENT_TYPES } from "./events.js";
import { evaluateMilestones } from "./milestones.js";

// 结构校验：引用完整、依赖无环、字段取值合法。权利冲突由 detectConflicts 单独报告。
export function validateDeal(deal) {
  const errors = [];
  const partyIds = new Set(deal.parties?.map((p) => p.id) ?? []);
  if (partyIds.size !== 2) errors.push("交易必须恰有两方");

  const assetIds = new Set((deal.assets ?? []).map((a) => a.id));
  for (const right of deal.rights ?? []) {
    if (!assetIds.has(right.asset_id)) errors.push(`授权 ${right.id} 引用了未知资产 ${right.asset_id}`);
    if (!partyIds.has(right.grantee)) errors.push(`授权 ${right.id} 的被授权方未知: ${right.grantee}`);
  }

  const eventIds = new Set((deal.events ?? []).map((e) => e.id));
  for (const event of deal.events ?? []) {
    if (!EVENT_TYPES[event.type]) errors.push(`事件 ${event.id} 类型未知: ${event.type}`);
    if (!partyIds.has(event.reported_by)) errors.push(`事件 ${event.id} 的报告方未知: ${event.reported_by}`);
  }

  const paymentIds = new Set((deal.payments ?? []).map((p) => p.id));
  const milestoneIds = new Set((deal.milestones ?? []).map((m) => m.id));
  for (const m of deal.milestones ?? []) {
    for (const dep of m.depends_on) if (!milestoneIds.has(dep)) errors.push(`里程碑 ${m.id} 依赖未知里程碑 ${dep}`);
    if (m.trigger_event && !eventIds.has(m.trigger_event)) errors.push(`里程碑 ${m.id} 触发事件未知: ${m.trigger_event}`);
    if (m.payment_id && !paymentIds.has(m.payment_id)) errors.push(`里程碑 ${m.id} 付款未知: ${m.payment_id}`);
  }

  for (const p of deal.payments ?? []) {
    if (!partyIds.has(p.payer) || !partyIds.has(p.payee)) errors.push(`付款 ${p.id} 的收付方未知`);
    if (p.fx_lock && p.fx_lock.pair !== `${p.currency}/${p.settlement_currency}`) {
      errors.push(`付款 ${p.id} 锁汇货币对与币种不符`);
    }
    if (p.withholding && (p.withholding.rate < 0 || p.withholding.rate >= 1)) errors.push(`付款 ${p.id} 预提税率非法`);
    if (p.type === "销售分成" && (!p.sales_report || !p.royalty_tiers)) errors.push(`付款 ${p.id} 缺少销售报告或分成阶梯`);
  }

  for (const member of deal.jdc?.members ?? []) {
    if (!partyIds.has(member.party)) errors.push(`委员 ${member.id} 所属方未知: ${member.party}`);
  }

  const versions = (deal.amendments ?? []).map((a) => a.version);
  if (new Set(versions).size !== versions.length) errors.push("修订版本号重复");
  for (const a of deal.amendments ?? []) {
    const missing = [...partyIds].filter((id) => !a.approved_by.includes(id));
    if (missing.length > 0) errors.push(`修订 v${a.version} 缺少批准: ${missing.join(", ")}`);
  }

  try {
    evaluateMilestones(deal);
  } catch (error) {
    errors.push(error.message);
  }
  return errors;
}

export function loadDeal(json) {
  const deal = typeof json === "string" ? JSON.parse(json) : json;
  const errors = validateDeal(deal);
  if (errors.length > 0) throw new Error(`交易数据非法:\n- ${errors.join("\n- ")}`);
  return deal;
}
