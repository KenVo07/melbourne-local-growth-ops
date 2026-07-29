import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AssetPipelineError } from "@melbourne-local-growth-ops/asset-pipeline";
import { afterEach, describe, expect, it } from "vitest";

import {
  composeManagedWebsite,
  createWebsiteModuleRegistry,
  createWebsiteTemplateRegistry,
  type ManagedWebsiteDefinition,
  type WebsiteComposition,
  type WebsiteTemplate,
} from "./index.js";

const temporaryDirectories: string[] = [];

function publicDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "mlgo-site-assets-"));
  temporaryDirectories.push(directory);
  return directory;
}

function writeAsset(root: string, sourcePath: string): void {
  const parent = join(root, ...sourcePath.split("/").slice(0, -1));
  mkdirSync(parent, { recursive: true });
  writeFileSync(join(root, ...sourcePath.split("/")), "image fixture");
}

function definition(
  clientId: string,
  assets?: ManagedWebsiteDefinition["assets"],
): ManagedWebsiteDefinition {
  return {
    configuration: {
      schemaVersion: 1,
      configurationId: `configuration-${clientId}`,
      configurationVersion: 1,
      clientId,
      entitlementId: `entitlement-${clientId}`,
      deploymentId: `deployment-${clientId}`,
      display: {
        businessName: `Business ${clientId}`,
        locationIds: [`location-${clientId}`],
      },
      domains: [{ hostname: `${clientId}.example.com.au`, canonical: true }],
      modules: [],
      connectors: [],
      configuredInfrastructure: [],
    },
    template: {
      templateId: "asset-test",
      templateVersion: "1.0.0",
    },
    modules: [],
    ...(assets === undefined ? {} : { assets }),
  };
}

function template(required: boolean): WebsiteTemplate {
  return {
    templateId: "asset-test",
    version: "1.0.0",
    compose(configuration, assets): WebsiteComposition {
      const hero = assets?.selectImage({
        slotId: "hero",
        assetId: "hero-primary",
        required,
        alt: `${configuration.display.businessName} electrician at work`,
        sizes: "(min-width: 48rem) 50vw, 100vw",
        priority: true,
      });

      return {
        templateId: "asset-test",
        templateVersion: "1.0.0",
        regions: [],
        ...(hero === undefined ? {} : { assets: [hero] }),
      };
    },
  };
}

function registries(websiteTemplate: WebsiteTemplate) {
  return {
    templates: createWebsiteTemplateRegistry([websiteTemplate]),
    modules: createWebsiteModuleRegistry([]),
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("managed website asset composition", () => {
  it("keeps definitions and templates without assets backward compatible", () => {
    const result = composeManagedWebsite(
      definition("client-a"),
      registries({
        templateId: "asset-test",
        version: "1.0.0",
        compose: () => ({
          templateId: "asset-test",
          templateVersion: "1.0.0",
          regions: [],
        }),
      }),
    );

    expect(result).toMatchObject({
      success: true,
      data: {
        assetManifest: {
          schemaVersion: 1,
          clientId: "client-a",
          assets: [],
        },
        assets: [],
      },
    });
  });

  it("orchestrates a client manifest into a template-selected image", () => {
    const root = publicDirectory();
    writeAsset(root, "assets/hero/primary.webp");

    const result = composeManagedWebsite(
      definition("client-a", {
        clientId: "client-a",
        publicDirectory: root,
        assets: [
          {
            assetId: "hero-primary",
            kind: "IMAGE",
            sourcePath: "assets/hero/primary.webp",
            mediaType: "image/webp",
            width: 1600,
            height: 900,
          },
        ],
      }),
      registries(template(true)),
    );
    if (!result.success) {
      throw new Error("Valid asset definition must compose.");
    }

    expect(result.data.assetManifest.clientId).toBe("client-a");
    expect(result.data.assets).toEqual([
      {
        slotId: "hero",
        asset: {
          assetId: "hero-primary",
          kind: "IMAGE",
          sourcePath: "assets/hero/primary.webp",
          publicPath: "/assets/hero/primary.webp",
          mediaType: "image/webp",
          width: 1600,
          height: 900,
        },
        alt: "Business client-a electrician at work",
        sizes: "(min-width: 48rem) 50vw, 100vw",
        priority: true,
      },
    ]);
    expect(Object.isFrozen(result.data.assets)).toBe(true);
    expect(Object.isFrozen(result.data.assets[0])).toBe(true);
  });

  it("omits an unselected optional asset", () => {
    const result = composeManagedWebsite(
      definition("client-a"),
      registries(template(false)),
    );

    expect(result).toMatchObject({
      success: true,
      data: { assets: [] },
    });
  });

  it("fails when a template requires a missing asset", () => {
    expect(() =>
      composeManagedWebsite(
        definition("client-a"),
        registries(template(true)),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<AssetPipelineError>>({
        code: "UNKNOWN_ASSET_ID",
        assetId: "hero-primary",
        clientId: "client-a",
      }),
    );
  });

  it("rejects an asset source owned by another client", () => {
    const root = publicDirectory();
    writeAsset(root, "assets/hero/primary.webp");

    expect(() =>
      composeManagedWebsite(
        definition("client-a", {
          clientId: "client-b",
          publicDirectory: root,
          assets: [
            {
              assetId: "hero-primary",
              kind: "IMAGE",
              sourcePath: "assets/hero/primary.webp",
              mediaType: "image/webp",
              width: 1600,
              height: 900,
            },
          ],
        }),
        registries(template(true)),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<AssetPipelineError>>({
        code: "ASSET_CLIENT_MISMATCH",
        clientId: "client-b",
        expectedClientId: "client-a",
      }),
    );
  });
});
