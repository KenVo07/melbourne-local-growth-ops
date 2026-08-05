import { describe, expect, it } from "vitest";

import {
  validateWebsiteProfileContent,
  type WebsiteProfileContent,
} from "./index.js";

function contractorProfile(): unknown {
  return {
    schemaVersion: 1,
    profile: "CONTRACTOR",
    archetype: "SERVICE_LED",
    brand: {
      eyebrow: "Local electrical specialists",
      accentColor: "#b94c2f",
      accentContrastColor: "#ffffff",
      surfaceColor: "#fffdf8",
      textColor: "#18201d",
    },
    sections: [
      { type: "SERVICES", sectionId: "services", heading: "Services", items: [{ title: "Repairs", description: "Straightforward local repairs." }] },
      { type: "TRUST_SIGNALS", sectionId: "trust", heading: "Trust", items: ["Fully insured"], disclaimer: "Fictional demonstration content." },
      { type: "GALLERY", sectionId: "gallery", heading: "Work", items: [{ assetId: "hero-primary", alt: "Electrician working at a switchboard" }] },
      { type: "PROCESS", sectionId: "process", heading: "Process", items: [{ title: "Talk", description: "Tell us what you need." }] },
      { type: "TESTIMONIALS", sectionId: "testimonials", heading: "Feedback", items: [{ quote: "A fictional example testimonial.", attribution: "Demo customer", disclosure: "Fictional demonstration content." }] },
      { type: "FAQ", sectionId: "faq", heading: "Questions", items: [{ question: "Where do you work?", answer: "Across inner Melbourne." }] },
      { type: "CONTACT", sectionId: "contact", heading: "Contact", body: "Call or send a basic enquiry." },
      { type: "ACTIONS", sectionId: "primary", heading: "Get started", actions: [{ actionId: "call", kind: "PHONE", state: "CONFIGURED", label: "Call us", href: "tel:+61390000000" }] },
    ],
  };
}

describe("validateWebsiteProfileContent", () => {
  it("returns a frozen strict profile without changing runtime configuration", () => {
    const result = validateWebsiteProfileContent(contractorProfile());

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.profile).toBe("CONTRACTOR");
    expect(Object.isFrozen(result.data)).toBe(true);
    expect(Object.isFrozen(result.data.sections)).toBe(true);
  });

  it("rejects unknown fields through the established validation contract", () => {
    const input = contractorProfile() as Record<string, unknown>;
    input.commercialPackage = "premium";

    const result = validateWebsiteProfileContent(input);

    expect(result).toEqual({
      success: false,
      issues: [
        {
          code: "UNKNOWN_FIELD",
          path: ["commercialPackage"],
          message: "Unknown field: commercialPackage",
        },
      ],
    });
    expect(result).not.toHaveProperty("data");
  });

  it("enforces structural completeness without arbitrary item counts", () => {
    const input = contractorProfile() as {
      sections: Array<Record<string, unknown>>;
    };
    input.sections = input.sections.filter(({ type }) => type !== "FAQ");

    const result = validateWebsiteProfileContent(input);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues).toContainEqual({
      code: "INVALID_INPUT",
      path: ["sections"],
      message: "CONTRACTOR profiles require a FAQ section.",
    });
  });

  it("keeps configured and not-configured actions truthful and closed", () => {
    const profile = contractorProfile() as {
      sections: Array<Record<string, unknown>>;
    };
    const actions = profile.sections.find(({ type }) => type === "ACTIONS");
    if (actions === undefined) throw new Error("Fixture requires actions.");
    actions.actions = [
      {
        actionId: "booking",
        kind: "RESERVATION",
        state: "NOT_CONFIGURED",
        label: "Reserve",
        message: "Online reservations are not configured. Please call us.",
      },
    ];
    expect(validateWebsiteProfileContent(profile).success).toBe(true);

    (actions.actions as Array<Record<string, unknown>>)[0] = {
      actionId: "booking",
      kind: "RESERVATION",
      state: "CONFIGURED",
      label: "Reserve",
      href: "javascript:alert(1)",
    };
    const unsafe = validateWebsiteProfileContent(profile);
    expect(unsafe.success).toBe(false);
    if (unsafe.success) return;
    expect(unsafe.issues.some(({ path }) => path.at(-1) === "href")).toBe(true);
  });

  it("rejects duplicate section IDs and mismatched archetypes", () => {
    const duplicate = contractorProfile() as {
      archetype: string;
      sections: Array<{ sectionId: string }>;
    };
    duplicate.sections[1]!.sectionId = duplicate.sections[0]!.sectionId;
    const duplicateResult = validateWebsiteProfileContent(duplicate);
    expect(duplicateResult.success).toBe(false);

    const mismatch = contractorProfile() as { archetype: string };
    mismatch.archetype = "CATALOGUE_LED";
    const mismatchResult = validateWebsiteProfileContent(mismatch);
    expect(mismatchResult.success).toBe(false);
  });

  it("rejects brand overrides that cannot meet baseline text contrast", () => {
    const profile = contractorProfile() as {
      brand: { accentColor: string; accentContrastColor: string };
    };
    profile.brand.accentColor = "#ffffff";
    profile.brand.accentContrastColor = "#eeeeee";

    const result = validateWebsiteProfileContent(profile);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues).toContainEqual({
      code: "INVALID_INPUT",
      path: ["brand", "accentContrastColor"],
      message: "Accent text contrast must meet WCAG AA (4.5:1).",
    });
  });

  it("does not return rejected values", () => {
    const invalid = contractorProfile() as WebsiteProfileContent & {
      unknown: true;
    };
    invalid.unknown = true;
    const result = validateWebsiteProfileContent(invalid);
    expect(result).not.toHaveProperty("data");
  });
});
