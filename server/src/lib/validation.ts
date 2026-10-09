import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

const metadata = (allowNewline = false) => z.string().refine(
  (value) => !(allowNewline ? /[\x00-\x09\x0b-\x1f\x7f-\x9f\u2028\u2029]/ : /[\x00-\x1f\x7f-\x9f\u2028\u2029]/).test(value),
  "Control characters are not allowed",
).transform((value) => value.trim());

const fields = z.object({
  name: metadata().pipe(z.string().min(1, "Name is required").max(80, "Name must be at most 80 characters")),
  teamNumber: z.number().int("Team number must be an integer").min(1, "Team number must be 1–99999").max(99999, "Team number must be 1–99999"),
  category: metadata().pipe(z.string().min(1, "Category is required").max(40, "Category must be at most 40 characters")),
  description: metadata(true).pipe(z.string().max(1000, "Description must be at most 1000 characters")),
  data: z.string().refine((value) => Buffer.byteLength(value, "utf8") >= 1 && Buffer.byteLength(value, "utf8") <= 64 * 1024, "Path source must be 1 byte–64 KB"),
});

export const draftSchema = fields.extend({ description: fields.shape.description.default("") });
export const patchSchema = fields.partial();
export const querySchema = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
  sort: z.enum(["new", "top"]).default("new"),
  limit: z.preprocess((v) => v === "" ? undefined : v, z.coerce.number().int().min(1).max(100).default(50)),
  offset: z.coerce.number().int().min(0).default(0),
});
export const voterSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "X-Voter-Id must be 8–64 characters using letters, numbers, _ or -");

export function validationMessage(error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] }): string {
  return error.issues.map((issue) => `${issue.path.length ? `${issue.path.join(".")}: ` : ""}${issue.message}`).join("; ");
}

export function validate<T extends z.ZodType>(target: "json" | "query", schema: T) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) return c.json({ error: validationMessage(result.error) }, 400);
  });
}
