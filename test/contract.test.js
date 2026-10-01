import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { detectConflicts } from "../src/domain/rights.js";
import { healthPayload, serviceId } from "../src/service.js";

async function loadContract() {
  const raw = await readFile(new URL("../contracts/license_deal.json", import.meta.url), "utf8");
  return JSON.parse(raw);
}

test("服务身份稳定", () => {
  assert.equal(healthPayload().service, serviceId);
});

test("领域样例与服务一致", async () => {
  const data = await loadContract();
  assert.equal(data.service, serviceId);
  assert.ok(data.sample);
});

test("样例覆盖权利与付款要素", async () => {
  const { sample } = await loadContract();
  assert.equal(sample.parties.length, 2);
  assert.ok(sample.assets[0].targets.length > 0, "资产须标注靶点");
  assert.ok(sample.grants.length >= 2, "须有多笔授权范围");
  for (const grant of sample.grants) {
    assert.ok(grant.territory && grant.indications.length > 0 && grant.exclusivity);
  }
  assert.ok(sample.upfront.amount > 0, "须有首付款");
  assert.ok(sample.milestones.some((m) => m.depends_on.length > 0), "须有带依赖的里程碑");
  assert.ok(sample.royalties.tiers.length > 0, "须有销售分成档位");
  assert.ok(sample.fx.rates.length > 0, "须有汇率牌价");
  assert.ok(sample.withholding_tax.length > 0, "须有预提税约定");
  assert.ok(sample.committee.members.length >= 4, "须有共同开发委员会");
  assert.ok(sample.materials.length > 0, "须有材料权限约定");
  assert.ok(sample.versions.length === 1, "须以初始版本起账");
});

test("样例权利图不自相矛盾", async () => {
  const { sample } = await loadContract();
  assert.deepEqual(detectConflicts(sample.grants), []);
});
