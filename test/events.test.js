import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { confirmEvent, correctEvent, isConfirmed, pendingConfirmations } from "../src/events.js";
import { evaluateMilestones } from "../src/milestones.js";
import { paymentDueDate, findPayment } from "../src/payments.js";
import { suspendedPaymentIds } from "../src/disputes.js";

const deal = JSON.parse(await readFile(new URL("../contracts/license_deal.json", import.meta.url), "utf8")).sample;

test("事件须双方确认", () => {
  const e3 = deal.events.find((e) => e.id === "E3");
  assert.equal(isConfirmed(deal, e3), false);
  assert.deepEqual(pendingConfirmations(deal, e3), ["licensor"]);
});

test("双方确认后里程碑联动达成", () => {
  const next = confirmEvent(deal, "E3", "licensor", { by: "华澜临床运营", at: "2026-08-25T10:00:00+08:00" });
  assert.equal(evaluateMilestones(next).M3, "achieved");
  assert.equal(paymentDueDate(next, findPayment(next, "P3")), "2026-09-19");
  // 原交易对象不被修改
  assert.equal(evaluateMilestones(deal).M3, "waiting");
});

test("重复确认报错", () => {
  assert.throws(() => confirmEvent(deal, "E1", "licensor", { by: "x", at: "2026-01-01" }), /已确认/);
});

test("数据更正暂停相关付款并触发重新确认", () => {
  const clean = structuredClone(deal);
  clean.disputes = [];
  const corrected = correctEvent(clean, "E1", {
    occurred_on: "2026-03-11",
    by: "华澜数据管理",
    reason: "入组日期录入错误",
    at: "2026-04-21T09:00:00+08:00",
  });
  // 只暂停 E1 触发的 P2，其余付款不受影响
  assert.deepEqual([...suspendedPaymentIds(corrected)], ["P2"]);
  assert.equal(evaluateMilestones(corrected).M2, "waiting");

  // 双方重新确认后暂停解除，连锁义务按新日期重算
  let reconfirmed = confirmEvent(corrected, "E1", "licensor", { by: "华澜临床运营", at: "2026-04-22T09:00:00+08:00" });
  reconfirmed = confirmEvent(reconfirmed, "E1", "licensee", { by: "NorthPeak ClinOps", at: "2026-04-22T09:05:00-04:00" });
  assert.deepEqual([...suspendedPaymentIds(reconfirmed)], []);
  assert.equal(paymentDueDate(reconfirmed, findPayment(reconfirmed, "P2")), "2026-04-25");
});
