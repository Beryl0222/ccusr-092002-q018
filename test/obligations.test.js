import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { nextObligations, nextObligationFor, reminders } from "../src/obligations.js";
import { resolveDispute } from "../src/disputes.js";

const deal = JSON.parse(await readFile(new URL("../contracts/license_deal.json", import.meta.url), "utf8")).sample;
const AS_OF = "2026-10-01";

test("下一项义务按到期日排序且不含已暂停付款", () => {
  const obligations = nextObligations(deal, AS_OF);
  assert.deepEqual(
    obligations.map((o) => [o.kind, o.ref_id, o.party]),
    [
      ["付款", "P5", "licensee"],
      ["事件确认", "E3", "licensor"],
    ],
  );
  assert.ok(obligations.every((o) => o.overdue));
});

test("项目负责人可看到各方的下一项义务", () => {
  assert.equal(nextObligationFor(deal, "licensee", AS_OF).ref_id, "P5");
  assert.equal(nextObligationFor(deal, "licensor", AS_OF).ref_id, "E3");
});

test("争议解决后相关付款回到义务列表", () => {
  const resolved = resolveDispute(deal, "D1", { note: "已重开发票", resolved_on: "2026-09-30" });
  const ids = nextObligations(resolved, AS_OF).map((o) => o.ref_id);
  assert.ok(ids.includes("P2"));
});

test("提醒窗口只含逾期或临期义务", () => {
  assert.equal(reminders(deal, "2026-02-01", 30).length, 0); // P1 已支付，其余锚未成就
  assert.equal(reminders(deal, AS_OF, 30).length, 2);
});
