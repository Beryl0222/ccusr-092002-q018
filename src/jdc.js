// 共同开发委员会：回避、法定人数、僵局升级。
export function recusedMembers(jdc, topic) {
  return jdc.members.filter((m) => m.conflicts.includes(topic));
}

function eligibleMembers(jdc, topic) {
  const recused = new Set(recusedMembers(jdc, topic).map((m) => m.id));
  return jdc.members.filter((m) => !recused.has(m.id));
}

// 法定人数按“回避后的合格成员中实际出席者”计算，且每方均需达标。
export function quorumCheck(jdc, topic, presentIds) {
  const eligible = eligibleMembers(jdc, topic);
  const present = eligible.filter((m) => presentIds.includes(m.id));
  const perParty = {};
  for (const member of eligible) perParty[member.party] = 0;
  for (const member of present) perParty[member.party] += 1;
  const totalOk = present.length >= jdc.quorum.min_total;
  const partiesOk = Object.values(perParty).every((n) => n >= jdc.quorum.min_per_party);
  return {
    ok: totalOk && partiesOk,
    present: present.map((m) => m.id),
    per_party: perParty,
    recused: recusedMembers(jdc, topic).map((m) => m.id),
  };
}

// 投票：回避成员投票直接报错；平局记一次僵局，达到次数上限后沿升级路径上移。
export function conductVote(jdc, motion, votes) {
  const recused = new Set(recusedMembers(jdc, motion.topic).map((m) => m.id));
  for (const memberId of Object.keys(votes)) {
    if (recused.has(memberId)) throw new Error(`成员 ${memberId} 已回避，不得投票`);
    if (!jdc.members.some((m) => m.id === memberId)) throw new Error(`未知委员: ${memberId}`);
  }
  const voterIds = Object.keys(votes);
  const quorum = quorumCheck(jdc, motion.topic, voterIds);
  const updated = { ...motion };
  if (!quorum.ok) {
    updated.status = "未达法定人数";
    return { result: "未达法定人数", quorum, motion: updated };
  }
  const tally = { approve: 0, reject: 0, abstain: 0 };
  for (const vote of Object.values(votes)) {
    if (vote === "approve") tally.approve += 1;
    else if (vote === "reject") tally.reject += 1;
    else tally.abstain += 1;
  }
  let result;
  if (tally.approve > tally.reject) {
    result = "通过";
    updated.status = "已通过";
  } else if (tally.reject > tally.approve) {
    result = "否决";
    updated.status = "已否决";
  } else {
    result = "僵局";
    updated.attempts += 1;
    if (updated.attempts >= jdc.deadlock.max_attempts) {
      const level = Math.min(updated.attempts - jdc.deadlock.max_attempts, jdc.deadlock.escalation_path.length - 1);
      updated.status = "僵局升级";
      updated.escalate_to = jdc.deadlock.escalation_path[level];
    } else {
      updated.status = "僵局";
    }
  }
  return { result, tally, quorum, motion: updated };
}
