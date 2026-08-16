import { describe, expect, it } from "vitest";

import type { WebsiteProfileContent } from "./profile-content.js";
import {
  resolveWebsiteExperience,
  validateWebsiteExperience,
} from "./experience.js";

const explicitExperience = {
  schemaVersion: 1,
  experienceId: "contractor-field-guide",
  experienceVersion: "1.0.0",
  designDna: {
    palette: {
      accentColor: "#174a3b",
      accentContrastColor: "#ffffff",
      surfaceColor: "#f7f4ec",
      textColor: "#17201d",
    },
    typography: {
      displayFamily: "SANS",
      bodyFamily: "SANS",
      displayScale: "EXPANSIVE",
      tracking: "TIGHT",
    },
    composition: {
      heroLayout: "MEDIA_FIRST",
      navigation: "COMPACT",
      contentWidth: "WIDE",
      sectionRhythm: "EXPANSIVE",
      surfaceTreatment: "BANDED",
      sectionOrder: [
        "services",
        "trust",
        "gallery",
        "process",
        "faq",
        "contact",
        "testimonials",
        "primary",
      ],
      featuredSectionId: "trust",
    },
    media: {
      heroFrame: "EDGE_TO_EDGE",
      heroFit: "COVER",
      galleryFrame: "EDITORIAL",
    },
    interaction: {
      actionStyle: "OUTLINE",
      motion: "SUBTLE",
    },
  },
  signature: {
    signatureId: "service-area-proof",
    placement: "AFTER_HERO",
  },
} as const;

describe("Website Experience", () => {
  it("validates and freezes a bounded explicit Design DNA contract", () => {
    const result = validateWebsiteExperience(explicitExperience);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(Object.isFrozen(result.data)).toBe(true);
    expect(Object.isFrozen(result.data.designDna.composition.sectionOrder)).toBe(
      true,
    );
  });

  it("resolves an explicit experience only when section references match the semantic profile", () => {
    const result = resolveWebsiteExperience(
      explicitExperience,
      contractorProfile(),
    );
    expect(result).toMatchObject({
      success: true,
      data: {
        source: "EXPLICIT",
        experienceId: "contractor-field-guide",
      },
    });
  });

  it("rejects section order that hides or invents semantic sections", () => {
    const result = resolveWebsiteExperience(
      {
        ...explicitExperience,
        designDna: {
          ...explicitExperience.designDna,
          composition: {
            ...explicitExperience.designDna.composition,
            sectionOrder: ["services", "invented"],
          },
        },
      },
      contractorProfile(),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "REFERENCE_NOT_FOUND",
        path: ["designDna", "composition", "sectionOrder"],
      }),
    );
  });

  it("preserves legacy WEB-01 inputs through a deterministic fallback", () => {
    const result = resolveWebsiteExperience(undefined, contractorProfile());
    expect(result).toMatchObject({
      success: true,
      data: {
        source: "LEGACY_PROFILE_DEFAULT",
        experienceId: "legacy-contractor",
        designDna: {
          palette: {
            accentColor: "#b94c2f",
            surfaceColor: "#fffdf8",
          },
        },
      },
    });
  });

  it("rejects arbitrary CSS-like fields and inaccessible color pairs", () => {
    const result = validateWebsiteExperience({
      ...explicitExperience,
      customCss: ".managed-site { display: none }",
      designDna: {
        ...explicitExperience.designDna,
        palette: {
          ...explicitExperience.designDna.palette,
          accentColor: "#ffffff",
          accentContrastColor: "#ffffff",
        },
      },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "UNKNOWN_FIELD", path: ["customCss"] }),
        expect.objectContaining({
          path: ["designDna", "palette", "accentContrastColor"],
        }),
      ]),
    );
  });
});

function contractorProfile(): WebsiteProfileContent {
  return {
    schemaVersion: 1,
    profile: "CONTRACTOR",
    archetype: "SERVICE_LED",
    brand: {
      eyebrow: "Illustrative contractor",
      accentColor: "#b94c2f",
      accentContrastColor: "#ffffff",
      surfaceColor: "#fffdf8",
      textColor: "#18201d",
    },
    sections: [
      {
        type: "SERVICES",
        sectionId: "services",
        heading: "Services",
        items: [{ title: "Repairs", description: "Illustrative repairs." }],
      },
      {
        type: "TRUST_SIGNALS",
        sectionId: "trust",
        heading: "Trust",
        items: ["Verify every claim before launch"],
      },
      {
        type: "GALLERY",
        sectionId: "gallery",
        heading: "Gallery",
        items: [{ assetId: "hero-primary", alt: "Illustrative work view" }],
      },
      {
        type: "PROCESS",
        sectionId: "process",
        heading: "Process",
        items: [{ title: "Enquire", description: "Send an enquiry." }],
      },
      {
        type: "TESTIMONIALS",
        sectionId: "testimonials",
        heading: "Feedback",
        items: [
          {
            quote: "Illustrative testimonial.",
            attribution: "Demo customer",
            disclosure: "Fictional demonstration content.",
          },
        ],
      },
      {
        type: "FAQ",
        sectionId: "faq",
        heading: "Questions",
        items: [{ question: "How do I start?", answer: "Send an enquiry." }],
      },
      {
        type: "CONTACT",
        sectionId: "contact",
        heading: "Contact",
        body: "Send a basic enquiry.",
      },
      {
        type: "ACTIONS",
        sectionId: "primary",
        heading: "Get started",
        actions: [
          {
            actionId: "call",
            kind: "PHONE",
            state: "CONFIGURED",
            label: "Call",
            href: "tel:+61355500001",
          },
        ],
      },
    ],
  };
}
