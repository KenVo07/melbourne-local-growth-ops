import type { RuntimeWebsiteProfileContent } from "../../runtime-types";

export interface ServiceAreaProofProps {
  readonly businessName: string;
  readonly profile: RuntimeWebsiteProfileContent;
}

export function ServiceAreaProof({
  businessName,
  profile,
}: ServiceAreaProofProps) {
  const faq = profile.sections.find((section) => section.type === "FAQ");
  const coverage = faq?.type === "FAQ"
    ? faq.items.find(({ question }) => /area|location|service/i.test(question))
    : undefined;
  if (coverage === undefined) return null;

  const trust = profile.sections.find(
    (section) => section.type === "TRUST_SIGNALS",
  );
  const headingId = "signature-service-area-proof-heading";

  return (
    <aside
      aria-labelledby={headingId}
      className="website-signature service-area-proof"
      data-signature-id="service-area-proof"
      data-signature-placement="after_hero"
    >
      <div className="service-area-proof-heading">
        <p>Coverage field note</p>
        <h2 id={headingId}>Service area, stated carefully</h2>
      </div>
      <dl>
        <div>
          <dt>{coverage.question}</dt>
          <dd>{coverage.answer}</dd>
        </div>
      </dl>
      {trust?.type !== "TRUST_SIGNALS" || trust.disclaimer === undefined
        ? null
        : <p className="profile-disclaimer">{trust.disclaimer}</p>}
      <p className="service-area-proof-source">
        Public profile note for {businessName}
      </p>
    </aside>
  );
}
