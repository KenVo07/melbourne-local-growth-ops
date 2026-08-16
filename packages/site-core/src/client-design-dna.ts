import {
  translateZodIssues,
  type ValidationResult,
} from "@melbourne-local-growth-ops/contracts";
import { z } from "zod";

const boundedId = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/);
const semanticVersion = z
  .string()
  .trim()
  .regex(/^\d+\.\d+\.\d+$/);
const shortText = z.string().trim().min(1).max(240);
const principle = z.string().trim().min(1).max(600);
const principles = z.array(principle).min(1).max(12);

const designDimension = z.strictObject({
  intent: principle,
  principles,
});

/**
 * A concise creative grammar/provenance artifact. This schema deliberately
 * records intent and constraints rather than attempting to encode JSX, CSS,
 * breakpoints, timelines, arbitrary tokens, or a complete visual renderer.
 */
export const ClientDesignDnaSchema = z.strictObject({
  schemaVersion: z.literal(1),
  designDnaId: boundedId,
  designDnaVersion: semanticVersion,
  creativeThesis: principle,
  perceptionTargets: z.array(shortText).min(1).max(10),
  antiTargets: z.array(shortText).min(1).max(10),
  typography: designDimension,
  colour: designDimension,
  composition: designDimension,
  imagery: designDimension,
  interaction: designDimension,
  motion: designDimension.extend({
    reducedMotionIntent: principle,
  }),
  responsive: designDimension,
  signatureIntent: z.strictObject({
    name: shortText,
    purpose: principle,
  }),
});

export type ClientDesignDna = z.infer<typeof ClientDesignDnaSchema>;

export function validateClientDesignDna(
  input: unknown,
): ValidationResult<ClientDesignDna> {
  const parsed = ClientDesignDnaSchema.safeParse(input);
  return parsed.success
    ? { success: true, data: deepFreeze(parsed.data) }
    : { success: false, issues: translateZodIssues(parsed.error.issues) };
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
