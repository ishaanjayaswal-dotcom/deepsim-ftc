import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const EDIT_FORBIDDEN = "This path can only be edited from the browser that published it";

export function hashEditKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function createEditKey(): string {
  return randomBytes(32).toString("base64url");
}

function equalSecrets(left: string, right: string): boolean {
  // Hash both inputs so timingSafeEqual always receives equal-length buffers.
  return timingSafeEqual(Buffer.from(hashEditKey(left), "hex"), Buffer.from(hashEditKey(right), "hex"));
}

export function canEdit(hash: string | null, key?: string, authorization?: string, adminKey?: string): boolean {
  if (adminKey && authorization?.startsWith("Bearer ") && equalSecrets(authorization.slice(7), adminKey)) return true;
  if (!hash || !key) return false;
  return timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(hashEditKey(key), "hex"));
}
