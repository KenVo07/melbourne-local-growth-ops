import { describe, expect, it } from "vitest";

import type { WebsiteProfileContent } from "./profile-content.js";
import {
  projectProfileSearchRecords,
  resolveFoundationSearch,
} from "./foundation-search.js";

const context = {
  businessName: "Harbour Electrical & Air",
  profile: contractorProfile(),
} as const;

describe("Foundation Search", () => {
  it("keeps legacy definitions disabled with no records", () => {
    expect(resolveFoundationSearch(undefined, context)).toEqual({
      success: true,
      data: {
        schemaVersion: 1,
        mode: "OFF",
        enabled: false,
        reason: "DEFAULT_OFF",
        records: [],
      },
    });
  });

  it("projects deterministic public records without action URLs", () => {
    const records = projectProfileSearchRecords(context);
    expect(records).toHaveLength(8);
    expect(records[0]).toMatchObject({
      url: "/#services",
      language: "en",
      meta: {
        title: "Services",
        businessName: "Harbour Electrical & Air",
        sectionId: "services",
        profile: "CONTRACTOR",
      },
    });
    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain("tel:+61355500001");
    expect(serialized).not.toContain("https://");
    expect(Object.isFrozen(records)).toBe(true);
  });

  it("enables explicit ON and keeps the scope in profile order", () => {
    const result = resolveFoundationSearch(
      {
        schemaVersion: 1,
        mode: "ON",
        includeSectionIds: ["faq", "services"],
      },
      context,
    );
    expect(result).toMatchObject({
      success: true,
      data: {
        enabled: true,
        reason: "EXPLICIT_ON",
        records: [{ url: "/#services" }, { url: "/#faq" }],
      },
    });
  });

  it("uses a deterministic AUTO threshold instead of navigation repair heuristics", () => {
    const full = resolveFoundationSearch(
      { schemaVersion: 1, mode: "AUTO" },
      context,
    );
    expect(full).toMatchObject({
      success: true,
      data: { enabled: true, reason: "AUTO_ENABLED" },
    });

    const narrow = resolveFoundationSearch(
      {
        schemaVersion: 1,
        mode: "AUTO",
        includeSectionIds: ["contact"],
      },
      context,
    );
    expect(narrow).toMatchObject({
      success: true,
      data: {
        enabled: false,
        reason: "AUTO_BELOW_THRESHOLD",
        records: [],
      },
    });
  });

  it("rejects unknown index scope rather than silently indexing the wrong content", () => {
    const result = resolveFoundationSearch(
      {
        schemaVersion: 1,
        mode: "ON",
        includeSectionIds: ["private-drafts"],
      },
      context,
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "REFERENCE_NOT_FOUND",
        path: ["foundationSearch", "includeSectionIds"],
      }),
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
        items: [
          { title: "Repairs", description: "Illustrative repairs.", featured: false },
        ],
        groups: [],
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
