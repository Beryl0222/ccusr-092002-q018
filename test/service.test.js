import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createServer } from "../src/service.js";

const dealJson = await readFile(new URL("../contracts/license_deal.json", import.meta.url), "utf8");

async function withServer(run) {
  const server = await createServer(dealJson);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const get = async (base, path) => (await fetch(`${base}${path}`)).json();
const post = async (base, path, body) =>
  (
    await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  ).json();

test("健康检查", async () => {
  await withServer(async (base) => {
    const health = await get(base, "/health");
    assert.equal(health.service, "drug-license-obligations");
  });
});

test("权利查询：谁能在德国市场开发", async () => {
  await withServer(async (base) => {
    const result = await get(base, "/rights/query?asset_id=A1&territory=德国&indication=非小细胞肺癌&activity=开发");
    assert.deepEqual(result.grants.map((g) => g.party), ["licensee"]);
    const conflicts = await get(base, "/rights/conflicts");
    assert.deepEqual(conflicts.conflicts, []);
  });
});

test("付款复算端点", async () => {
  await withServer(async (base) => {
    const calc = await get(base, "/payments/P1/recompute");
    assert.equal(calc.net, 255600000);
    const invoice = await get(base, "/payments/P1/invoice");
    assert.equal(invoice.total_due, 255600000);
  });
});

test("事件确认推动里程碑与义务变化", async () => {
  await withServer(async (base) => {
    const before = await get(base, "/milestones");
    assert.equal(before.milestones.find((m) => m.id === "M3").status, "待事件确认");
    const confirmed = await post(base, "/events/E3/confirm", { party: "licensor", by: "华澜临床运营" });
    assert.equal(confirmed.milestones.M3, "achieved");
    const payments = await get(base, "/payments?as_of=2026-10-01");
    assert.equal(payments.payments.find((p) => p.id === "P3").due_on, "2026-09-19");
  });
});

test("争议只暂停相关付款", async () => {
  await withServer(async (base) => {
    const before = await get(base, "/obligations/next?party=licensee&as_of=2026-10-01");
    assert.equal(before.obligation.ref_id, "P5");
    const opened = await post(base, "/disputes", {
      target_type: "payment",
      target_id: "P5",
      raised_by: "licensee",
      reason: "销售报告口径待核",
      opened_on: "2026-09-01",
    });
    assert.deepEqual(opened.suspended_payments.sort(), ["P2", "P5"]);
    const after = await get(base, "/obligations/next?party=licensee&as_of=2026-10-01");
    assert.equal(after.obligation, null);
    // 许可方的确认义务不受付款争议影响
    const licensor = await get(base, "/obligations/next?party=licensor&as_of=2026-10-01");
    assert.equal(licensor.obligation.ref_id, "E3");
  });
});

test("数据更正暂停相关付款，重新确认后恢复", async () => {
  await withServer(async (base) => {
    const corrected = await post(base, "/events/E1/correct", {
      occurred_on: "2026-03-11",
      by: "华澜数据管理",
      reason: "入组日期录入错误",
    });
    assert.ok(corrected.suspended_payments.includes("P2"));
    await post(base, "/events/E1/confirm", { party: "licensor", by: "华澜临床运营" });
    const reconfirmed = await post(base, "/events/E1/confirm", { party: "licensee", by: "NorthPeak ClinOps" });
    assert.equal(reconfirmed.milestones.M2, "achieved");
    const calc = await get(base, "/payments/P2/recompute");
    assert.equal(calc.due_on, "2026-04-25");
  });
});

test("材料权限与修订追溯端点", async () => {
  await withServer(async (base) => {
    const access = await get(base, "/materials/MAT-3/access?party=licensee");
    assert.equal(access.allowed, false);
    const version = await get(base, "/amendments?at=2026-05-01");
    assert.equal(version.version, 2);
  });
});

test("未知路径返回 404", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/nope`);
    assert.equal(response.status, 404);
  });
});
