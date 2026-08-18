import { describe, expect, it } from "vitest";

import { validateStarterBrief } from "./brief.js";
import { contrastRatio } from "./decisions.js";
import { loudBrief, quietBrief, testDefinition } from "./fixtures.js";
import { generateExperienceStarter, StarterGenerationError } from "./generate.js";

function generate(brief: unknown, definition: unknown = testDefinition) {
  return generateExperienceStarter({ definition, brief });
}

function fileNamed(
  generated: ReturnType<typeof generate>,
  path: string,
): string {
  const found = generated.files.find((file) => file.path === path);
  expect(found, `expected ${path} to be generated`).toBeDefined();
  return found?.contents ?? "";
}

describe("brief validation", () => {
  it("accepts a complete brief", () => {
    expect(validateStarterBrief(quietBrief).success).toBe(true);
  });

  it("refuses a brief missing a composition decision", () => {
    const { composition, ...rest } = quietBrief;
    void composition;
    expect(validateStarterBrief(rest).success).toBe(false);
  });

  it("refuses design values outside the range a composition can hold", () => {
    for (const typography of [
      { ...quietBrief.typography, scaleRatio: 3 },
      { ...quietBrief.typography, measure: 90 },
      { ...quietBrief.typography, displayWeight: 950 },
    ]) {
      expect(
        validateStarterBrief({ ...quietBrief, typography }).success,
      ).toBe(false);
    }
  });
});

describe("generation output shape", () => {
  it("emits the fixed v2 source boundary", () => {
    const generated = generate(quietBrief);
    const paths = generated.files.map((file) => file.path);
    for (const required of [
      "manifest.json",
      "design-dna.json",
      "index.tsx",
      "components/Shell.tsx",
      "components/Pieces.tsx",
      "content/site-content.ts",
      "styles/site.css",
      "routes/HomeRoute.tsx",
      "routes/ServicesRoutes.tsx",
      "routes/AboutContactRoutes.tsx",
    ]) {
      expect(paths).toContain(required);
    }
  });

  it("emits only what this client's page graph needs", () => {
    // The fixture has no projects pages, so no project route source exists.
    const generated = generate(quietBrief);
    const paths = generated.files.map((file) => file.path);
    expect(paths).not.toContain("routes/ProjectsRoutes.tsx");
    expect(paths).not.toContain("components/Reveal.tsx");
    expect(JSON.parse(fileNamed(generated, "manifest.json")).routeIds).toEqual([
      "home",
      "services-index",
      "service-detail",
      "about",
      "contact",
    ]);
  });

  it("emits the motion helper only when the brief asks for entrance motion", () => {
    const paths = generate(loudBrief).files.map((file) => file.path);
    expect(paths).toContain("components/Reveal.tsx");
    const manifest = JSON.parse(
      fileNamed(generate(loudBrief), "manifest.json"),
    );
    expect(manifest.runtime.clientJavaScript).toBe("COMPONENT_SCOPED");
    expect(JSON.parse(fileNamed(generate(quietBrief), "manifest.json")).runtime)
      .toMatchObject({ clientJavaScript: "NONE", motion: "NATIVE" });
  });

  it("declares no public dependency", () => {
    for (const brief of [quietBrief, loudBrief]) {
      expect(
        JSON.parse(fileNamed(generate(brief), "manifest.json"))
          .publicDependencies,
      ).toEqual([]);
    }
  });

  it("is deterministic", () => {
    expect(generate(quietBrief).sourceHash).toBe(
      generate(quietBrief).sourceHash,
    );
  });
});

