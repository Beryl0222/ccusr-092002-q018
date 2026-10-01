import http from "node:http";
import { pathToFileURL } from "node:url";

import { todayIso } from "./domain/dates.js";
import { DomainError } from "./domain/errors.js";
import { createStore } from "./store.js";

export const serviceId = "drug-license-obligations";
export const serviceName = "创新药授权履约账";

export function healthPayload() {
  return { status: "ok", service: serviceId, name: serviceName };
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new DomainError("请求体不是有效 JSON");
  }
}

const routes = [
  ["GET", /^\/health$/, () => healthPayload()],
  [
    "GET",
    /^\/api\/deal$/,
    ({ store }) => ({
      deal_id: store.state.deal.deal_id,
      title: store.state.deal.title,
      version: store.state.versions[store.state.versions.length - 1].n,
      parties: store.state.deal.parties,
      territories: store.state.deal.territories,
      indications: store.state.deal.indications,
    }),
  ],
  ["GET", /^\/api\/rights\/conflicts$/, ({ store }) => ({ conflicts: store.rightsGraph().conflicts })],
  [
    "GET",
    /^\/api\/rights$/,
    ({ store, query }) => {
      const territory = query.get("territory");
      const action = query.get("action");
      if (!territory || !action) throw new DomainError("缺少参数: territory 与 action");
      return {
        territory,
        action,
        holders: store.whoCanDoWhat({ territory, action, asset: query.get("asset") ?? undefined }),
      };
    },
  ],
  ["GET", /^\/api\/milestones$/, ({ store }) => ({ milestones: store.milestoneBoard() })],
  ["POST", /^\/api\/milestones\/([^/]+)\/report$/, ({ store, params, body }) => store.reportEvent(decodeURIComponent(params[0]), body)],
  ["POST", /^\/api\/milestones\/([^/]+)\/confirm$/, ({ store, params, body }) => store.confirmEvent(decodeURIComponent(params[0]), body)],
  ["POST", /^\/api\/milestones\/([^/]+)\/reject$/, ({ store, params, body }) => store.rejectEvent(decodeURIComponent(params[0]), body)],
  ["GET", /^\/api\/payments$/, ({ store }) => ({ payments: store.ledger() })],
  ["POST", /^\/api\/payments\/([^/]+)\/invoice$/, ({ store, params, body }) => store.issueInvoice(decodeURIComponent(params[0]), body)],
  ["POST", /^\/api\/payments\/([^/]+)\/pay$/, ({ store, params, body }) => store.recordPayment(decodeURIComponent(params[0]), body)],
  ["GET", /^\/api\/payments\/([^/]+)\/recompute$/, ({ store, params }) => store.recompute(decodeURIComponent(params[0]))],
  ["POST", /^\/api\/royalties\/accrue$/, ({ store, body }) => store.accrueRoyalty(body)],
  ["POST", /^\/api\/disputes$/, ({ store, body }) => store.openDispute(body)],
  ["POST", /^\/api\/disputes\/([^/]+)\/resolve$/, ({ store, params, body }) => store.resolveDispute(decodeURIComponent(params[0]), body)],
  [
    "GET",
    /^\/api\/obligations\/next$/,
    ({ store, query }) => {
      const today = query.get("today") ?? todayIso();
      return { today, obligations: store.nextObligations(today) };
    },
  ],
  [
    "GET",
    /^\/api\/reminders$/,
    ({ store, query }) => {
      const today = query.get("today") ?? todayIso();
      const window = query.get("window");
      return {
        today,
        window_days: window ? Number(window) : undefined,
        reminders: store.reminders(today, window ? Number(window) : undefined),
      };
    },
  ],
  [
    "GET",
    /^\/api\/committee\/quorum$/,
    ({ store, query }) =>
      store.quorum((query.get("attendees") ?? "").split(",").filter(Boolean), query.get("topic") ?? ""),
  ],
  ["POST", /^\/api\/committee\/vote$/, ({ store, body }) => store.vote(body.topic, body.votes ?? {}, body.attendees ?? [])],
  ["POST", /^\/api\/committee\/escalate$/, ({ store, body }) => store.escalate(body.topic, body.round ?? 0)],
  ["GET", /^\/api\/materials$/, ({ store }) => ({ materials: store.materialsOverview() })],
  ["POST", /^\/api\/materials\/([^/]+)\/access$/, ({ store, params, body }) => store.materialAccess(decodeURIComponent(params[0]), body.party, body.date ?? todayIso())],
  ["GET", /^\/api\/audit$/, ({ store }) => ({ versions: store.auditTrail(), verification: store.verifyAudit() })],
  ["POST", /^\/api\/amendments$/, ({ store, body }) => store.applyAmendment(body)],
];

export function createServer(store = createStore()) {
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      for (const [method, pattern, handler] of routes) {
        if (request.method !== method) continue;
        const match = pattern.exec(url.pathname);
        if (!match) continue;
        const body = method === "POST" ? await readBody(request) : {};
        const result = await handler({
          store,
          params: match.slice(1),
          query: url.searchParams,
          body,
        });
        sendJson(response, 200, result);
        return;
      }
      sendJson(response, 404, { error: "未找到资源" });
    } catch (error) {
      if (error instanceof DomainError) {
        sendJson(response, error.status, { error: error.message });
      } else {
        sendJson(response, 500, { error: "服务内部错误" });
      }
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--check")) {
    if (healthPayload().service !== serviceId) process.exit(1);
    const store = createStore();
    if (store.rightsGraph().conflicts.length > 0) {
      console.error("样例权利图存在冲突");
      process.exit(1);
    }
    console.log("基础检查通过");
  } else {
    const portIndex = process.argv.indexOf("--port");
    const port = portIndex >= 0 ? Number(process.argv[portIndex + 1]) : 8000;
    createServer().listen(port, "0.0.0.0");
  }
}
