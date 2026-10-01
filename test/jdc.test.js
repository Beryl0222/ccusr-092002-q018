import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { conductVote, quorumCheck, recusedMembers } from "../src/jdc.js";

const deal = JSON.parse(await readFile(new URL("../contracts/license_deal.json", import.meta.url), "utf8")).sample;
const { jdc } = deal;

test("利益冲突委员回避", () => {
  assert.deepEqual(recusedMembers(jdc, "竞品项目").map((m) => m.id), ["J5"]);
  assert.deepEqual(recusedMembers(jdc, "临床方案"), []);
});

test("法定人数按回避后成员计算", () => {
  const ok = quorumCheck(jdc, "竞品项目", ["J1", "J2", "J4", "J6"]);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.per_party, { licensor: 2, licensee: 2 });
  // 许可方仅 1 人出席，低于每方下限
  assert.equal(quorumCheck(jdc, "竞品项目", ["J1", "J4", "J6"]).ok, false);
  // 回避成员不计入出席
  assert.equal(quorumCheck(jdc, "竞品项目", ["J1", "J2", "J4", "J5"]).ok, false);
});

test("回避成员不得投票", () => {
  const motion = { id: "MOT-9", topic: "竞品项目", attempts: 0, status: "进行中" };
  assert.throws(() => conductVote(jdc, motion, { J5: "approve" }), /已回避/);
});

test("多数决通过与否决", () => {
  const motion = { id: "MOT-9", topic: "临床方案", attempts: 0, status: "进行中" };
  const pass = conductVote(jdc, motion, { J1: "approve", J2: "approve", J3: "reject", J4: "approve", J5: "reject" });
  assert.equal(pass.result, "通过");
  const fail = conductVote(jdc, motion, { J1: "reject", J2: "reject", J3: "approve", J4: "reject", J5: "approve" });
  assert.equal(fail.result, "否决");
});

test("未达法定人数不计僵局", () => {
  const motion = { id: "MOT-9", topic: "临床方案", attempts: 0, status: "进行中" };
  const outcome = conductVote(jdc, motion, { J1: "approve", J4: "approve" });
  assert.equal(outcome.result, "未达法定人数");
  assert.equal(outcome.motion.attempts, 0);
});

test("平局升级为僵局并沿路径上移", () => {
  const motion = { id: "MOT-9", topic: "临床方案", attempts: 0, status: "进行中" };
  const tie = { J1: "approve", J2: "reject", J4: "approve", J5: "reject" };
  const first = conductVote(jdc, motion, tie);
  assert.equal(first.result, "僵局");
  assert.equal(first.motion.status, "僵局");
  const second = conductVote(jdc, first.motion, tie);
  assert.equal(second.motion.status, "僵局升级");
  assert.equal(second.motion.escalate_to, "双方首席执行官");
  const third = conductVote(jdc, second.motion, tie);
  assert.equal(third.motion.escalate_to, "独立调解");
});
