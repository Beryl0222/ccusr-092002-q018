import assert from "node:assert/strict";
import test from "node:test";

import { checkQuorum, escalate, eligibleMembers, resolveVote } from "../src/domain/committee.js";
import { loadSample } from "../src/store.js";

const COMMITTEE = loadSample().committee;
const TOPIC = "竞品联合用药方案";

test("回避成员不计入法定人数", () => {
  const eligible = eligibleMembers(COMMITTEE, TOPIC).map((m) => m.id);
  assert.ok(!eligible.includes("N2"), "N2 对该话题回避");

  const ok = checkQuorum(COMMITTEE, ["L1", "L2", "N1", "N3"], TOPIC);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.recused, ["N2"]);

  const short = checkQuorum(COMMITTEE, ["L1", "L2", "N2", "N3"], TOPIC);
  assert.equal(short.ok, false, "N2 回避后被许可方仅剩 N3 一人出席");
  assert.equal(short.per_party.licensee.present, 1);

  const absent = checkQuorum(COMMITTEE, ["L1", "N1"], TOPIC);
  assert.equal(absent.ok, false);
});


test("未达法定人数不能表决", () => {
  assert.throws(
    () => resolveVote(COMMITTEE, TOPIC, { L1: "赞成" }, ["L1", "N1"]),
    /法定人数/,
  );
});

test("一致同意形成决议，反对票触发僵局", () => {
  const attendees = ["L1", "L2", "N1", "N3"];
  const decided = resolveVote(
    COMMITTEE,
    TOPIC,
    { L1: "赞成", L2: "赞成", N1: "赞成", N3: "赞成" },
    attendees,
  );
  assert.equal(decided.outcome, "decided");
  assert.equal(decided.decided_by, "JDC");

  const deadlocked = resolveVote(
    COMMITTEE,
    TOPIC,
    { L1: "赞成", L2: "赞成", N1: "反对", N3: "赞成" },
    attendees,
  );
  assert.equal(deadlocked.outcome, "deadlock");
  assert.deepEqual(deadlocked.against, ["N1"]);
});

test("僵局沿升级阶梯上行，阶梯用尽后按终局矩阵裁定", () => {
  assert.equal(escalate(COMMITTEE, "美国商业化策略", 0).step, "JDC复议");
  assert.equal(escalate(COMMITTEE, "美国商业化策略", 1).step, "双方首席执行官磋商");
  assert.equal(escalate(COMMITTEE, "美国商业化策略", 2).step, "具有约束力的专家裁定");
  const finalUs = escalate(COMMITTEE, "美国商业化策略", 3);
  assert.equal(finalUs.final, true);
  assert.equal(finalUs.decided_by, "licensee", "美国商业化终局归被许可方");
  const consensus = escalate(COMMITTEE, "全球临床开发方案", 3);
  assert.equal(consensus.decided_by, "仲裁", "须协商一致的话题僵局后提交仲裁");
  assert.equal(escalate(COMMITTEE, "未约定话题", 3).decided_by, "仲裁");
});
