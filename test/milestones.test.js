import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { evaluateMilestones, milestoneAchievedOn } from "../src/milestones.js";

const deal = JSON.parse(await readFile(new URL("../contracts/license_deal.json", import.meta.url), "utf8")).sample;

test("样例里程碑状态", () => {
  assert.deepEqual(evaluateMilestones(deal), { M1: "achieved", M2: "achieved", M3: "waiting", M4: "blocked" });
});

test("达成日期锚定签约日或事件日", () => {
  assert.equal(milestoneAchievedOn(deal, "M1"), deal.signed_on);
  assert.equal(milestoneAchievedOn(deal, "M2"), "2026-03-04");
  assert.equal(milestoneAchievedOn(deal, "M3"), null);
});

test("依赖循环被检出", () => {
  const cyclic = structuredClone(deal);
  cyclic.milestones.find((m) => m.id === "M1").depends_on = ["M4"];
  assert.throws(() => evaluateMilestones(cyclic), /循环/);
});
