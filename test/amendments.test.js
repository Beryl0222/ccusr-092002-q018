import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { amendmentHistory, applyAmendment, versionAt } from "../src/amendments.js";

const deal = JSON.parse(await readFile(new URL("../contracts/license_deal.json", import.meta.url), "utf8")).sample;

test("按日期追溯生效版本", () => {
  assert.equal(versionAt(deal, "2026-03-01"), 1);
  assert.equal(versionAt(deal, "2026-04-01"), 2);
  assert.equal(versionAt(deal, "2026-08-15"), 3);
});

test("修订历史按版本排序", () => {
  assert.deepEqual(amendmentHistory(deal).map((a) => a.version), [2, 3]);
});

test("应用修订：版本递增并写入变更", () => {
  const next = applyAmendment(deal, {
    version: 4,
    effective_on: "2026-10-15",
    approved_by: ["licensor", "licensee"],
    reason: "三期里程碑金额上调",
    changes: [{ path: "payments.P3.amount", from: 60000000, to: 65000000 }],
  });
  assert.equal(next.version, 4);
  assert.equal(next.payments.find((p) => p.id === "P3").amount, 65000000);
  assert.equal(next.amendments.length, 3);
  assert.equal(deal.version, 3); // 原对象不变
});

test("修订须双方批准且版本连续", () => {
  assert.throws(
    () => applyAmendment(deal, { version: 4, effective_on: "2026-10-15", approved_by: ["licensor"], reason: "x", changes: [] }),
    /缺少当事方批准/,
  );
  assert.throws(
    () => applyAmendment(deal, { version: 9, effective_on: "2026-10-15", approved_by: ["licensor", "licensee"], reason: "x", changes: [] }),
    /版本应为 4/,
  );
});

test("修订路径必须存在", () => {
  assert.throws(
    () =>
      applyAmendment(deal, {
        version: 4,
        effective_on: "2026-10-15",
        approved_by: ["licensor", "licensee"],
        reason: "x",
        changes: [{ path: "payments.PX.amount", from: 1, to: 2 }],
      }),
    /路径不存在/,
  );
});
