import assert from "node:assert/strict";
import test from "node:test";

import {
  confirmEvent,
  initMilestoneState,
  milestoneBoard,
  rejectEvent,
  reportEvent,
  unmetDependencies,
} from "../src/domain/milestones.js";
import { loadSample } from "../src/store.js";

function setup() {
  const deal = loadSample();
  return { deal, state: initMilestoneState(deal) };
}

test("依赖未确认时不能申报", () => {
  const { deal, state } = setup();
  assert.deepEqual(unmetDependencies(deal, state, "M2"), ["M1"]);
  assert.throws(
    () => reportEvent(deal, state, "M2", { party: "licensee", date: "2026-09-20" }),
    /依赖尚未确认/,
  );
});

test("事件须双方确认：申报方不能自证", () => {
  const { deal, state } = setup();
  reportEvent(deal, state, "M1", { party: "licensee", date: "2026-09-20" });
  assert.throws(
    () => confirmEvent(deal, state, "M1", { party: "licensee", date: "2026-09-22" }),
    /双方确认/,
  );
  const result = confirmEvent(deal, state, "M1", { party: "licensor", date: "2026-09-22" });
  assert.equal(result.status, "confirmed");
  assert.equal(result.payment.id, "P1");
});

test("未申报不能确认，未知当事方被拒绝", () => {
  const { deal, state } = setup();
  assert.throws(
    () => confirmEvent(deal, state, "M1", { party: "licensor", date: "2026-09-22" }),
    /尚未申报/,
  );
  assert.throws(
    () => reportEvent(deal, state, "M1", { party: "stranger", date: "2026-09-20" }),
    /未知当事方/,
  );
  assert.throws(
    () => reportEvent(deal, state, "M1", { party: "licensee", date: "20-09-20" }),
    /YYYY-MM-DD/,
  );
});

test("异议回退到待申报，可重新申报", () => {
  const { deal, state } = setup();
  reportEvent(deal, state, "M1", { party: "licensee", date: "2026-09-20" });
  const rejected = rejectEvent(deal, state, "M1", {
    party: "licensor",
    date: "2026-09-21",
    reason: "入组数据与原始记录不符",
  });
  assert.equal(rejected.status, "pending");
  assert.equal(rejected.rejected_report_of, "licensee");
  reportEvent(deal, state, "M1", { party: "licensee", date: "2026-09-25" });
  assert.equal(state.M1.status, "reported");
});

test("里程碑看板呈现状态与阻塞依赖", () => {
  const { deal, state } = setup();
  const board = milestoneBoard(deal, state);
  const m3 = board.find((item) => item.id === "M3");
  assert.equal(m3.status, "pending");
  assert.deepEqual(m3.blocked_by, ["M2"]);
  assert.equal(m3.payment_id, "P3");
  const m6 = board.find((item) => item.id === "M6");
  assert.equal(m6.responsible, "licensor", "专利事件由许可方负责");
});
