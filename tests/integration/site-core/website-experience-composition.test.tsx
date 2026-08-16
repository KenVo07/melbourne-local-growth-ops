import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import fieldGuideDefinition from "../../fixtures/web01b/contractor/field-guide-client-website.json";
import referenceDefinition from "../../fixtures/web01b/contractor/reference-client-website.json";
import {
  generateClientWebsiteSnapshot,
} from "../../../apps/managed-web/src/generation";
import { managedWebsiteRenderers } from "../../../apps/managed-web/src/managed-website";
import { ManagedWebsiteShell } from "../../../apps/managed-web/src/rendering";

const publicDirectory = fileURLToPath(
  new URL(
    "../../../apps/managed-web/client/examples/contractor/public",
    import.meta.url,
  ),
);

describe("same-profile WEB-01B experience composition", () => {
  it("uses identical Contractor semantics, modules, configuration modules, and assets", () => {
    expect(semanticHash(referenceDefinition)).toBe(
      semanticHash(fieldGuideDefinition),
    );
    expect(referenceDefinition.experience.experienceId).not.toBe(
      fieldGuideDefinition.experience.experienceId,
    );
  });

  it("renders exact section permutations with stable semantic anchors", () => {
    const reference = renderDefinition(referenceDefinition);
    const fieldGuide = renderDefinition(fieldGuideDefinition);

    expect(renderedSectionIds(reference)).toEqual([
      "contact",
      "primary",
      "services",
      "trust",
      "gallery",
      "process",
      "testimonials",
      "faq",
    ]);
    expect(renderedSectionIds(fieldGuide)).toEqual([
      "services",
      "trust",
      "gallery",
      "process",
      "faq",
      "contact",
      "testimonials",
      "primary",
    ]);
    expect(new Set(renderedSectionIds(reference))).toEqual(
      new Set(renderedSectionIds(fieldGuide)),
    );
  });

  it("exposes finite experience attributes and the declared server Signature", () => {
    const reference = renderDefinition(referenceDefinition);
    const fieldGuide = renderDefinition(fieldGuideDefinition);

    expect(reference).toContain('data-experience-source="explicit"');
    expect(reference).toContain('data-hero-layout="split"');
    expect(reference).toContain('data-content-width="standard"');
    expect(reference).toContain('data-section-rhythm="balanced"');
    expect(reference).toContain('data-surface-treatment="cards"');
    expect(reference).not.toContain('data-signature-id="service-area-proof"');

    expect(fieldGuide).toContain('data-hero-layout="media_first"');
    expect(fieldGuide).toContain('data-content-width="wide"');
    expect(fieldGuide).toContain('data-section-rhythm="expansive"');
    expect(fieldGuide).toContain('data-surface-treatment="banded"');
    expect(fieldGuide).toContain('data-gallery-frame="editorial"');
    expect(fieldGuide).toContain('data-signature-id="service-area-proof"');
    expect(fieldGuide).toContain('data-signature-placement="after_hero"');
  });

  it("keeps Design DNA and the static Signature free of client directives", async () => {
    const files = [
      "../../../apps/managed-web/src/rendering/ManagedWebsiteShell.tsx",
      "../../../apps/managed-web/src/rendering/signatures/SignatureSlot.tsx",
      "../../../apps/managed-web/src/rendering/signatures/ServiceAreaProof.tsx",
    ];
    const source = await Promise.all(
      files.map((path) => readFile(new URL(path, import.meta.url), "utf8")),
    );

    expect(source.join("\n")).not.toMatch(/["']use client["']/);
  });
});

function renderDefinition(definition: unknown): string {
  const snapshot = generateClientWebsiteSnapshot(definition, publicDirectory);
  return renderToStaticMarkup(
    <ManagedWebsiteShell
      composition={snapshot}
      renderers={managedWebsiteRenderers}
    />,
  );
}

function renderedSectionIds(html: string): string[] {
  return [...html.matchAll(/<section[^>]+data-section-id="([^"]+)"/g)].map(
    (match) => match[1] ?? "",
  );
}

function semanticHash(definition: typeof referenceDefinition): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        profile: definition.profile,
        configurationModules: definition.configuration.modules,
        modules: definition.modules,
        assets: definition.assets,
      }),
    )
    .digest("hex");
}
