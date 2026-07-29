import type { ResendDeliveryMessage } from "@melbourne-local-growth-ops/resend";

import type { EmailDeliveryConnector } from "@melbourne-local-growth-ops/resend";
import { fieldLabel, submissionValue } from "./submission.js";
import type { ContactFormSubmission } from "./submission.js";

export interface MessageMapOptions {
  readonly businessName: string;
  /**
   * When true, a collected visitor email becomes the message reply-to so the
   * operator can respond directly. The sender always stays the connector's
   * verified address.
   */
  readonly replyToVisitor?: boolean;
}

/**
 * Map the contact-form domain model to the minimal provider message.
 *
 * The sender is always the connector's verified `fromAddress`; the visitor's
 * address is never used as the sender, because it belongs to an unverified
 * domain and would be rejected or treated as spoofing.
 */
export function toDeliveryMessage(
  connector: EmailDeliveryConnector,
  submission: ContactFormSubmission,
  options: MessageMapOptions,
): ResendDeliveryMessage {
  const lines = submission.fields.map(
    (entry) => `${fieldLabel(entry.field)}: ${entry.value}`,
  );

  const visitorEmail = submissionValue(submission, "EMAIL");
  const replyTo =
    options.replyToVisitor === true && visitorEmail !== undefined
      ? { replyTo: visitorEmail }
      : {};

  return Object.freeze({
    from: connector.fromAddress,
    to: Object.freeze([...connector.recipientAddresses]),
    subject: `New website enquiry — ${options.businessName}`,
    text: lines.join("\n"),
    ...replyTo,
  });
}
