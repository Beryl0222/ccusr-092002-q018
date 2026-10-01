import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { detectConflicts, expandTerritory, queryRights, whoCanDo } from "../src/rights.js";

const deal = JSON.parse(await readFile(new URL("../contracts/license_deal.json", import.meta.url), "utf8")).sample;

test("区域树向下展开", () => {
  assert.deepEqual([...expandTerritory(deal.territory_tree, "欧盟")].sort(), ["德国", "欧盟", "法国", "意大利"].sort());
  assert.deepEqual([...expandTerritory(deal.territory_tree, "日本")], ["日本"]);
});

test("欧盟授权覆盖成员国查询", () => {
  const result = queryRights(deal, { asset_id: "A1", territory: "德国", indication: "非小细胞肺癌" });
  assert.equal(result.exclusive_holder, "licensee");
  assert.equal(result.licensor_retained, false);
});

test("未授权市场由许可方保留", () => {
  const entries = whoCanDo(deal, { asset_id: "A1", territory: "日本", indication: "结直肠癌" });
  assert.deepEqual(entries.map((e) => [e.party, e.exclusivity]), [["licensor", "保留"]]);
});

test("谁能在哪个市场做什么：按活动过滤", () => {
  const develop = whoCanDo(deal, { asset_id: "A1", territory: "美国", indication: "非小细胞肺癌", activity: "开发" });
  assert.deepEqual(develop.map((e) => e.party), ["licensee"]);
  // 欧盟授权不含生产，且该区域已独占授出，许可方也不保留 → 无人可生产
  const manufacture = whoCanDo(deal, { asset_id: "A1", territory: "德国", indication: "非小细胞肺癌", activity: "生产" });
  assert.deepEqual(manufacture, []);
});

test("独占范围内他方权利构成冲突", () => {
  const conflicting = structuredClone(deal);
  conflicting.rights.push({
    id: "R9",
    asset_id: "A1",
    territory: "美国",
    indication: "非小细胞肺癌",
    grantee: "licensor",
    exclusivity: "保留",
    activities: ["开发"],
  });
  const conflicts = detectConflicts(conflicting);
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0].right_ids.sort(), ["R1", "R9"]);
});

test("重复的独占授权构成冲突", () => {
  const conflicting = structuredClone(deal);
  conflicting.rights.push({
    id: "R9",
    asset_id: "A1",
    territory: "美国",
    indication: "全部适应症",
    grantee: "licensee",
    exclusivity: "独占",
    activities: ["开发"],
  });
  const conflicts = detectConflicts(conflicting);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].reason, "重复独占授权");
});

test("不同适应症的相邻授权互不冲突", () => {
  assert.deepEqual(detectConflicts(deal), []);
});
