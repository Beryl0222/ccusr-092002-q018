// 日期一律用 YYYY-MM-DD 字符串，按 UTC 做加减，避免服务器本地时区干扰。
const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`非法日期: ${dateStr}`);
  return new Date(date.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

export function compareDates(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function isBefore(a, b) {
  return compareDates(a, b) < 0;
}

// 把日期（视为该时区当日）格式化为指定时区的可读形式，用于跨时区提醒展示。
export function formatInZone(dateStr, timeZone) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  return new Intl.DateTimeFormat("zh-CN", { timeZone, dateStyle: "long" }).format(date);
}
