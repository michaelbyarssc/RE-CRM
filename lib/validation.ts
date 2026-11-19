import "server-only";

import { z } from "zod";
import { BadRequestError } from "@/lib/errors";

const MAX_ID = 2147483647; // Postgres integer

/** A positive integer id. Accepts a number or a string of digits (as sent by forms). */
export const idSchema = z.preprocess(
  (v) => (typeof v === "string" && /^\d{1,10}$/.test(v) ? Number(v) : v),
  z.number().int().positive().max(MAX_ID)
);

export const idListSchema = z.array(idSchema).min(1).max(1000);

/** Parse a numeric id from the URL or query string, or answer 400. */
export function parseId(value: string | null | undefined): number {
  if (typeof value !== "string" || !/^[1-9]\d{0,9}$/.test(value) || Number(value) > MAX_ID) {
    throw new BadRequestError("Invalid id");
  }
  return Number(value);
}

/** Validate data against a schema, or answer 400. Unknown object keys are dropped. */
export function parseWith<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) throw new BadRequestError("Invalid request");
  return result.data;
}

/** A trimmed string with a length limit; "" becomes null. */
export function optionalText(max: number) {
  return z
    .string()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === null ? null : v.trim() || null));
}
