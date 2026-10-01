import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { canAccessMaterial, materialAccess } from "../src/materials.js";

const deal = JSON.parse(await readFile(new URL("../contracts/license_deal.json", import.meta.url), "utf8")).sample;

test("共享材料对权利覆盖方开放", () => {
  const mat1 = deal.materials.find((m) => m.id === "MAT-1");
  assert.deepEqual(materialAccess(deal, mat1), ["licensor", "licensee"]);
});

test("许可方保留材料不开放", () => {
  const mat2 = deal.materials.find((m) => m.id === "MAT-2");
  assert.deepEqual(materialAccess(deal, mat2), ["licensor"]);
  assert.equal(canAccessMaterial(deal, "licensee", "MAT-2"), false);
});

test("材料权限跟随权利图：欧盟结直肠癌为许可方保留范围", () => {
  assert.equal(canAccessMaterial(deal, "licensor", "MAT-3"), true);
  assert.equal(canAccessMaterial(deal, "licensee", "MAT-3"), false);
});
