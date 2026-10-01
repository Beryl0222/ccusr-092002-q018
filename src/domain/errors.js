export class DomainError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "DomainError";
    this.status = status;
  }
}

export function require(condition, message, status = 400) {
  if (!condition) throw new DomainError(message, status);
}
