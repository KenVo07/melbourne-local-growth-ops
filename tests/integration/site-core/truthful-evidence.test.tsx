import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  composeManagedWebsite,
  createWebsiteModuleRegistry,
  createWebsiteTemplateRegistry,
  validateWebsiteProfileContent,
} from "@melbourne-local-growth-ops/site-core";
import { contractorTemplateV1 } from "@melbourne-local-growth-ops/templates";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";

import { generateClientWebsiteSnapshot } from "../../../apps/managed-web/src/generation";
import {
  ManagedWebsiteShell,
  createManagedModuleRendererRegistry,
} from "../../../apps/managed-web/src/rendering";
import { bookingCtaRenderer } from "../../../apps/managed-web/src/rendering/booking-cta-renderer";
import { buildManagedWebsiteJsonLd } from "../../../apps/managed-web/src/structured-data";
import {
  analyticsContract,
  bookingCtaContract,
  managedWebsiteDefinition,
} from "./fixtures";

/**
 * A Professional Website may show the proof a business actually has.
 *
 * These tests hold one line: the Factory asks a client what it *is* and refuses
 * to make it invent what it *has*. A contractor who has not photographed a
 * finished job, and whose customers will not be quoted, must be able to publish
 * a credible website — and the pages that would have carried that evidence must
 * then not exist at all, rather than existing empty or filled with a stand-in.
 *
 * The three shapes are checked together because the defect can reappear in any
 * one of them: the schema can demand the section, the generator can emit a
 * heading over nothing, or the structured data can claim proof the page never
 * showed.
 */

const publicDirectory = fileURLToPath(
  new URL("../../../apps/managed-web/public", import.meta.url),
);
const authoredFixtureRoot = fileURLToPath(
  new URL("../../fixtures/web01b/neutral-v2", import.meta.url),
);

/** Words a generator reaches for when it has a slot and nothing to put in it. */
const placeholderLanguage =
  /coming soon|check back|no reviews yet|watch this space|placeholder|to be added|lorem ipsum|photos coming|testimonials coming/i;

function realRegistries() {
  return {
    templates: createWebsiteTemplateRegistry([contractorTemplateV1]),
    modules: createWebsiteModuleRegistry([
      analyticsContract,
      bookingCtaContract,
    ]),
  };
}

type Section = { readonly type: string; readonly sectionId: string };

/** The legacy one-page definition, with the named evidence sections removed. */
function withoutEvidence(clientId: string, ...types: readonly string[]) {
  const definition = managedWebsiteDefinition(clientId) as unknown as {
    profile: { sections: Section[] };
  };
  const kept = definition.profile.sections.filter(
    ({ type }) => !types.includes(type),
  );
  return {
    ...definition,
    profile: { ...definition.profile, sections: kept },
  } as ReturnType<typeof managedWebsiteDefinition>;
}

function renderLegacy(definition: ReturnType<typeof managedWebsiteDefinition>) {
  const result = composeManagedWebsite(definition, realRegistries());
  if (!result.success) {
    throw new Error(
      `Definition must compose: ${JSON.stringify(result.issues)}`,
    );
  }
  return {
    composition: result.data,
    html: renderToStaticMarkup(
      <ManagedWebsiteShell
        composition={result.data}
        renderers={createManagedModuleRendererRegistry([bookingCtaRenderer])}
      />,
    ),
  };
}

describe("a Contractor is never required to hold proof it does not have", () => {
  it("publishes a contractor with no customer feedback", () => {
    const { composition, html } = renderLegacy(
      withoutEvidence("no-feedback", "TESTIMONIALS"),
    );

    expect(
      composition.profile?.sections.some(
        ({ type }) => type === "TESTIMONIALS",
      ),
    ).toBe(false);
    // Nothing stands where the quotes would have been.
    expect(html).not.toContain('id="testimonials"');
    expect(html).not.toContain("Feedback");
    expect(html).not.toMatch(placeholderLanguage);
  });

  it("publishes a contractor with no photographs of finished work", () => {
    const { composition, html } = renderLegacy(
      withoutEvidence("no-gallery", "GALLERY"),
    );

    expect(
      composition.profile?.sections.some(({ type }) => type === "GALLERY"),
    ).toBe(false);
    expect(html).not.toContain('id="gallery"');
    expect(html).not.toContain("<figure");
    expect(html).not.toMatch(placeholderLanguage);
  });

  it("publishes a contractor holding neither, with no empty heading or container", () => {
    const bare = withoutEvidence("no-evidence", "GALLERY", "TESTIMONIALS");
    const { composition, html } = renderLegacy(bare);

    const sections = composition.profile?.sections ?? [];
    expect(sections.map(({ type }) => type)).toEqual([
      "SERVICES",
      "TRUST_SIGNALS",
      "PROCESS",
      "FAQ",
      "CONTACT",
      "ACTIONS",
    ]);

    // Every rendered section carries content. A section element that contains
    // only its own heading is exactly the empty container this rule forbids.
    const rendered = [...html.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/g)];
    expect(rendered.length).toBeGreaterThan(0);
    for (const [, body] of rendered) {
      const withoutHeadings = (body ?? "").replace(
        /<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/g,
        "",
      );
      expect(withoutHeadings.replace(/<[^>]*>/g, "").trim()).not.toBe("");
    }
    expect(html).not.toMatch(placeholderLanguage);
  });

  it("creates no anchor for evidence the client never supplied", () => {
    const { composition, html } = renderLegacy(
      withoutEvidence("no-anchors", "GALLERY", "TESTIMONIALS"),
    );

    // Navigation is derived from the sections that exist, so the absent ones
    // cannot leave a link pointing at nothing.
    for (const section of composition.profile?.sections ?? []) {
      expect(html).toContain(`href="#${section.sectionId}"`);
    }
    expect(html).not.toContain('href="#gallery"');
    expect(html).not.toContain('href="#testimonials"');
  });

  it("leaves a contractor who does hold the evidence rendering exactly as before", () => {
    const { composition, html } = renderLegacy(
      managedWebsiteDefinition("has-evidence"),
    );

    expect(
      composition.profile?.sections.some(({ type }) => type === "GALLERY"),
    ).toBe(true);
    expect(
      composition.profile?.sections.some(
        ({ type }) => type === "TESTIMONIALS",
      ),
    ).toBe(true);
    expect(html).toContain('href="#gallery"');
    expect(html).toContain('href="#testimonials"');
    expect(html).toContain("Fictional testimonial for has-evidence.");
  });

  it("keeps the capability available rather than removing it from the model", () => {
    // The distinction the fix rests on: the Profile still *supports* both kinds
    // of evidence. Only the demand that a client possess them was dropped.
    const withOnlyEvidenceAdded = managedWebsiteDefinition("capability");
    const result = validateWebsiteProfileContent(
      withOnlyEvidenceAdded.profile,
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    const gallery = result.data.sections.find(
      (section) => section.type === "GALLERY",
    );
    expect(gallery?.type === "GALLERY" && gallery.items.length).toBe(1);
  });
});

