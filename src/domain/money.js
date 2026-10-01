import { DomainError } from "./errors.js";

// 金额一律以最小货币单位（分）的整数计算，保证财务可逐笔复算。

export function toMinor(amount) {
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    throw new DomainError(`金额无效: ${amount}`);
  }
  return Math.round(amount * 100);
}

export function toMajor(minor) {
  return minor / 100;
}

export function rateToBps(rate) {
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new DomainError(`税率无效: ${rate}`);
  }
  return Math.round(rate * 10000);
}

export function mulBps(minor, bps) {
  return Math.round((minor * bps) / 10000);
}

export function mulRate(minor, rate) {
  return mulBps(minor, rateToBps(rate));
}

export function fxToScaled(rate) {
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
    throw new DomainError(`汇率无效: ${rate}`);
  }
  return Math.round(rate * 10000);
}

export function mulFx(minor, scaledRate) {
  return Math.round((minor * scaledRate) / 10000);
}
