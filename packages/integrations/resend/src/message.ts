/**
 * Minimal message model sent to the Resend provider.
 *
 * This type is intentionally small — it carries only the fields needed to
 * deliver a single lead message. It is derived from a ContactFormSubmission
 * by the contact-form package; the resend package never inspects PII beyond
 * what is required to populate the message body.
 */
export interface ResendDeliveryMessage {
  readonly from: string;          // verified sending domain address
  readonly to: readonly string[];
  readonly subject: string;
  readonly text: string;
  readonly replyTo?: string;      // optional; belongs to the delivery, not the connector
}
