import { randomUUID } from "node:crypto";

export function logSafeError(error: unknown): string {
  const err = error instanceof Error ? error : new Error("Unknown error");
  const detail = err.cause instanceof Error ? err.cause : err;
  const message = /^Failed query:/i.test(detail.message)
    ? "Database query failed"
    : detail.message.split(/\n(?:Failed query:|params:)/i)[0];
  const sanitize = (text: string) => text.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g, "?");
  const errorId = randomUUID();
  console.error(JSON.stringify({ errorId, name: sanitize(detail.name), message: sanitize(message) }));
  return errorId;
}
