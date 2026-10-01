import { readFileSync } from "node:fs";

import { applyAmendment, initVersions, traceAmendments, verifyChain } from "./domain/audit.js";
import { checkQuorum, escalate, resolveVote } from "./domain/committee.js";
import { addDays, assertIsoDate } from "./domain/dates.js";
import { activeSuspensions, openDispute, resolveDispute } from "./domain/disputes.js";
import { require } from "./domain/errors.js";
import { accessMaterial, canAccess } from "./domain/materials.js";
import {
  confirmEvent,
  initMilestoneState,
  milestoneBoard,
  rejectEvent,
  reportEvent,
} from "./domain/milestones.js";
import { toMinor } from "./domain/money.js";
import { nextObligations, reminders } from "./domain/obligations.js";
import {
  computeRoyalty,
  findWithholdingRate,
  issueInvoiceRecord,
  lockFxRate,
  makePaymentRecord,
  recomputePayment,
  recordPaymentReceived,
} from "./domain/payments.js";
import { buildRightsGraph, detectConflicts, whoCanDoWhat } from "./domain/rights.js";

export function loadSample() {
  const url = new URL("../contracts/license_deal.json", import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")).sample;
}

const QUARTER_END = { 1: "03-31", 2: "06-30", 3: "09-30", 4: "12-31" };

export function createStore(sample = loadSample()) {
  const state = {
    deal: structuredClone(sample),
    versions: [],
    milestones: {},
    payments: {},
    disputes: [],
    materialsLog: [],
    counter: { dispute: 0 },
  };
  const seedVersion = state.deal.versions?.[0] ?? null;
  delete state.deal.versions;
  state.versions = initVersions(state.deal, seedVersion);
  state.milestones = initMilestoneState(state.deal);

  const homeCurrency = state.deal.fx?.home_currency ?? "CNY";
  const partiesById = Object.fromEntries((state.deal.parties ?? []).map((p) => [p.id, p]));

  function withholdingFor(payer, payee) {
    return findWithholdingRate(
      state.deal.withholding_tax,
      partiesById[payer]?.home_country,
      partiesById[payee]?.home_country,
    );
  }

  function schedulePayment({ id, kind, source, amount, currency, payer, payee, dueDate, lockDate }) {
    require(!state.payments[id], `付款已存在: ${id}`, 409);
    const fxLock = lockFxRate(state.deal.fx?.rates, `${currency}/${homeCurrency}`, lockDate);
    const record = makePaymentRecord({
      id,
      kind,
      source,
      amount,
      currency,
      payer,
      payee,
      dueDate,
      fxLock,
      withholdingRate: withholdingFor(payer, payee),
    });
    state.payments[id] = record;
    return record;
  }

  // 首付款：自生效日起算，按生效日锁汇。
  const upfront = state.deal.upfront;
  if (upfront) {
    const effective = state.versions[0].effective_date;
    schedulePayment({
      id: upfront.id,
      kind: "upfront",
      source: "deal",
      amount: upfront.amount,
      currency: upfront.currency,
      payer: upfront.payer,
      payee: upfront.payee,
      dueDate: addDays(effective, upfront.due_days_after_effective),
      lockDate: effective,
    });
  }

  function getPayment(id) {
    const payment = state.payments[id];
    require(payment, `未找到付款: ${id}`, 404);
    return payment;
  }

  return {
    state,

    // 权利图
    rightsGraph: () => buildRightsGraph(state.deal),
    whoCanDoWhat: (query) => whoCanDoWhat(buildRightsGraph(state.deal), query),

    // 里程碑
    milestoneBoard: () => milestoneBoard(state.deal, state.milestones),
    reportEvent: (id, args) => reportEvent(state.deal, state.milestones, id, args),
    rejectEvent: (id, args) => rejectEvent(state.deal, state.milestones, id, args),
    confirmEvent: (id, args) => {
      const result = confirmEvent(state.deal, state.milestones, id, args);
      const payment = result.payment;
      if (payment && !state.payments[payment.id]) {
        schedulePayment({
          id: payment.id,
          kind: "milestone",
          source: id,
          amount: payment.amount,
          currency: payment.currency,
          payer: payment.payer,
          payee: payment.payee,
          dueDate: addDays(args.date, payment.due_days),
          lockDate: args.date,
        });
      }
      return result;
    },

    // 付款台账
    ledger: () =>
      Object.values(state.payments).map((payment) => ({
        ...payment,
        verification: payment.invoice ? recomputePayment(payment, homeCurrency).ok : null,
      })),
    issueInvoice: (id, { date }) => {
      const payment = getPayment(id);
      const invoice = issueInvoiceRecord(payment, homeCurrency);
      payment.invoiced_on = date;
      return invoice;
    },
    recordPayment: (id, { date }) => recordPaymentReceived(getPayment(id), { date }),
    recompute: (id) => recomputePayment(getPayment(id), homeCurrency),
    accrueRoyalty: ({ period, net_sales: netSales, date }) => {
      const match = /^(\d{4})Q([1-4])$/.exec(period ?? "");
      require(match, `期间格式应为 2026Q3: ${period}`);
      assertIsoDate(date, "计提日期");
      const royalties = state.deal.royalties;
      require(royalties, "本交易未约定销售分成");
      const quarterEnd = `${match[1]}-${QUARTER_END[Number(match[2])]}`;
      const dueDay = state.deal.reminders?.royalty_report_due_day ?? 30;
      const { total_minor: totalMinor, breakdown } = computeRoyalty(
        royalties.tiers,
        toMinor(netSales),
      );
      const payment = schedulePayment({
        id: `R-${period}`,
        kind: "royalty",
        source: `royalty:${period}`,
        amount: totalMinor / 100,
        currency: royalties.currency,
        payer: royalties.payer,
        payee: royalties.payee,
        dueDate: addDays(quarterEnd, dueDay),
        lockDate: quarterEnd,
      });
      return { payment, breakdown };
    },

    // 争议与数据更正
    openDispute: (args) =>
      openDispute(state, {
        paymentIds: args.payment_ids,
        reason: args.reason,
        openedBy: args.opened_by,
        date: args.date,
      }),
    resolveDispute: (id, args) =>
      resolveDispute(state, id, {
        date: args.date,
        resolution: args.resolution,
        correctedAmounts: Object.fromEntries(
          Object.entries(args.corrected_amounts ?? {}).map(([key, value]) => [key, toMinor(value)]),
        ),
        homeCurrency,
      }),
    suspensions: () => activeSuspensions(state),

    // 共同开发委员会
    quorum: (attendees, topic) => checkQuorum(state.deal.committee, attendees, topic),
    vote: (topic, votes, attendees) => resolveVote(state.deal.committee, topic, votes, attendees),
    escalate: (topic, round) => escalate(state.deal.committee, topic, round),

    // 义务与提醒
    nextObligations: (today) => nextObligations(state.deal, state, today),
    reminders: (today, windowDays) =>
      reminders(state.deal, state, today, windowDays ?? state.deal.reminders?.window_days ?? 30),

    // 修订追溯
    applyAmendment: (args) => {
      const candidate = { ...state.deal, ...args.changes };
      const conflicts = detectConflicts(candidate.grants ?? []);
      require(
        conflicts.length === 0,
        `修订将引入权利冲突: ${conflicts.map((c) => `${c.grant_a}×${c.grant_b}`).join(", ")}`,
        409,
      );
      const record = applyAmendment(state, args);
      for (const milestone of state.deal.milestones ?? []) {
        state.milestones[milestone.id] ??= {
          status: "pending",
          reported_by: null,
          reported_on: null,
          confirmed_by: null,
          confirmed_on: null,
          evidence: null,
          history: [],
        };
      }
      return record;
    },
    auditTrail: () => traceAmendments(state),
    verifyAudit: () => verifyChain(state, state.deal),

    // 材料权限
    materialAccess: (id, party, date) => accessMaterial(state.deal, state, id, { party, date }),
    materialsOverview: () =>
      (state.deal.materials ?? []).map((material) => ({
        id: material.id,
        title: material.title,
        classification: material.classification,
        access: Object.fromEntries(
          (state.deal.parties ?? []).map((party) => [
            party.id,
            canAccess(state.deal, state, material.id, party.id).allowed,
          ]),
        ),
      })),
    materialsLog: () => [...state.materialsLog],
  };
}
