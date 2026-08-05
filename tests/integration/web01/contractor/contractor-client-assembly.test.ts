import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  assembleClientSourceArtifact,
  generateClientWebsiteSnapshot,
  verifyClientSourceArtifact,
} from "../../../../apps/managed-web/src/generation/index.js";
import { ProfileSection } from "../../../../apps/managed-web/src/rendering/index.js";
import { defaultContractorProfileContent } from "../../../../packages/templates/src/profiles/contractor/contractor-profile.js";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const contractorExampleDir = join(
  repositoryRoot,
  "apps",
  "managed-web",
  "client",
  "examples",
  "contractor",
);
const contractorPublicExampleDir = join(
  repositoryRoot,
  "apps",
  "managed-web",
  "public",
  "examples",
  "contractor",
);

interface ContractorExampleDefinition {
  readonly configuration: {
    readonly configuredInfrastructure: readonly unknown[];
  };
  readonly profile: unknown;
  readonly assets: readonly {
    readonly assetId: string;
    readonly sourcePath: string;
    readonly width: number;
    readonly height: number;
  }[];
}

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("Contractor Representative Demo Assembly & Handoff (AC-004, AC-006, AC-007)", () => {
  it("keeps public and client asset mirrors byte-identical, dimensionally accurate, and visually distinct", async () => {
    const definition = JSON.parse(
      await readFile(join(contractorExampleDir, "client-website.json"), "utf8"),
    ) as ContractorExampleDefinition;
    const hashes: string[] = [];

    expect(definition.assets.map(({ assetId }) => assetId)).toEqual([
      "hero-primary",
      "gallery-switchboard-detail",
      "gallery-work-context",
    ]);

    for (const asset of definition.assets) {
      const [clientBytes, publicBytes] = await Promise.all([
        readFile(join(contractorExampleDir, "public", asset.sourcePath)),
        readFile(join(contractorPublicExampleDir, asset.sourcePath)),
      ]);

      expect(clientBytes.equals(publicBytes)).toBe(true);
      expect(clientBytes.subarray(1, 4).toString("ascii")).toBe("PNG");
      expect(clientBytes.readUInt32BE(16)).toBe(asset.width);
      expect(clientBytes.readUInt32BE(20)).toBe(asset.height);
      hashes.push(sha256(clientBytes));
    }

    expect(new Set(hashes).size).toBe(definition.assets.length);
    expect(
      (
        await readdir(join(contractorExampleDir, "public", "assets", "gallery"))
      ).sort(),
    ).toEqual(["switchboard-detail.png", "work-context.png"]);
    expect(
      (
        await readdir(join(contractorPublicExampleDir, "assets", "gallery"))
      ).sort(),
    ).toEqual(["switchboard-detail.png", "work-context.png"]);
  });

  it("keeps every source asset within the frozen P20/P21 handoff-weight budgets and records provenance (K1)", async () => {
    const definition = JSON.parse(
      await readFile(join(contractorExampleDir, "client-website.json"), "utf8"),
    ) as ContractorExampleDefinition;

    let total = 0;
    for (const asset of definition.assets) {
      const bytes = await readFile(join(contractorExampleDir, "public", asset.sourcePath));
      expect(bytes.length).toBeLessThanOrEqual(600_000); // P20
      total += bytes.length;
    }
    expect(total).toBeLessThanOrEqual(2_500_000); // P21

    const [clientProvenance, publicProvenance] = await Promise.all([
      readFile(join(contractorExampleDir, "public", "assets", "PROVENANCE.md"), "utf8"),
      readFile(join(contractorPublicExampleDir, "assets", "PROVENANCE.md"), "utf8"),
    ]);
    expect(clientProvenance).toBe(publicProvenance);
    expect(clientProvenance).toMatch(/identifiable person/i);
  });

  it("keeps the portable demo aligned with canonical truthful content and empty infrastructure", async () => {
    const definition = JSON.parse(
      await readFile(join(contractorExampleDir, "client-website.json"), "utf8"),
    ) as ContractorExampleDefinition;

    expect(definition.profile).toEqual(defaultContractorProfileContent);
    expect(definition.configuration.configuredInfrastructure).toEqual([]);
  });

  it("renders only the two dedicated gallery assets without an unavailable-image fallback", async () => {
    const definition = JSON.parse(
      await readFile(join(contractorExampleDir, "client-website.json"), "utf8"),
    ) as ContractorExampleDefinition;
    const snapshot = generateClientWebsiteSnapshot(
      definition,
      join(contractorExampleDir, "public"),
    );
    const gallerySection = snapshot.profile.sections.find(
      (section) => section.type === "GALLERY",
    );

    expect(gallerySection).toBeDefined();
    if (gallerySection?.type !== "GALLERY") {
      throw new Error("Contractor representative demo requires a gallery section.");
    }

    expect(gallerySection.items.map(({ assetId }) => assetId)).toEqual([
      "gallery-switchboard-detail",
      "gallery-work-context",
    ]);
    expect(gallerySection.items.map(({ assetId }) => assetId)).not.toContain(
      "hero-primary",
    );
    expect(snapshot.assets.map(({ asset }) => asset.assetId)).toEqual([
      "hero-primary",
      "gallery-switchboard-detail",
      "gallery-work-context",
    ]);

    const galleryHtml = renderToStaticMarkup(
      createElement(ProfileSection, {
        section: gallerySection,
        assets: snapshot.assets,
      }),
    );

    expect(galleryHtml).toContain(
      'data-asset-id="gallery-switchboard-detail"',
    );
    expect(galleryHtml).toContain('data-asset-id="gallery-work-context"');
    expect(galleryHtml).not.toContain('data-asset-id="hero-primary"');
    expect(galleryHtml).not.toContain("profile-image-unavailable");
  });

  it("assembles the contractor representative demo into a clean portable artifact", async () => {
    const tempOutput = await mkdtemp(join(tmpdir(), "contractor-artifact-"));

    try {
      const definitionRaw = await readFile(
        join(contractorExampleDir, "client-website.json"),
        "utf8",
      );
      const definition = JSON.parse(definitionRaw) as unknown;

      const artifact = await assembleClientSourceArtifact({
        definition,
        publicDirectory: join(contractorExampleDir, "public"),
        outputDirectory: tempOutput,
        factoryRevision: "test-rev-12345",
      });

      expect(artifact.descriptor.clientId).toBe("harbour-electrical");
      expect(artifact.descriptor.kind).toBe("MANAGED_WEBSITE_SOURCE");

      const verification = await verifyClientSourceArtifact(artifact.sourceDirectory);
      expect(verification.success).toBe(true);
      expect(verification.checks).toEqual(["INSTALL", "TYPECHECK", "TEST", "BUILD"]);

      const assembledJson = JSON.parse(
        await readFile(
          join(artifact.sourceDirectory, "src/generated/managed-website.json"),
          "utf8",
        ),
      );
      expect(assembledJson.configuration.clientId).toBe("harbour-electrical");
      expect(assembledJson.profile.profile).toBe("CONTRACTOR");
      expect(assembledJson.profile.sections.length).toBeGreaterThanOrEqual(8);

      const assetManifest = JSON.parse(
        await readFile(
          join(artifact.sourceDirectory, "src/generated/asset-manifest.json"),
          "utf8",
        ),
      );
      expect(assetManifest.assets.length).toBeGreaterThan(0);
      for (const asset of assetManifest.assets) {
        expect(asset.publicPath).toMatch(/^\/assets\//);
      }
    } finally {
      await rm(tempOutput, { recursive: true, force: true });
    }
  });
});
