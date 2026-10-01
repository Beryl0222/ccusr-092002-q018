import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRightsGraph,
  detectConflicts,
  expandScope,
  grantsOverlap,
  scopesOverlap,
  TERRITORY_TREE,
  whoCanDoWhat,
} from "../src/domain/rights.js";
import { loadSample } from "../src/store.js";

test("范围树按层级展开", () => {
  const expanded = expandScope(TERRITORY_TREE, "欧盟");
  assert.ok(expanded.has("德国"));
  assert.ok(expanded.has("欧盟"));
  assert.ok(!expanded.has("美国"));
});

test("上下位范围视为重叠", () => {
  assert.ok(scopesOverlap(TERRITORY_TREE, "全球", "美国"));
  assert.ok(scopesOverlap(TERRITORY_TREE, "欧盟", "德国"));
  assert.ok(!scopesOverlap(TERRITORY_TREE, "美国", "中国"));
});

test("授权重叠须同时满足资产、权利、区域、适应症", () => {
  const base = {
    asset: "LB-101",
    territory: "美国",
    indications: ["胃癌"],
    rights: ["商业化"],
    exclusivity: "独占",
  };
  assert.ok(grantsOverlap(base, { ...base, id: "x", party: "b" }));
  assert.ok(!grantsOverlap(base, { ...base, territory: "中国" }), "区域不相交则不重叠");
  assert.ok(!grantsOverlap(base, { ...base, indications: ["多发性骨髓瘤"] }), "适应症不相交则不重叠");
  assert.ok(!grantsOverlap(base, { ...base, rights: ["生产"] }), "权利不相交则不重叠");
  assert.ok(
    grantsOverlap(base, { ...base, territory: "全球" }),
    "上位区域与下位区域重叠",
  );
});

test("不同当事方的排他授权重叠即冲突，非独占之间不冲突", () => {
  const a = { id: "A", party: "p1", asset: "X", territory: "美国", indications: ["胃癌"], rights: ["商业化"], exclusivity: "独占" };
  const b = { id: "B", party: "p2", asset: "X", territory: "美国", indications: ["胃癌"], rights: ["商业化"], exclusivity: "独占" };
  const c = { ...b, id: "C", exclusivity: "非独占" };
  const d = { ...a, id: "D", exclusivity: "非独占" };
  assert.equal(detectConflicts([a, b]).length, 1);
  assert.equal(detectConflicts([c, d]).length, 0, "双方均非独占则共存");
  assert.equal(detectConflicts([a, c]).length, 1, "独占与非独占重叠仍冲突");
  assert.equal(detectConflicts([a, { ...a, id: "E" }]).length, 0, "同一当事方不构成冲突");
});

test("谁能在哪个市场做什么", () => {
  const graph = buildRightsGraph(loadSample());
  const us = whoCanDoWhat(graph, { territory: "美国", action: "商业化" });
  assert.deepEqual(us.map((h) => h.party), ["licensee"]);
  const cn = whoCanDoWhat(graph, { territory: "中国", action: "开发" });
  assert.deepEqual(cn.map((h) => h.party), ["licensor"]);
  const de = whoCanDoWhat(graph, { territory: "德国", action: "商业化" });
  assert.deepEqual(de.map((h) => h.party), ["licensee"], "德国作为欧盟成员国命中欧盟授权");
  const none = whoCanDoWhat(graph, { territory: "日本", action: "商业化" });
  assert.equal(none.length, 0);
});