describe("standalone portability — the property the whole design rests on", () => {
  it("never imports the generator, a workspace package or a forbidden module", () => {
    // Counted across the whole tree rather than per file, so the assertions
    // below cannot pass vacuously — a leaf helper that imports nothing is a
    // legitimate file, an entire generation that imports nothing is not.
    let seen = 0;
    for (const brief of [quietBrief, loudBrief]) {
      for (const file of generate(brief).files) {
        if (!file.path.endsWith(".ts") && !file.path.endsWith(".tsx")) continue;
        const specifiers = [
          ...file.contents.matchAll(/from\s+"([^"]+)"/g),
        ].map(([, specifier]) => specifier ?? "");
        seen += specifiers.length;
        for (const specifier of specifiers) {
          expect(specifier).not.toContain("experience-starter");
          expect(specifier).not.toContain("@melbourne-local-growth-ops/");
          expect(specifier.startsWith("node:")).toBe(false);
          const bare = !specifier.startsWith(".");
          if (bare) {
            expect(["@proportion/client-experience", "react"]).toContain(
              specifier,
            );
          }
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("emits a stylesheet with no remote resource reference", () => {
    for (const brief of [quietBrief, loudBrief]) {
      const css = fileNamed(generate(brief), "styles/site.css");
      expect(css).not.toMatch(/@import/i);
      expect(css).not.toMatch(/\burl\s*\(/i);
      expect(css).not.toMatch(/image-set\s*\(/i);
    }
  });

  it("hard-codes no client brand colour in the stylesheet", () => {
    // Accent, surface and ink are bound at runtime from the validated profile.
    const css = fileNamed(generate(quietBrief), "styles/site.css");
    expect(css).not.toContain(testDefinition.profile.brand.accentColor);
    expect(css).toContain("var(--accent)");
    expect(fileNamed(generate(quietBrief), "components/Shell.tsx")).toContain(
      "profile.brand.accentColor",
    );
  });
});

describe("no template destiny — same Profile, same client, two briefs", () => {
  const quiet = generate(quietBrief);
  const loud = generate(loudBrief);

  it("produces materially different source", () => {
    expect(quiet.sourceHash).not.toBe(loud.sourceHash);
  });

  it("differs in typography, ground, spacing and media scale", () => {
    const quietCss = fileNamed(quiet, "styles/site.css");
    const loudCss = fileNamed(loud, "styles/site.css");
    const token = (css: string, name: string) =>
      new RegExp(`--${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim();

    for (const name of ["paper", "measure", "shell", "unit", "media-radius"]) {
      expect(token(quietCss, name)).not.toBe(token(loudCss, name));
    }
    expect(token(quietCss, "display")).not.toBe(token(loudCss, "display"));
    // Media scale changes the frames themselves, not only their size.
    expect(quietCss).toContain("16 / 10");
    expect(loudCss).toContain("4 / 3");
  });

  it("differs in composition grammar, not only in colour", () => {
    const quietHome = fileNamed(quiet, "routes/HomeRoute.tsx");
    const loudHome = fileNamed(loud, "routes/HomeRoute.tsx");
    expect(quietHome).toContain("qc-hero");
    expect(quietHome).not.toContain("qc-cover");
    expect(loudHome).toContain("ld-cover");
    expect(loudHome).not.toContain("ld-hero-copy");

    expect(fileNamed(quiet, "routes/ServicesRoutes.tsx")).toContain(
      "qc-service-row",
    );
    expect(fileNamed(loud, "routes/ServicesRoutes.tsx")).toContain(
      "ld-service-grid",
    );
    expect(fileNamed(quiet, "routes/AboutContactRoutes.tsx")).toContain(
      "qc-contact",
    );
    expect(fileNamed(loud, "routes/AboutContactRoutes.tsx")).toContain(
      "ld-channels",
    );
  });

  it("emits only the chosen grammar, never both", () => {
    // The unchosen composition must not be present as dead source or dead CSS.
    expect(fileNamed(quiet, "styles/site.css")).not.toContain("qc-cover-copy");
    expect(fileNamed(loud, "styles/site.css")).not.toContain("ld-hero-copy");
  });

  it("records the difference in each client's own Design DNA", () => {
    const quietDna = JSON.parse(fileNamed(quiet, "design-dna.json"));
    const loudDna = JSON.parse(fileNamed(loud, "design-dna.json"));
    expect(quietDna.composition.principles).not.toEqual(
      loudDna.composition.principles,
    );
    expect(quietDna.motion.intent).not.toBe(loudDna.motion.intent);
  });
});

describe("the neutral scale is proved, not asserted", () => {
  it("clears WCAG AA against the ground and the validated brand surface", () => {
    for (const brief of [quietBrief, loudBrief]) {
      const generated = generate(brief);
      for (const entry of generated.design.colour.contrastReport) {
        expect(entry.ratio).toBeGreaterThanOrEqual(4.5);
      }
      // And the muted tone is a genuinely stronger step, not a duplicate.
      expect(generated.design.colour.inkMuted).not.toBe(
        generated.design.colour.inkFaint,
      );
      expect(
        contrastRatio(
          generated.design.colour.inkMuted,
          generated.design.colour.paper,
        ),
      ).toBeGreaterThan(
        contrastRatio(
          generated.design.colour.inkFaint,
          generated.design.colour.paper,
        ),
      );
    }
  });

  it("keeps a display size inside what a composition can hold", () => {
    // A 1.6 ratio compounds to a 12rem sixth step. The role bound is what stops
    // a hierarchy decision becoming an unusable headline.
    expect(generate(loudBrief).design.type.scale.hero).toBeLessThanOrEqual(4.75);
    expect(generate(quietBrief).design.type.scale.hero).toBeGreaterThanOrEqual(
      2.4,
    );
  });
});

describe("refusals", () => {
  it("refuses a page kind it has no composition for", () => {
    const definition = {
      ...testDefinition,
      pageGraph: {
        ...testDefinition.pageGraph,
        pages: [
          ...testDefinition.pageGraph.pages,
          {
            pageId: "areas",
            path: "/areas",
            kind: "SERVICE_AREAS",
            experienceRouteId: "service-areas",
          },
        ],
      },
    };
    expect(() => generate(quietBrief, definition)).toThrow(
      StarterGenerationError,
    );
    expect(() => generate(quietBrief, definition)).toThrow(
      /no composition for route "service-areas"/,
    );
  });

  it("refuses a brief that places media the client never licensed", () => {
    const brief = {
      ...quietBrief,
      mediaPlan: {
        ...quietBrief.mediaPlan,
        homeHero: { assetId: "borrowed", alt: "Alt.", focal: { x: 0.5, y: 0.5 } },
      },
    };
    expect(() => generate(brief)).toThrow(/does not declare: borrowed/);
  });

  it("refuses a brief that narrates a service the profile does not declare", () => {
    const brief = {
      ...quietBrief,
      serviceNarratives: [
        ...quietBrief.serviceNarratives,
        {
          serviceId: "invented-service",
          body: "Body.",
          questions: ["Q?"],
          media: { assetId: "first", alt: "Alt.", focal: { x: 0.5, y: 0.5 } },
        },
      ],
    };
    expect(() => generate(brief)).toThrow(/does not declare: invented-service/);
  });

  it("refuses to leave a service detail route without narrative", () => {
    const brief = {
      ...quietBrief,
      serviceNarratives: [quietBrief.serviceNarratives[0]],
    };
    expect(() => generate(brief)).toThrow(/Missing: second-service/);
  });

  it("refuses a ground the configured brand surface cannot live on", () => {
    // A dark ground needs light ink; the fixture's brand surface is light.
    // Emitting an illegible site would be worse than refusing to emit one.
    const brief = {
      ...quietBrief,
      colour: { ground: "DEEP_INK", contrast: "CRISP" },
    };
    expect(() => generate(brief)).toThrow(
      /cannot share one legible neutral scale/,
    );
  });

  it("refuses a legacy definition", () => {
    expect(() => generate(quietBrief, { ...testDefinition, schemaVersion: 1 }))
      .toThrow(/schemaVersion 2/);
  });
});

describe("interaction capability emission", () => {
  const faqSection = {
    type: "FAQ",
    sectionId: "faq",
    heading: "Questions",
    items: [
      { question: "One?", answer: "A." },
      { question: "Two?", answer: "B." },
      { question: "Three?", answer: "C." },
      { question: "Four?", answer: "D." },
    ],
  };

  const withFaq = {
    ...testDefinition,
    profile: {
      ...testDefinition.profile,
      sections: [...testDefinition.profile.sections, faqSection],
    },
  };

  const language = {
    tempo: "MEASURED",
    attack: "EASED",
    travel: 0.5,
    overshoot: 0,
    interactionDensity: 0.6,
    revealDensity: 0.5,
    disclosure: "WHEN_LONG",
    mediaExploration: "WHEN_PLURAL",
    reducedMotion: "INSTANT",
  } as const;

  const briefWith = (interaction: Partial<typeof language>) => ({
    ...loudBrief,
    interaction: { ...language, ...interaction },
  });

  it("emits no interaction helper a client did not ask for", () => {
    const still = generate(
      briefWith({ interactionDensity: 0, revealDensity: 0, travel: 0, disclosure: "ALWAYS_VISIBLE" }),
      withFaq,
    );
    const paths = still.files.map((file) => file.path);
    for (const helper of [
      "components/Reveal.tsx",
      "components/Disclosure.tsx",
      "components/MediaViewer.tsx",
      "components/motion.ts",
    ]) {
      expect(paths).not.toContain(helper);
    }
    expect(
      JSON.parse(fileNamed(still, "manifest.json")).runtime.clientJavaScript,
    ).toBe("NONE");
  });

  it("emits the disclosure helper only where content and language agree", () => {
    const folded = generate(briefWith({ disclosure: "WHEN_LONG" }), withFaq);
    expect(folded.interactions.contactFaq.treatment).toBe(
      "PROGRESSIVE_DISCLOSURE",
    );
    expect(folded.files.map((file) => file.path)).toContain(
      "components/Disclosure.tsx",
    );

    // Same content, a client that keeps things open.
    const open = generate(briefWith({ disclosure: "ALWAYS_VISIBLE" }), withFaq);
    expect(open.interactions.contactFaq.treatment).toBe("STATIC");
    expect(open.files.map((file) => file.path)).not.toContain(
      "components/Disclosure.tsx",
    );
    expect(fileNamed(open, "routes/AboutContactRoutes.tsx")).toContain("<dl");
  });

  it("emits no media explorer for a client whose page graph has no projects", () => {
    // The fixture carries no project routes, so the capability cannot apply.
    const generated = generate(briefWith({ mediaExploration: "PREFERRED" }), withFaq);
    expect(generated.interactions.projectMedia.treatment).toBe("STATIC");
    expect(generated.files.map((file) => file.path)).not.toContain(
      "components/MediaViewer.tsx",
    );
  });

  it("explains every decision it made", () => {
    const generated = generate(briefWith({}), withFaq);
    for (const decision of [
      generated.interactions.contactFaq,
      generated.interactions.serviceQuestions,
      generated.interactions.projectMedia,
    ]) {
      expect(decision.reason.length).toBeGreaterThan(20);
    }
  });

  it("keeps generated interaction source free of the generator", () => {
    const generated = generate(briefWith({}), withFaq);
    for (const file of generated.files) {
      if (!file.path.startsWith("components/")) continue;
      expect(file.contents).not.toContain("experience-starter");
      expect(file.contents).not.toContain("@melbourne-local-growth-ops/");
    }
  });

  it("holds no frame loop, scroll listener or persistent browser state", () => {
    const generated = generate(briefWith({}), withFaq);
    for (const file of generated.files) {
      if (!file.path.endsWith(".tsx") && !file.path.endsWith(".ts")) continue;
      expect(file.contents).not.toContain("requestAnimationFrame");
      expect(file.contents).not.toContain('addEventListener("scroll"');
      expect(file.contents).not.toContain("localStorage");
      expect(file.contents).not.toContain("setInterval");
    }
  });

  it("gives two clients on one Profile a different interaction character", () => {
    const patient = generate(
      briefWith({ tempo: "UNHURRIED", attack: "SETTLED", travel: 0.8, disclosure: "ALWAYS_VISIBLE" }),
      withFaq,
    );
    const brisk = generate(
      briefWith({ tempo: "BRISK", attack: "IMMEDIATE", travel: 0.2, overshoot: 0.6, disclosure: "PREFERRED" }),
      withFaq,
    );

    // Different tempo, different curves, different distances.
    expect(patient.design.interaction.duration.state).not.toBe(
      brisk.design.interaction.duration.state,
    );
    expect(patient.design.interaction.easing.enter).not.toBe(
      brisk.design.interaction.easing.enter,
    );
    expect(patient.design.interaction.travel.reveal).not.toBe(
      brisk.design.interaction.travel.reveal,
    );

    // And a different answer to what the content should even do — which is the
    // variation that matters, because it is structural rather than numeric.
    expect(patient.interactions.contactFaq.treatment).toBe("STATIC");
    expect(brisk.interactions.contactFaq.treatment).toBe(
      "PROGRESSIVE_DISCLOSURE",
    );
    expect(patient.sourceHash).not.toBe(brisk.sourceHash);
  });
});
