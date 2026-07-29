import { z } from "zod";
import type { WebsiteModule } from "@melbourne-local-growth-ops/contracts";

/**
 * The lead-form member of the shared module union. Derived from the contract
 * export so the form cannot drift from the closed module type.
 */
export type LeadFormModule = Extract<WebsiteModule, { type: "LEAD_FORM" }>;

/** The closed set of fields a lead form may declare. */
export type LeadFormField = LeadFormModule["fields"][number];

/**
 * Raw, untrusted submission input.
 *
 * `submissionId` is an opaque, caller-generated identifier used for
 * idempotency. It must not encode lead content. `honeypot` and `renderedAt`
 * support spam controls and are never delivered to the provider.
 */
export const ContactFormInputSchema = z.strictObject({
  submissionId: z.string().min(1).max(200),
  name: z.string().max(200).optional(),
  email: z.string().max(320).optional(),
  phone: z.string().max(40).optional(),
  message: z.string().max(5000).optional(),
  honeypot: z.string().max(200).optional(),
  renderedAt: z.number().int().nonnegative().optional(),
});
export type ContactFormInput = z.infer<typeof ContactFormInputSchema>;

const FIELD_KEYS = {
  NAME: "name",
  EMAIL: "email",
  PHONE: "phone",
  MESSAGE: "message",
} as const satisfies Record<LeadFormField, keyof ContactFormInput>;

/**
 * Build the validation schema for a specific configured lead form.
 *
 * Only fields declared by the module are accepted, and each declared field is
 * required. Fields the module does not declare are rejected so a caller cannot
 * smuggle extra personal data through the form boundary.
 */
export function buildSubmissionSchema(module: LeadFormModule) {
  const declared = new Set<LeadFormField>(module.fields);

  const nameSchema = z.string().trim().min(1).max(200);
  const emailSchema = z.string().trim().max(320).pipe(z.email());
  const phoneSchema = z
    .string()
    .trim()
    .min(6)
    .max(40)
    .regex(/^[+0-9][0-9\s()-]*$/, "Phone number contains unsupported characters");
  const messageSchema = z.string().trim().min(1).max(5000);

  return z.strictObject({
    submissionId: z.string().trim().min(1).max(200),
    ...(declared.has("NAME") ? { name: nameSchema } : {}),
    ...(declared.has("EMAIL") ? { email: emailSchema } : {}),
    ...(declared.has("PHONE") ? { phone: phoneSchema } : {}),
    ...(declared.has("MESSAGE") ? { message: messageSchema } : {}),
  });
}

/** The input keys a module's declared fields map to. */
export function declaredInputKeys(
  module: LeadFormModule,
): readonly (keyof ContactFormInput)[] {
  return module.fields.map((field) => FIELD_KEYS[field]);
}
