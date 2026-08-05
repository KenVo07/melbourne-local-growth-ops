import {
  validateWebsiteProfileContent,
  type WebsiteProfileContent,
} from "@melbourne-local-growth-ops/site-core";

const rawContractorProfile = {
  schemaVersion: 1,
  profile: "CONTRACTOR",
  archetype: "SERVICE_LED",
  brand: {
    eyebrow: "Illustrative Melbourne Electrical Website",
    accentColor: "#b94c2f",
    accentContrastColor: "#ffffff",
    surfaceColor: "#fffdf8",
    textColor: "#18201d",
  },
  sections: [
    {
      type: "SERVICES",
      sectionId: "services",
      heading: "Illustrative Services & Proposed Coverage",
      eyebrow: "Proposed Services",
      items: [
        {
          title: "Residential Electrical Installation",
          description: "Illustrative proposed copy for general wiring, lighting, power point, and safety switch services. Confirm the real client's approved scope before publishing.",
        },
        {
          title: "Switchboard Upgrades & Circuit Safety",
          description: "Illustrative proposed copy for switchboard and circuit-safety services. Verify the real client's qualifications and approved service wording before publishing.",
        },
        {
          title: "Split-System Air Conditioning",
          description: "Illustrative proposed copy for split-system electrical work. Confirm the real client's licensing, service scope, and commissioning wording before publishing.",
        },
      ],
    },
    {
      type: "TRUST_SIGNALS",
      sectionId: "trust",
      heading: "Proposed Verification Checklist",
      eyebrow: "Onboarding Requirements",
      items: [
        "Verify current electrical licences and any relevant trade credentials before publishing this profile",
        "Confirm current public liability insurance status and approve any public wording before publishing",
        "Agree and approve any quoting, pricing, scope, or service-result statements before publishing",
      ],
      disclaimer: "Harbour Electrical & Air is a fictional demonstration profile. These are onboarding verification requirements only; this demo asserts no licence, qualification, insurance, pricing, standards, or service-result claim.",
    },
    {
      type: "GALLERY",
      sectionId: "gallery",
      heading: "Illustrative Electrical Service Views",
      eyebrow: "Demonstration Assets",
      items: [
        {
          assetId: "gallery-switchboard-detail",
          alt: "Illustrative close view of an electrician working at an open residential switchboard",
          caption: "Illustrative crop showing switchboard detail and insulated tools; not evidence of a completed client project.",
        },
        {
          assetId: "gallery-work-context",
          alt: "Illustrative residential context view of an electrician beside an open switchboard",
          caption: "Illustrative crop showing the broader residential work context; not evidence of work performed by the fictional business.",
        },
      ],
    },
    {
      type: "PROCESS",
      sectionId: "process",
      heading: "Illustrative Service Process",
      eyebrow: "Proposed Workflow",
      items: [
        {
          title: "1. Enquiry & Initial Contact",
          description: "Illustrative process step: submit a basic enquiry through the demonstration contact form. Confirm live contact channels during onboarding.",
        },
        {
          title: "2. Site Assessment & Proposed Quote",
          description: "Proposed process copy: a site assessment would inform a written scope and quote. Confirm the real client's quoting and pricing policy before publishing.",
        },
        {
          title: "3. Trade Delivery Requirements",
          description: "Proposed process copy only. Verify the real client's trade qualifications and approve any safety or standards claims before publishing.",
        },
        {
          title: "4. Testing & Customer Handover",
          description: "Illustrative process copy for testing, clean-up, and handover. Confirm the real client's actual procedure and approved result wording before publishing.",
        },
      ],
    },
    {
      type: "TESTIMONIALS",
      sectionId: "testimonials",
      heading: "Illustrative Customer Voices",
      eyebrow: "Fictional Scenarios",
      items: [
        {
          quote: "Clear updates, a tidy appointment, and an easy-to-follow explanation made the proposed customer journey feel reassuring.",
          attribution: "Illustrative customer voice — Oakleigh scenario",
          disclosure: "Fictional demonstration testimonial for presentation only; it is not customer evidence or a service-result claim.",
        },
        {
          quote: "The example quote process was simple to understand, with scope and timing presented in a calm, practical way.",
          attribution: "Illustrative customer voice — Brighton scenario",
          disclosure: "Fictional demonstration testimonial for presentation only; replace it with verified, approved customer feedback before publishing.",
        },
      ],
    },
    {
      type: "FAQ",
      sectionId: "faq",
      heading: "Frequently Asked Questions",
      eyebrow: "Help & Information",
      items: [
        {
          question: "Which areas of Melbourne do you service?",
          answer: "This proposed demo profile uses South-Eastern, Eastern, and Bayside Melbourne as illustrative coverage only. Confirm the real client's service area before publishing.",
        },
        {
          question: "How are job quotes calculated?",
          answer: "This demo proposes a site assessment followed by a written quote. Confirm the real client's quoting, pricing, and approval policy before publishing.",
        },
        {
          question: "How can I request a service appointment?",
          answer: "The illustrative website offers a demonstration booking link and basic enquiry form. Confirm live appointment channels during onboarding.",
        },
        {
          question: "Are emergency call-outs available?",
          answer: "Emergency call-out availability is not configured in this fictional demo. Confirm availability and a client-verified contact method before publishing.",
        },
      ],
    },
    {
      type: "CONTACT",
      sectionId: "contact",
      heading: "Request a Contractor Enquiry",
      eyebrow: "Get In Touch",
      body: "Fill out the basic enquiry form with your contact details and a short description of your electrical or air conditioning job. Please do not submit credit card numbers, passwords, or confidential personal information.",
    },
    {
      type: "ACTIONS",
      sectionId: "actions",
      heading: "Talk with the Service Team",
      eyebrow: "Direct Contact",
      actions: [
        {
          actionId: "call-primary",
          kind: "PHONE",
          state: "NOT_CONFIGURED",
          label: "Phone contact unavailable in demo",
          message: "No phone number is configured for this fictional demonstration. Add a client-verified business number before launch.",
        },
      ],
    },
  ],
};

const validationResult = validateWebsiteProfileContent(rawContractorProfile);
if (!validationResult.success) {
  throw new Error(`Default contractor profile failed validation: ${JSON.stringify(validationResult.issues)}`);
}

/**
 * Canonical default contractor profile content.
 * Complies with ContractorProfileContentSchema and satisfies all 8 required section types:
 * SERVICES, TRUST_SIGNALS, GALLERY, PROCESS, TESTIMONIALS, FAQ, CONTACT, ACTIONS.
 */
export const defaultContractorProfileContent: WebsiteProfileContent = validationResult.data;

/**
 * Creates a validated contractor profile content object with optional partial overrides.
 */
export function createContractorProfileContent(
  overrides?: Partial<WebsiteProfileContent>,
): WebsiteProfileContent {
  const merged = {
    ...defaultContractorProfileContent,
    ...overrides,
    brand: {
      ...defaultContractorProfileContent.brand,
      ...overrides?.brand,
    },
    sections: overrides?.sections ?? defaultContractorProfileContent.sections,
  };
  const result = validateWebsiteProfileContent(merged);
  if (!result.success) {
    throw new Error(`Created contractor profile failed validation: ${JSON.stringify(result.issues)}`);
  }
  return result.data;
}
