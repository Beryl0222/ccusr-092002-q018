import { require } from "./errors.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function assertIsoDate(iso, field = "日期") {
  require(typeof iso === "string" && ISO_DATE.test(iso), `${field}须为 YYYY-MM-DD 格式`);
  return iso;
}

export function todayIso(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function addDays(iso, days) {
  assertIsoDate(iso);
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