describe("the authored path omits absent evidence without a trace", () => {
  let definitionText: string;
  let manifest: unknown;

  beforeAll(async () => {
    definitionText = await readFile(
      `${authoredFixtureRoot}/client-website.json`,
      "utf8",
    );
    manifest = JSON.parse(
      await readFile(`${authoredFixtureRoot}/experience/manifest.json`, "utf8"),
    ) as unknown;
  });

  function authoredWithout(...types: readonly string[]) {
    const value = JSON.parse(definitionText) as {
      profile: { sections: Section[] };
    } & Record<string, unknown>;
    value.profile = {
      ...value.profile,
      sections: value.profile.sections.filter(
        ({ type }) => !types.includes(type),
      ),
    };
    return generateClientWebsiteSnapshot(value, publicDirectory, {
      clientExperienceManifest: manifest,
    });
  }

  it("generates a v2 contractor site with neither gallery nor testimonials", () => {
    const snapshot = authoredWithout("GALLERY", "TESTIMONIALS");

    expect(snapshot.renderingMode).toBe("AUTHORED_CLIENT_EXPERIENCE");
    expect(
      snapshot.profile?.sections.some(
        ({ type }) => type === "GALLERY" || type === "TESTIMONIALS",
      ),
    ).toBe(false);
  });

  it("routes and anchors reference only sections that exist", () => {
    const snapshot = authoredWithout("GALLERY", "TESTIMONIALS");
    const pageGraph = snapshot.pageGraph;
    if (pageGraph === undefined) {
      throw new Error("Fixture must produce an authored snapshot.");
    }
    const declared = new Set(
      (snapshot.profile?.sections ?? []).map(({ sectionId }) => sectionId),
    );

    for (const page of pageGraph.pages) {
      if (page.content.kind !== "PROFILE_SECTIONS") continue;
      for (const sectionId of page.content.sectionIds) {
        expect(declared.has(sectionId)).toBe(true);
      }
      // A page whose every section vanished would be a route to an empty
      // document, so a PROFILE_SECTIONS page must still resolve something.
      expect(
        page.content.sectionIds.filter((id) => declared.has(id)).length,
      ).toBeGreaterThan(0);
    }

    const pageIds = new Set(pageGraph.pages.map(({ pageId }) => pageId));
    for (const item of [
      ...pageGraph.navigation.primary,
      ...pageGraph.navigation.utility,
      ...pageGraph.navigation.footer,
    ]) {
      expect(pageIds.has(item.target.pageId)).toBe(true);
    }
  });

  it("indexes nothing for evidence that was never supplied", () => {
    const snapshot = authoredWithout("GALLERY", "TESTIMONIALS");
    const searchText = JSON.stringify(snapshot.foundationSearch ?? null);

    expect(searchText).not.toContain("Gallery");
    expect(searchText).not.toContain("Feedback");
    expect(searchText).not.toMatch(placeholderLanguage);
  });

  it("claims no proof in structured data that the pages do not show", () => {
    const serialized = JSON.stringify(
      buildManagedWebsiteJsonLd(authoredWithout("GALLERY", "TESTIMONIALS")),
    );

    for (const forbidden of [
      "review",
      "Review",
      "aggregateRating",
      "ratingValue",
      "image",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("still generates unchanged for a client that supplied both", () => {
    const snapshot = authoredWithout();

    expect(snapshot.renderingMode).toBe("AUTHORED_CLIENT_EXPERIENCE");
    expect(
      snapshot.profile?.sections.some(({ type }) => type === "GALLERY"),
    ).toBe(true);
    expect(
      snapshot.profile?.sections.some(({ type }) => type === "TESTIMONIALS"),
    ).toBe(true);
  });
});
