import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { openDispute, resolveDispute, suspendedPaymentIds } from "../src/disputes.js";

const deal = JSON.parse(await readFile(new URL("../contracts/license_deal.json", import.meta.url), "utf8")).sample;

test("样例中 P2 因争议被暂停", () => {
  assert.deepEqual([...suspendedPaymentIds(deal)], ["P2"]);
});

test("针对里程碑的争议只暂停其付款", () => {
  const clean = structuredClone(deal);
  clean.disputes = [];
  const next = openDispute(clean, {
    target_type: "milestone",
    target_id: "M3",
    raised_by: "licensor",
    reason: "入组数据待核",
    opened_on: "2026-09-01",
  });
  assert.deepEqual([...suspendedPaymentIds(next)], ["P3"]);
});

test("针对事件的争议暂停其触发的里程碑付款", () => {
  const clean = structuredClone(deal);
  clean.disputes = [];
  const next = openDispute(clean, {
    target_type: "event",
    target_id: "E1",
    raised_by: "licensee",
    reason: "入组日期争议",
    opened_on: "2026-04-20",
  });
  assert.deepEqual([...suspendedPaymentIds(next)], ["P2"]);
});

test("争议解决后暂停解除", () => {
  const next = resolveDispute(deal, "D1", { note: "按锁定价重开发票", resolved_on: "2026-05-10" });
  assert.deepEqual([...suspendedPaymentIds(next)], []);
  assert.throws(() => resolveDispute(next, "D1", {}), /已了结/);
});

test("争议目标必须存在", () => {
  assert.throws(
    () => openDispute(deal, { target_type: "payment", target_id: "PX", raised_by: "licensor", reason: "x", opened_on: "2026-01-01" }),
    /未知付款/,
  );
});
