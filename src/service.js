import http from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { applyAmendment, amendmentHistory, versionAt } from "./amendments.js";
import { loadDeal } from "./deal.js";
import { openDispute, resolveDispute, suspendedPaymentIds } from "./disputes.js";
import { confirmEvent, correctEvent } from "./events.js";
import { conductVote, quorumCheck } from "./jdc.js";
import { canAccessMaterial, materialAccess } from "./materials.js";
import { evaluateMilestones, milestoneAchievedOn, MILESTONE_STATUS } from "./milestones.js";
import { nextObligations, nextObligationFor } from "./obligations.js";
import { findPayment, invoiceFor, paymentSummary, recomputePayment } from "./payments.js";
import { detectConflicts, whoCanDo } from "./rights.js";

export const serviceId = "drug-license-obligations";
export const serviceName = "创新药授权履约账";

export function healthPayload() {
  return { status: "ok", service: serviceId, name: serviceName };
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

// 内存态交易：POST 类端点返回新的交易对象并替换当前状态。
export function createApp(initialDeal) {
  let deal = initialDeal;
  const asOf = (url) => url.searchParams.get("as_of") ?? new Date().toISOString().slice(0, 10);

  const routes = {
    "GET /health": () => [200, healthPayload()],
    "GET /deal": () => [
      200,
      {
        deal_id: deal.deal_id,
        title: deal.title,
        version: deal.version,
        signed_on: deal.signed_on,
        parties: deal.parties,
        amendments: amendmentHistory(deal).length,
      },
    ],
    "GET /rights/conflicts": () => [200, { conflicts: detectConflicts(deal) }],
    "GET /rights/query": (url) => [
      200,
      {
        grants: whoCanDo(deal, {
          asset_id: url.searchParams.get("asset_id"),
          territory: url.searchParams.get("territory"),
          indication: url.searchParams.get("indication"),
          activity: url.searchParams.get("activity") || undefined,
        }),
      },
    ],
    "GET /milestones": () => {
      const statuses = evaluateMilestones(deal);
      return [
        200,
        {
          milestones: deal.milestones.map((m) => ({
            id: m.id,
            title: m.title,
            status: MILESTONE_STATUS[statuses[m.id]],
            achieved_on: milestoneAchievedOn(deal, m.id),
            payment_id: m.payment_id,
          })),
        },
      ];
    },
    "GET /payments": (url) => [200, { payments: paymentSummary(deal, asOf(url), suspendedPaymentIds(deal)) }],
    "GET /obligations/next": (url) => {
      const party = url.searchParams.get("party");
      if (party) return [200, { obligation: nextObligationFor(deal, party, asOf(url)) }];
      return [200, { obligations: nextObligations(deal, asOf(url)) }];
    },
    "GET /amendments": (url) => {
      const at = url.searchParams.get("at");
      if (at) return [200, { version: versionAt(deal, at) }];
      return [200, { amendments: amendmentHistory(deal) }];
    },
    "GET /disputes": () => [200, { disputes: deal.disputes, suspended_payments: [...suspendedPaymentIds(deal)] }],
    "POST /disputes": async (url, request) => {
      const body = await readBody(request);
      deal = openDispute(deal, body);
      return [201, { dispute: deal.disputes[deal.disputes.length - 1], suspended_payments: [...suspendedPaymentIds(deal)] }];
    },
    "POST /disputes/resolve": async (url, request) => {
      const body = await readBody(request);
      deal = resolveDispute(deal, body.dispute_id, body.resolution);
      return [200, { disputes: deal.disputes, suspended_payments: [...suspendedPaymentIds(deal)] }];
    },
    "POST /amendments": async (url, request) => {
      deal = applyAmendment(deal, await readBody(request));
      return [201, { version: deal.version, amendments: amendmentHistory(deal) }];
    },
    "POST /jdc/vote": async (url, request) => {
      const body = await readBody(request);
      const motion = deal.jdc.motions.find((m) => m.id === body.motion_id);
      if (!motion) return [404, { error: `未找到议题: ${body.motion_id}` }];
      const outcome = conductVote(deal.jdc, motion, body.votes);
      const next = structuredClone(deal);
      next.jdc.motions = next.jdc.motions.map((m) => (m.id === motion.id ? outcome.motion : m));
      deal = next;
      return [200, outcome];
    },
  };

  return async function handle(request, response) {
    const url = new URL(request.url, "http://localhost");
    const path = url.pathname;
    try {
      const key = `${request.method} ${path}`;
      if (routes[key]) {
        const [status, payload] = await routes[key](url, request);
        return send(response, status, payload);
      }
      let match = path.match(/^\/payments\/([^/]+)\/recompute$/);
      if (request.method === "GET" && match) {
        return send(response, 200, recomputePayment(deal, findPayment(deal, match[1])));
      }
      match = path.match(/^\/payments\/([^/]+)\/invoice$/);
      if (request.method === "GET" && match) {
        return send(response, 200, invoiceFor(deal, findPayment(deal, match[1])));
      }
      match = path.match(/^\/events\/([^/]+)\/confirm$/);
      if (request.method === "POST" && match) {
        const body = await readBody(request);
        deal = confirmEvent(deal, match[1], body.party, { by: body.by, at: body.at ?? new Date().toISOString() });
        return send(response, 200, { event: deal.events.find((e) => e.id === match[1]), milestones: evaluateMilestones(deal) });
      }
      match = path.match(/^\/events\/([^/]+)\/correct$/);
      if (request.method === "POST" && match) {
        const body = await readBody(request);
        deal = correctEvent(deal, match[1], body);
        return send(response, 200, { event: deal.events.find((e) => e.id === match[1]), suspended_payments: [...suspendedPaymentIds(deal)] });
      }
      match = path.match(/^\/materials\/([^/]+)\/access$/);
      if (request.method === "GET" && match) {
        const material = deal.materials.find((m) => m.id === match[1]);
        if (!material) return send(response, 404, { error: `未找到材料: ${match[1]}` });
        const party = url.searchParams.get("party");
        if (party) return send(response, 200, { material_id: material.id, party, allowed: canAccessMaterial(deal, party, material.id) });
        return send(response, 200, { material_id: material.id, allowed_parties: materialAccess(deal, material) });
      }
      match = path.match(/^\/jdc\/quorum$/);
      if (request.method === "GET" && match) {
        const topic = url.searchParams.get("topic");
        const present = (url.searchParams.get("present") ?? "").split(",").filter(Boolean);
        return send(response, 200, quorumCheck(deal.jdc, topic, present));
      }
      return send(response, 404, { error: "未找到资源" });
    } catch (error) {
      return send(response, 400, { error: error.message });
    }
  };
}

export async function createServer(dealJson) {
  const raw = dealJson ?? (await readFile(new URL("../contracts/license_deal.json", import.meta.url), "utf8"));
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  return http.createServer(createApp(loadDeal(parsed.sample ?? parsed)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--check")) {
    if (healthPayload().service !== serviceId) process.exit(1);
    console.log("基础检查通过");
  } else {
    const portIndex = process.argv.indexOf("--port");
    const port = portIndex >= 0 ? Number(process.argv[portIndex + 1]) : 8000;
    createServer().then((server) => server.listen(port, "0.0.0.0"));
  }
}
