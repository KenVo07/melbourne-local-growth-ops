import type { LeadFormField, LeadFormModule } from "./input-schema.js";

/**
 * Normalized, validated submission.
 *
 * This is the contact-form domain model. The resend package never sees it —
 * it is mapped to a minimal provider message at the delivery boundary.
 */
export interface ContactFormSubmission {
  readonly submissionId: string;
  readonly fields: readonly ContactFormFieldValue[];
}

export interface ContactFormFieldValue {
  readonly field: LeadFormField;
  readonly value: string;
}

const FIELD_LABELS = {
  NAME: "Name",
  EMAIL: "Email",
  PHONE: "Phone",
  MESSAGE: "Message",
} as const satisfies Record<LeadFormField, string>;

export function fieldLabel(field: LeadFormField): string {
  return FIELD_LABELS[field];
}

/**
 * Build the normalized submission in the module's declared field order, so the
 * delivered message is deterministic for a given configuration.
 */
export function normalizeSubmission(
  module: LeadFormModule,
  submissionId: string,
  values: Readonly<Record<string, string>>,
): ContactFormSubmission {
  const fields: ContactFormFieldValue[] = [];

  for (const field of module.fields) {
    const key = field.toLowerCase();
    const value = values[key];
    if (value !== undefined) {
      fields.push(Object.freeze({ field, value }));
    }
  }

  return Object.freeze({
    submissionId,
    fields: Object.freeze(fields),
  });
}

/** Find a normalized value by field, if the form collected it. */
export function submissionValue(
  submission: ContactFormSubmission,
  field: LeadFormField,
): string | undefined {
  return submission.fields.find((entry) => entry.field === field)?.value;
}
