import { describe, expect, it } from "vitest";

import { validateStarterBrief, type StarterInteraction } from "./brief.js";
import { contrastRatio } from "./decisions.js";
import { loudBrief, quietBrief, testDefinition } from "./fixtures.js";
import { generateExperienceStarter, StarterGenerationError } from "./generate.js";
import { foldsAway } from "./interaction-decisions.js";

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

  it("refuses a service detail route for a service with nothing to say", () => {
    const brief = {
      ...quietBrief,
      serviceNarratives: [quietBrief.serviceNarratives[0]],
    };
    expect(() => generate(brief)).toThrow(/Silent services: second-service/);
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
  /*
   * Answers a reader would actually have to read. The earlier fixture answered
   * every question with a single letter, which made the disclosure rules look
   * as though they only counted items — a run of one-word answers is a table,
   * and the generator is supposed to refuse to fold a table.
   */
  const faqSection = {
    type: "FAQ",
    sectionId: "faq",
    heading: "Questions",
    items: [
      {
        question: "Which areas do you work in?",
        answer:
          "We work across the inner north and inner east, and travel further for stonework that warrants the trip. Anything outside that is quoted with the travel stated separately.",
      },
      {
        question: "How are quotes calculated?",
        answer:
          "From the measured drawing rather than from a rate card, because the same square metre of wall costs differently depending on what it is holding up and how the stone has to be cut.",
      },
      {
        question: "How do I request a visit?",
        answer:
          "Send the address and a photograph of what you are looking at. We will tell you before visiting whether it is something we take on, so nobody spends a morning on a job we would decline.",
      },
      {
        question: "Do you take emergency call-outs?",
        answer:
          "For structural failure in something we built, yes, at any hour. For everything else we schedule properly, because rushed stonework is the thing we are most often called to replace.",
      },
    ],
  };

  /*
   * A contractor's terms. Structurally identical to the questions above — a run
   * of titled prose — and used the same way, so it must fold under exactly the
   * same rule. This is the second semantic context that proves the capability
   * is general rather than an FAQ feature under a general name.
   */
  const policiesSection = {
    type: "POLICIES",
    sectionId: "policies",
    heading: "Terms and guarantees",
    items: [
      {
        title: "Workmanship guarantee",
        body: "Structural stonework carries a ten-year guarantee on the work itself. It covers the setting and the cut, and it does not cover movement in ground we did not prepare.",
      },
      {
        title: "Deposit and payment",
        body: "A third on acceptance of the drawing, a third at the halfway inspection, the balance at handover. Nothing is invoiced for work that has not been done and inspected.",
      },
      {
        title: "Cancellation",
        body: "Cancel before the stone is cut and the deposit is returned less the drawing. Once a piece is cut to your dimensions it cannot go back, so from that point the deposit is retained.",
      },
      {
        title: "Insurance",
        body: "Public liability is carried to twenty million and the certificate is sent with every quote. Subcontracted crane work carries its own cover, named on the same certificate.",
      },
    ],
  };

  /*
   * An ordered method. The same structural shape as both runs above — titled
   * items carrying prose — which is exactly why it is the useful control: if
   * the generator folded this too, it would be reasoning about structure rather
   * than about how a reader uses the content.
   */
  const processSection = {
    type: "PROCESS",
    sectionId: "process",
    heading: "How a job runs",
    items: [
      {
        title: "Survey and draw",
        description:
          "We measure the site ourselves and draw what is actually there, because the drawing is what the quote is tied to and a wrong dimension is expensive in stone.",
      },
      {
        title: "Scope tied to the drawing",
        description:
          "Every line of the quote points at something on the drawing. If the scope changes the drawing changes first, and the revised figure follows from it.",
      },
      {
        title: "Sequenced so you can stay",
        description:
          "Work is staged so that the parts of the building you live in stay usable. It takes longer and it is the reason most of our work is in occupied houses.",
      },
      {
        title: "As-built set at handover",
        description:
          "You receive the drawings as the work was actually built, not as it was planned, so the next trade to open the wall knows what is behind it.",
      },
    ],
  };

  const withFaq = {
    ...testDefinition,
    profile: {
      ...testDefinition.profile,
      sections: [
        ...testDefinition.profile.sections,
        faqSection,
        policiesSection,
        processSection,
      ],
    },
  };

  /*
   * The same client, with the project routes its page graph would carry. The
   * media explorer is a capability of a route, so it cannot be proved on a
   * fixture that has no projects.
   */
  const projectDefinition = {
    ...withFaq,
    pageGraph: {
      ...testDefinition.pageGraph,
      pages: [
        ...testDefinition.pageGraph.pages,
        {
          pageId: "projects",
          path: "/projects",
          kind: "PROJECTS_INDEX",
          experienceRouteId: "projects-index",
        },
        {
          pageId: "project-one",
          path: "/projects/one",
          kind: "PROJECT_DETAIL",
          experienceRouteId: "project-detail",
        },
      ],
    },
  };

  const language: StarterInteraction = {
    tempo: "MEASURED",
    attack: "EASED",
    travel: 0.5,
    overshoot: 0,
    pointerFeedback: "GENEROUS",
    entrance: "EVERY_SECTION",
    disclosure: "WHEN_LONG",
    mediaExploration: "WHEN_PLURAL",
    reducedMotion: "INSTANT",
  };

  const briefWith = (interaction: Partial<StarterInteraction>) => ({
    ...loudBrief,
    interaction: { ...language, ...interaction },
  });

  it("emits no interaction helper a client did not ask for", () => {
    const still = generate(
      briefWith({
        pointerFeedback: "NONE",
        entrance: "NONE",
        travel: 0,
        disclosure: "ALWAYS_VISIBLE",
        mediaExploration: "EDITORIAL_ONLY",
      }),
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
    expect(foldsAway(folded.interactions, "FAQ")).toBe(true);
    expect(folded.files.map((file) => file.path)).toContain(
      "components/Disclosure.tsx",
    );

    // Same content, a client that keeps things open.
    const open = generate(briefWith({ disclosure: "ALWAYS_VISIBLE" }), withFaq);
    expect(foldsAway(open.interactions, "FAQ")).toBe(false);
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
      ...generated.interactions.disclosures,
      generated.interactions.projectMedia,
    ]) {
      expect(decision.reason.length).toBeGreaterThan(20);
    }
    // Every run the content offered was considered, including the ones refused.
    expect(
      generated.interactions.disclosures.map((decision) => decision.run.sectionType),
    ).toEqual(["SERVICES", "FAQ", "POLICIES", "PROCESS"]);
  });

  /*
   * FINDING 2 — the capability has to be usable somewhere other than the place
   * it was built for. Two runs of the same structure, on the same page, both
   * folded; and the ordered method beside them left alone.
   */
  it("folds two semantically distinct runs and refuses the sequence between them", () => {
    const generated = generate(briefWith({ disclosure: "WHEN_LONG" }), withFaq);
    const byType = new Map(
      generated.interactions.disclosures.map((decision) => [
        decision.run.sectionType,
        decision,
      ]),
    );
    expect(byType.get("FAQ")?.treatment).toBe("PROGRESSIVE_DISCLOSURE");
    expect(byType.get("POLICIES")?.treatment).toBe("PROGRESSIVE_DISCLOSURE");
    expect(byType.get("PROCESS")?.treatment).toBe("STATIC");

    const route = fileNamed(generated, "routes/AboutContactRoutes.tsx");
    // Both folded runs reach the emitted source, and the method stays a list.
    expect((route.match(/<Detail/g) ?? []).length).toBe(2);
    expect(route).toContain("<ol className=");
  });

  /*
   * FINDING 3 — the entrance control has to mean something. Identical content
   * and identical everything else; only the authored value differs.
   */
  it("gives materially different entrance values materially different pages", () => {
    const countArrive = (interaction: Partial<StarterInteraction>) => {
      const generated = generate(briefWith(interaction), withFaq);
      return generated.files
        .filter((file) => file.path.startsWith("routes/"))
        .reduce(
          (total, file) => total + (file.contents.match(/<Arrive/g) ?? []).length,
          0,
        );
    };
    const none = countArrive({ entrance: "NONE" });
    const key = countArrive({ entrance: "KEY_MOMENTS" });
    const every = countArrive({ entrance: "EVERY_SECTION" });

    expect(none).toBe(0);
    expect(key).toBeGreaterThan(none);
    expect(every).toBeGreaterThan(key);
  });

  /*
   * FINDING 10 — and the pointer control likewise, without ever buying or
   * selling an accessibility affordance.
   */
  it("varies optional feedback by appetite and never the focus affordance", () => {
    const css = (pointerFeedback: StarterInteraction["pointerFeedback"]) =>
      fileNamed(
        generate(briefWith({ pointerFeedback, entrance: "NONE" }), withFaq),
        "styles/site.css",
      );
    const none = css("NONE");
    const essential = css("ESSENTIAL");
    const generous = css("GENEROUS");

    // Optional expression genuinely differs at each step.
    expect(essential.length).toBeGreaterThan(none.length);
    expect(generous.length).toBeGreaterThan(essential.length);
    expect(none).not.toContain("-menu-in");
    expect(essential).toContain("-menu-in");
    expect(generous).toContain("-plate img {");
    expect(essential).not.toContain("-plate img {\n  transition");

    // The affordance a reader needs to operate the page never moves.
    const rings = (source: string) => (source.match(/focus-visible/g) ?? []).length;
    expect(rings(none)).toBe(rings(generous));
    expect(rings(none)).toBeGreaterThan(0);
  });

  /*
   * FINDING 4 — the manifest describes the artifact, not one subset of the
   * inputs that produced it. A client can want no entrance and no pointer
   * response and still receive two animated capabilities from its content.
   */
  it("declares motion whenever the artifact actually animates", () => {
    const foldingButStill = generate(
      briefWith({
        pointerFeedback: "NONE",
        entrance: "NONE",
        disclosure: "PREFERRED",
        mediaExploration: "PREFERRED",
      }),
      withFaq,
    );
    expect(foldingButStill.design.interaction.enabled).toBe(false);
    expect(foldingButStill.interactions.usesDisclosure).toBe(true);
    const runtime = JSON.parse(
      fileNamed(foldingButStill, "manifest.json"),
    ).runtime;
    expect(runtime.motion).toBe("NATIVE");
    expect(runtime.clientJavaScript).toBe("COMPONENT_SCOPED");
    // And the stylesheet it shipped really does carry the durations it needs.
    expect(fileNamed(foldingButStill, "styles/site.css")).toContain(
      "--motion-state:",
    );

    const genuinelyStill = generate(
      briefWith({
        pointerFeedback: "NONE",
        entrance: "NONE",
        disclosure: "ALWAYS_VISIBLE",
        mediaExploration: "EDITORIAL_ONLY",
      }),
      withFaq,
    );
    const stillRuntime = JSON.parse(
      fileNamed(genuinelyStill, "manifest.json"),
    ).runtime;
    expect(stillRuntime.motion).toBe("NONE");
    // A still site carries no motion variables and no reduced-motion overrides.
    const stillCss = fileNamed(genuinelyStill, "styles/site.css");
    expect(stillCss).not.toContain("--motion-state:");
    expect(stillCss).not.toContain("prefers-reduced-motion");
  });

  /*
   * FINDING 5 — the body entrance has to exist, and it has to be impossible for
   * it to hide content from a reader without JavaScript.
   */
  it("gives the disclosure body an entrance only the helper can trigger", () => {
    const css = fileNamed(
      generate(briefWith({ disclosure: "WHEN_LONG" }), withFaq),
      "styles/site.css",
    );
    expect(css).toContain("-detail-body-in");
    // The entrance is on the opening state, which only the helper ever sets.
    expect(css).toMatch(
      /\[data-disclosure="opening"\] \.[a-z-]+-detail-body \{\s*animation:/,
    );
    // And never on the closed state, which is what a no-JS reader is left in.
    expect(css).not.toMatch(/\[data-disclosure="closed"\] \.[a-z-]+-detail-body/);
  });

  /*
   * FINDING 6 — stepping between photographs is a movement, and it must not be
   * bought with a frame loop, a remount or a delay before the content changes.
   */
  it("moves between photographs without a frame loop or a remounted image", () => {
    const withProjects = generate(
      briefWith({ mediaExploration: "PREFERRED" }),
      projectDefinition,
    );
    const viewer = fileNamed(withProjects, "components/MediaViewer.tsx");
    expect(viewer).toContain("STEP_MS");
    expect(viewer).toContain("figure.animate(");
    // Swapped first, animated second: no reader waits for a departure.
    expect(viewer).toMatch(/direction\.current = delta/);
    expect(viewer).not.toContain("requestAnimationFrame");
    // The figure is never keyed on the active index, so the photograph stays.
    expect(viewer).not.toMatch(/<figure[^>]*key=/);
  });

  /*
   * FINDING 8 — Escape and the Close control have to answer the same way. The
   * native behaviour returns focus to whatever had it when showModal() ran,
   * which is the trigger the reader opened, not the one they ended on.
   */
  it("returns focus through one handler that both exits reach", () => {
    const viewer = fileNamed(
      generate(briefWith({ mediaExploration: "PREFERRED" }), projectDefinition),
      "components/MediaViewer.tsx",
    );
    expect(viewer).toContain("onClose={onClose}");
    expect(viewer).toContain("triggers.current.get(active)?.focus()");
    // The Close button asks the dialog to close; it does not return focus
    // itself, or Escape would take a different path to a different answer.
    expect(viewer).toContain("onClick={() => dialogRef.current?.close()}");
    expect(viewer.match(/triggers\.current\.get\(active\)\?\.focus\(\)/g)).toHaveLength(1);
  });

  /*
   * FINDING 7 — the menu must not arrive with movement and leave without it.
   * Both directions are bought by one appetite, so every authorable value gives
   * a symmetric menu.
   */
  it("keeps the collapsed navigation symmetric at every appetite", () => {
    const moving = generate(briefWith({ pointerFeedback: "ESSENTIAL" }), withFaq);
    expect(moving.files.map((file) => file.path)).toContain("components/Menu.tsx");
    const menu = fileNamed(moving, "components/Menu.tsx");
    expect(menu).toContain("CLOSE_MS");
    expect(menu).toContain("panel.animate(");
    // It enhances the client's own markup and gives up quietly if it is absent.
    expect(menu).toContain("-menu-toggle");
    expect(menu).not.toContain("requestAnimationFrame");
    const movingCss = fileNamed(moving, "styles/site.css");
    expect(movingCss).toContain("-menu-in");
    expect(movingCss).toContain('[data-menu="closing"]');

    // A client that buys no navigation feedback gets neither direction.
    const still = generate(briefWith({ pointerFeedback: "NONE" }), withFaq);
    expect(still.files.map((file) => file.path)).not.toContain(
      "components/Menu.tsx",
    );
    expect(fileNamed(still, "styles/site.css")).not.toContain("-menu-in");
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
    expect(foldsAway(patient.interactions, "FAQ")).toBe(false);
    expect(foldsAway(brisk.interactions, "FAQ")).toBe(true);
    expect(patient.sourceHash).not.toBe(brisk.sourceHash);
  });
});
