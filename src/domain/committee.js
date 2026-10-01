import { require } from "./errors.js";

// 共同开发委员会：回避成员不计入法定人数；僵局沿升级阶梯上行，
// 阶梯用尽后按终局决策矩阵裁定，未约定的话题提交仲裁。

export function recusedMembers(committee, topic) {
  return (committee.recusals ?? [])
    .filter((recusal) => recusal.topic === topic)
    .map((recusal) => recusal.member_id);
}

export function eligibleMembers(committee, topic) {
  const recused = new Set(recusedMembers(committee, topic));
  return committee.members.filter((member) => !recused.has(member.id));
}

export function checkQuorum(committee, attendeeIds, topic) {
  const attendees = new Set(attendeeIds);
  const perParty = {};
  for (const member of eligibleMembers(committee, topic)) {
    perParty[member.party] ??= { required: committee.quorum.per_party, present: 0, ok: false };
    if (attendees.has(member.id)) perParty[member.party].present += 1;
  }
  for (const entry of Object.values(perParty)) {
    entry.ok = entry.present >= entry.required;
  }
  return {
    ok: Object.values(perParty).every((entry) => entry.ok),
    per_party: perParty,
    recused: recusedMembers(committee, topic),
  };
}

export function resolveVote(committee, topic, votes, attendeeIds) {
  const quorum = checkQuorum(committee, attendeeIds, topic);
  require(quorum.ok, "未达到法定人数，不能表决", 409);
  const present = eligibleMembers(committee, topic).filter((member) => attendeeIds.includes(member.id));
  const against = present.filter((member) => votes[member.id] === "反对").map((m) => m.id);
  const abstain = present
    .filter((member) => votes[member.id] !== "赞成" && votes[member.id] !== "反对")
    .map((m) => m.id);
  if (against.length === 0 && abstain.length === 0) {
    return { outcome: "decided", topic, decided_by: committee.id, votes_for: present.map((m) => m.id) };
  }
  return { outcome: "deadlock", topic, against, abstain };
}

export function escalate(committee, topic, round) {
  const ladder = committee.escalation_ladder ?? [];
  if (round < ladder.length) {
    return { topic, round, step: ladder[round], final: false };
  }
  const configured = (committee.final_decision ?? {})[topic];
  const decidedBy = configured && configured !== "consensus" ? configured : "仲裁";
  return { topic, round, step: "终局决策", final: true, decided_by: decidedBy };
}
