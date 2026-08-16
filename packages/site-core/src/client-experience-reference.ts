import {
  translateZodIssues,
  type ValidationResult,
} from "@melbourne-local-growth-ops/contracts";
import { z } from "zod";

/**
 * Non-executable reference stored in the top-level schemaVersion-2 client
 * definition. The path is fixed so configuration cannot select arbitrary source
 * or manifest locations. The assembler loads and validates the actual manifest
 * from the client input directory before calling the resolved v2 validator.
 */
export const ClientExperienceReferenceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("AUTHORED_CLIENT_EXPERIENCE"),
  manifestPath: z.literal("experience/manifest.json"),
});

export type ClientExperienceReference = z.infer<
  typeof ClientExperienceReferenceSchema
>;

export function validateClientExperienceReference(
  input: unknown,
): ValidationResult<ClientExperienceReference> {
  const parsed = ClientExperienceReferenceSchema.safeParse(input);
  return parsed.success
    ? { success: true, data: Object.freeze(parsed.data) }
    : { success: false, issues: translateZodIssues(parsed.error.issues) };
}
