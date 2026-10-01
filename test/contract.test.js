import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { loadDeal } from "../src/deal.js";
import { recomputePayment } from "../src/payments.js";
import { detectConflicts } from "../src/rights.js";
import { healthPayload, serviceId } from "../src/service.js";

const sampleUrl = new URL("../contracts/license_deal.json", import.meta.url);

async function readSample() {
  return JSON.parse(await readFile(sampleUrl, "utf8"));
}

test("服务身份稳定", () => {
  assert.equal(healthPayload().service, serviceId);
});

test("领域样例与服务一致", async () => {
  const data = await readSample();
  assert.equal(data.service, serviceId);
  assert.ok(data.sample);
});

test("样例通过结构校验", async () => {
  const data = await readSample();
  assert.doesNotThrow(() => loadDeal(data.sample));
});

test("样例权利图无冲突", async () => {
  const data = await readSample();
  assert.deepEqual(detectConflicts(data.sample), []);
});

test("样例版本与修订链一致", async () => {
  const { sample } = await readSample();
  assert.equal(sample.version, sample.amendments.length + 1);
  for (const amendment of sample.amendments) {
    assert.equal(amendment.approved_by.length, 2, `修订 v${amendment.version} 须双方批准`);
  }
});

test("样例每笔付款均可复算", async () => {
  const { sample } = await readSample();
  for (const payment of sample.payments) {
    const calc = recomputePayment(sample, payment);
    assert.equal(calc.payment_id, payment.id);
    if (payment.fx_lock) assert.ok(calc.net > 0, `${payment.id} 已锁汇应得出净额`);
  }
});
